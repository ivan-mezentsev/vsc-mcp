import express from 'express';
import * as http from 'node:http';
import * as vscode from 'vscode';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

/**
 * HTTP server that exposes MCP over SSE:
 * - GET /sse: establish SSE stream (server -> client)
 * - POST /    : client -> server JSON-RPC message
 * - Hand-over endpoints retained: /ping, /request-handover
 */
export class SseHttpServer {
  onServerStatusChanged?: (status: 'running' | 'stopped' | 'starting') => void;
  #serverStatus: 'running' | 'stopped' | 'starting' = 'stopped';

  private httpServer?: http.Server;
  // Track active SSE transports by sessionId
  private transports: Record<string, SSEServerTransport> = {};
  // Heartbeat timers per active session
  private heartbeats: Record<string, NodeJS.Timeout> = {};

  public get serverStatus(): 'running' | 'stopped' | 'starting' {
    return this.#serverStatus;
  }

  private set serverStatus(status: 'running' | 'stopped' | 'starting') {
    this.#serverStatus = status;
    this.onServerStatusChanged?.(status);
  }

  public get isServerRunning(): boolean {
    return this.serverStatus === 'running';
  }

  constructor(
    readonly listenPort: number,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly mcpServer: McpServer,
  ) {}

  async requestHandover(): Promise<boolean> {
    this.outputChannel.appendLine('Requesting server handover');
    this.serverStatus = 'starting';
    try {
      const response = await fetch(`http://localhost:${this.listenPort}/request-handover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json() as { success: boolean };

      if (data.success) {
        this.outputChannel.appendLine('Handover request accepted');
        this.outputChannel.appendLine('Waiting 1 second before starting server...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
          await this.start();
          this.outputChannel.appendLine('Server restarted after successful handover');
          return true;
        } catch (startErr) {
          const startErrorMessage = startErr instanceof Error ? startErr.message : String(startErr);
          this.outputChannel.appendLine(`Failed to restart server after handover: ${startErrorMessage}`);
          return false;
        }
      }
      this.outputChannel.appendLine('Handover request rejected');
      return false;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`Handover request failed: ${errorMessage}`);
      this.outputChannel.appendLine('Waiting 1 second before starting server...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        await this.start();
        this.outputChannel.appendLine('Server started after failed handover request');
        return true;
      } catch (startErr) {
        const startErrorMessage = startErr instanceof Error ? startErr.message : String(startErr);
        this.outputChannel.appendLine(`Failed to start server: ${startErrorMessage}`);
        return false;
      }
    }
  }

  async start(): Promise<void> {
    this.serverStatus = 'starting';

    const app = express();
    app.use((req, _res, next) => {
      this.outputChannel.appendLine(`[HTTP] ${req.method} ${req.url}`);
      next();
    });

    app.get('/ping', (_req, res) => {
      const response = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        serverRunning: this.isServerRunning,
      };
      res.send(response);
    });

    app.post('/request-handover', express.json(), (_req, res) => {
      this.outputChannel.appendLine('Received handover request');
      res.send({ success: true });
      // Stop accepting new connections and close existing ones
      if (this.httpServer) {
        this.outputChannel.appendLine('Stopping server due to handover request');
        this.httpServer.close();
        this.httpServer = undefined;
      }
      void this.closeCurrentConnection();
      this.serverStatus = 'stopped';
      this.outputChannel.appendLine('Server is now not running due to handover request');
    });

    // SSE stream for server -> client
    app.get('/sse', async (req, res) => {
      this.outputChannel.appendLine('New SSE connection');
      // Also advertise absolute POST endpoint via headers for clients that rely on them
      try {
        const host = (req.headers['host'] ?? `localhost:${this.listenPort}`) as string;
        const absolutePostUrl = `http://${host}/messages`;
        res.setHeader('Link', `<${absolutePostUrl}>; rel="mcp"; type="application/json"`);
        res.setHeader('X-MCP-Post', absolutePostUrl);
      } catch { /* ignore header set errors */ }

      // Instantiate SDK SSE transport and advertise POST endpoint as a relative path
      // The SDK will include proper headers for clients to discover the POST target.
      const transport = new SSEServerTransport('/messages', res);
      this.transports[transport.sessionId] = transport;

      // Heartbeat to keep SSE alive through proxies/clients
      try {
        const timer = setInterval(() => {
          try {
            res.write(`: ping ${Date.now()}\n\n`);
          } catch {
            clearInterval(timer);
          }
        }, 25000);
        this.heartbeats[transport.sessionId] = timer;
      } catch { /* ignore */ }

      res.on('close', () => {
        delete this.transports[transport.sessionId];
        const hb = this.heartbeats[transport.sessionId];
        if (hb) {
          clearInterval(hb);
          delete this.heartbeats[transport.sessionId];
        }
        this.outputChannel.appendLine(`SSE connection closed (sessionId: ${transport.sessionId})`);
      });
      res.on('error', () => {
        const hb = this.heartbeats[transport.sessionId];
        if (hb) {
          clearInterval(hb);
          delete this.heartbeats[transport.sessionId];
        }
      });

      try {
        await this.mcpServer.connect(transport);
        this.outputChannel.appendLine('MCP server connected to SSE transport');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.outputChannel.appendLine('Failed to connect MCP server to SSE transport: ' + msg);
        try { res.end(); } catch { /* ignore */ }
        delete this.transports[transport.sessionId];
      }
    });

  // Client -> server JSON-RPC message intake (session-aware)
  // Provide parsed JSON body for the SDK handler
  const handlePost = async (req: express.Request, res: express.Response) => {
      const sessionId = req.query.sessionId as string | undefined;
      // Prefer explicit session; fallback to the only active one if unique
      let transport = sessionId ? this.transports[sessionId] : undefined;
      if (!transport) {
        const ids = Object.keys(this.transports);
        if (!sessionId && ids.length === 1) {
          transport = this.transports[ids[0]];
        }
      }
      if (!transport) {
        this.outputChannel.appendLine(`No transport found for sessionId: ${sessionId ?? '<none>'}`);
        res.status(400).send('No transport found for session');
        return;
      }

      try {
        await transport.handlePostMessage(req, res, req.body);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.outputChannel.appendLine('Error handling POST message: ' + msg);
        res.status(500).send('Internal Server Error');
        return;
      }

      // Transition to running after tool list is requested (first handshake)
      try {
        const body = (req as any).body as JSONRPCMessage | undefined; // may be undefined; best-effort
        const method = (body as any)?.method as string | undefined;
        if (method === 'tools/list' && this.serverStatus !== 'running') {
          this.serverStatus = 'running';
        }
      } catch { /* ignore */ }
    };

    // Primary endpoint
    app.post('/messages', express.json(), handlePost);
    // Compatibility fallbacks
    app.post('/sse', express.json(), handlePost);
    app.post('/', express.json(), handlePost);

    // Start listening
    const startServer = (port: number): Promise<number> => {
      return new Promise((resolve, reject) => {
        const server = app.listen(port)
          .once('listening', () => {
            this.httpServer = server;
            try {
              // Avoid timing out long-lived SSE connections
              server.requestTimeout = 0;
              // In Node 18+, 0 disables; for typings, cast if needed
              // @ts-ignore
              server.headersTimeout = 0;
              server.keepAliveTimeout = 120000;
            } catch { /* ignore */ }
            this.outputChannel.appendLine(`MCP (SSE) HTTP server listening at :${port}`);
            resolve(port);
          })
          .once('error', (err: NodeJS.ErrnoException) => {
            this.outputChannel.appendLine(`Failed to listen on port ${port}: ${err.message}`);
            reject(err);
          });
      });
    };

    try {
  await startServer(this.listenPort);
  // Consider server running when HTTP listener is ready
  this.serverStatus = 'running';
  this.outputChannel.appendLine('SSE server is ready for client connection');
    } catch (err) {
      this.serverStatus = 'stopped';
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`Failed to start SSE server on port ${this.listenPort}: ${errorMessage}`);
      throw new Error(`Failed to bind to port ${this.listenPort}: ${errorMessage}`);
    }
  }

  async close(): Promise<void> {
    this.serverStatus = 'stopped';
    await this.closeCurrentConnection();
    if (this.httpServer) {
      this.outputChannel.appendLine('Closing SSE HTTP server');
      this.httpServer.close();
      this.httpServer = undefined;
    }
  }

  private async closeCurrentConnection() {
    // Close all active transports
    for (const id of Object.keys(this.transports)) {
      const t = this.transports[id];
      try { await t.close(); } catch { /* ignore */ }
      delete this.transports[id];
    }
    try { await this.mcpServer.close(); } catch { /* ignore */ }
  }
}
