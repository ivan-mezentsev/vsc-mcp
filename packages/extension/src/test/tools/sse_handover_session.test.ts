import * as assert from 'assert';
import http from 'node:http';
import { URL } from 'node:url';
import * as vscode from 'vscode';

type JsonRpcId = number | string;
type JsonRpcMessage = {
    jsonrpc: '2.0';
    id?: JsonRpcId;
    method?: string;
    params?: any;
    result?: any;
    error?: { code: number; message: string; data?: any };
};

class SseTestClient {
    private req?: http.ClientRequest;
    private buffer = '';
    private eventType: string | null = null;
    private pending: Map<JsonRpcId, { resolve: (v: any) => void; reject: (e: any) => void; }> = new Map();
    private closed = false;

    public endpointPath: string | null = null;
    public sessionId: string | null = null;

    constructor(private readonly port: number) { }

    async connect(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.req = http.request({
                hostname: '127.0.0.1',
                port: this.port,
                path: '/sse',
                method: 'GET',
                headers: {
                    Accept: 'text/event-stream',
                    Connection: 'keep-alive',
                    'Cache-Control': 'no-cache',
                },
            }, (res) => {
                res.setEncoding('utf8');
                res.on('data', (chunk: string) => this.onData(chunk));
                res.on('close', () => {
                    this.closed = true;
                    // Keep state so tests can assert close happened
                });
                resolve();
            });
            this.req.on('error', reject);
            this.req.end();
        });
        // Wait until we receive the endpoint event with sessionId
        await this.waitForEndpoint(5000);
    }

    private onData(chunk: string) {
        this.buffer += chunk;
        // Process complete SSE events separated by blank lines
        while (true) {
            const idx = this.buffer.indexOf('\n\n');
            if (idx === -1) break;
            const rawEvent = this.buffer.slice(0, idx);
            this.buffer = this.buffer.slice(idx + 2);
            this.processEvent(rawEvent);
        }
    }

    private processEvent(raw: string) {
        // Each line is either "event: <type>" or "data: <payload>" or comment starting with ':'
        const lines = raw.split(/\r?\n/);
        let evt: string | null = this.eventType; // support multi-line events
        let dataParts: string[] = [];
        for (const line of lines) {
            if (line.startsWith('event:')) {
                evt = line.slice('event:'.length).trim();
            } else if (line.startsWith('data:')) {
                dataParts.push(line.slice('data:'.length).trim());
            } else if (line.startsWith(':')) {
                // comment/heartbeat -> ignore
            }
        }
        const data = dataParts.join('\n');
        if (evt === 'endpoint') {
            this.endpointPath = data; // e.g. "/messages?sessionId=..."
            try {
                const u = new URL(`http://localhost:${this.port}${data}`);
                this.sessionId = u.searchParams.get('sessionId');
            } catch { }
            this.eventType = null;
            return;
        }
        if (evt === 'message') {
            try {
                const msg: JsonRpcMessage = JSON.parse(data);
                if (msg.id != null && this.pending.has(msg.id)) {
                    this.pending.get(msg.id)!.resolve(msg);
                    this.pending.delete(msg.id);
                }
            } catch (e) {
                // ignore parse errors
            }
            this.eventType = null;
            return;
        }
        // Unknown/other -> reset type
        this.eventType = null;
    }

    private async waitForEndpoint(timeoutMs: number): Promise<void> {
        const start = Date.now();
        while (!this.endpointPath || !this.sessionId) {
            if (Date.now() - start > timeoutMs) {
                throw new Error('Timed out waiting for SSE endpoint event');
            }
            await new Promise((r) => setTimeout(r, 50));
        }
    }

    async sendJsonRpc(postPathOrUrl: string, message: JsonRpcMessage, timeoutMs = 8000): Promise<JsonRpcMessage> {
        const id = message.id ?? Math.floor(Math.random() * 1e9);
        message.id = id;
        const postUrl = postPathOrUrl.startsWith('http')
            ? postPathOrUrl
            : `http://127.0.0.1:${this.port}${postPathOrUrl}`;

        const resultP = new Promise<JsonRpcMessage>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            const timer = setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.get(id)!.reject(new Error(`Timeout waiting for JSON-RPC response id=${id}`));
                    this.pending.delete(id);
                }
            }, timeoutMs);
            // Clear timer on resolve/reject
            this.pending.get(id)!.resolve = (v) => { clearTimeout(timer); resolve(v); };
            this.pending.get(id)!.reject = (e) => { clearTimeout(timer); reject(e); };
        });

        const body = JSON.stringify(message);
        await new Promise<void>((resolve, reject) => {
            const req = http.request(postUrl, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(body).toString(),
                },
            }, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(Buffer.from(c)));
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve();
                    } else {
                        const text = Buffer.concat(chunks).toString('utf8');
                        reject(new Error(`POST ${postUrl} failed: ${res.statusCode} ${res.statusMessage} — ${text}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });

        return resultP;
    }

    wasClosed(): boolean { return this.closed; }
}

async function waitForServer(port: number, timeoutMs = 8000) {
    const start = Date.now();
    while (true) {
        try {
            await new Promise<void>((resolve, reject) => {
                const req = http.request({ hostname: '127.0.0.1', port, path: '/ping', method: 'GET' }, (res) => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve();
                    else reject(new Error(`Status ${res.statusCode}`));
                });
                req.on('error', reject);
                req.end();
            });
            return;
        } catch { }
        if (Date.now() - start > timeoutMs) throw new Error('Server /ping not responding');
        await new Promise((r) => setTimeout(r, 100));
    }
}

suite('SSE handover sessionId reuse should fail (demonstrates current bug)', function () {
    this.timeout(45000);

    let port: number;

    test('Connect, call code_checker, handover, then call again with stale sessionId (expected to succeed, but should fail today)', async function () {
        // 1) Resolve port and wait for server
        port = vscode.workspace.getConfiguration('mcpServer').get<number>('port', 60100);
        await waitForServer(port, 10000);

        // 2) Connect SSE and capture sessionId and endpoint
        const client = new SseTestClient(port);
        await client.connect();
        assert.ok(client.sessionId, 'sessionId must be set after SSE connect');
        assert.ok(client.endpointPath, 'endpoint path must be set after SSE connect');
        const firstSessionId = client.sessionId!;
        const firstEndpoint = client.endpointPath!; // includes ?sessionId=...
        console.log(`[TEST] First session established: ${firstSessionId}`);

        // 3) Perform initial handshake and code_checker call
        const listResp = await client.sendJsonRpc(firstEndpoint, {
            jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}
        });
        assert.ok(listResp.result && Array.isArray(listResp.result.tools), 'tools/list should return tools');

        const ccResp1 = await client.sendJsonRpc(firstEndpoint, {
            jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'code_checker', arguments: {} }
        });
        assert.ok(ccResp1.result, 'First code_checker result should be present');

        // 4) Trigger handover (server stop+restart)
        await vscode.commands.executeCommand('mcpServer.toggleActiveStatus');
        // Allow some time for restart
        await new Promise((r) => setTimeout(r, 1500));

        // 5) Reconnect SSE to obtain a NEW sessionId (to reflect expected correct flow)
        const client2 = new SseTestClient(port);
        await client2.connect();
        assert.ok(client2.sessionId && client2.endpointPath, 'New SSE should provide a sessionId and endpoint');
        const secondSessionId = client2.sessionId!;
        // Sanity: server-side logs would show closure. Locally, ensure previous stream was closed.
        assert.ok(client.wasClosed(), 'Old SSE stream should be closed after handover');
        // Demonstrate that IDs differ (expected)
        assert.notStrictEqual(firstSessionId, secondSessionId, 'New sessionId should differ after handover');
        console.log(`[TEST] Second session established after handover: ${secondSessionId}`);

        // Call using NEW endpoint to prove server works after handover
        const listResp2 = await client2.sendJsonRpc(client2.endpointPath!, {
            jsonrpc: '2.0', id: 1001, method: 'tools/list', params: {}
        });
        assert.ok(listResp2.result && Array.isArray(listResp2.result.tools), 'tools/list (new session) should return tools');
        const ccResp2 = await client2.sendJsonRpc(client2.endpointPath!, {
            jsonrpc: '2.0', id: 1002, method: 'tools/call', params: { name: 'code_checker', arguments: {} }
        });
        assert.ok(ccResp2.result, 'code_checker (new session) result should be present');

        // 6) BUG REPRO: Intentionally POST to the OLD endpoint (stale sessionId),
        // expecting the server to still accept (desired behavior for robustness),
        // but current implementation rejects with 400, so this test SHOULD FAIL today.
        let postError: any | undefined;
        try {
            await client2.sendJsonRpc(firstEndpoint, {
                jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'code_checker', arguments: {} }
            }, 6000);
        } catch (e) {
            postError = e;
        }

        // Intentionally assert success to make the test fail and highlight the issue
        assert.ifError(postError); // will throw if postError is set
    });
});
