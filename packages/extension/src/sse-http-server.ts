import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import * as http from 'node:http';
import * as vscode from 'vscode';
import { arePathsEqual } from './utils/path';

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
  private additionalServers: http.Server[] = [];
  private sockets = new Set<import('node:net').Socket>();
  private serverClosingPromise?: Promise<void>;
  private serverCloseResolve?: () => void;
  // Track active SSE transports by sessionId
  private transports: Record<string, SSEServerTransport> = {};
  // Track the last active transport/session id for fallback routing
  private lastActiveSessionId: string | undefined;
  // Heartbeat timers per active session
  private heartbeats: Record<string, NodeJS.Timeout> = {};
  // Queue for messages received before an SSE transport is available (after restart)
  private pendingMessages: JSONRPCMessage[] = [];
  // Periodic discovery registration timer
  private registrationTimer: NodeJS.Timeout | undefined;
  private registrationBasePort: number | undefined;
  private registrationWorkspaceFolder: string | undefined;

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
  ) { }

  async requestHandover(): Promise<boolean> {
    this.outputChannel.appendLine('Requesting server handover');
    this.serverStatus = 'starting';
    try {
      // If this process owns the server, prefer local shutdown to avoid fetch races
      if (this.httpServer) {
        await this.shutdownServer();
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
      const response = await fetch(`http://localhost:${this.listenPort}/request-handover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json() as { success: boolean };

      if (data.success) {
        this.outputChannel.appendLine('Handover request accepted');
        // Start immediately, do not wait for remote close
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
      // Ensure any existing server in this process is closed, then start
      await this.shutdownServer();
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

    // If a previous server exists, wait for it to close before starting
    await this.waitForServerClose(0).catch(() => { /* ignore */ });

    // Ensure process-local discovery sweep timer is running
    ensureDiscoverySweepTimer(this.outputChannel);

    // Create HTTP server with manual routing
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${this.listenPort}`);
      this.outputChannel.appendLine(`[HTTP] ${req.method} ${url.pathname}${url.search}`);

      // Common headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.writeHead(204);
        res.end();
        return;
      }

      // /ping health check
      if (req.method === 'GET' && url.pathname === '/ping') {
        const response = {
          status: 'ok',
          timestamp: new Date().toISOString(),
          serverRunning: this.isServerRunning,
        };
        const text = JSON.stringify(response);
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.setHeader('content-length', Buffer.byteLength(text));
        res.end(text);
        return;
      }

      // POST /register -> upsert discovery record and return full copy
      if (req.method === 'POST' && url.pathname === '/register') {
        // Lazy cleanup before handling
        discoveryLazyCleanup();
        const body = await this.readJsonBody(req).catch(() => undefined);
        if (!isRegisterBody(body)) {
          const text = JSON.stringify({ error: 'Invalid body. Expected { port: number, workspaceFolder: string }' });
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.setHeader('content-length', Buffer.byteLength(text));
          res.end(text);
          return;
        }
        discoveryUpsert(body.port, body.workspaceFolder, Date.now());
        const payload = { discovery: discoveryGetCopy() };
        const text = JSON.stringify(payload);
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.setHeader('content-length', Buffer.byteLength(text));
        res.end(text);
        return;
      }

      // GET /discovery?workspaceFolder=...
      if (req.method === 'GET' && url.pathname === '/discovery') {
        // Lazy cleanup before handling
        discoveryLazyCleanup();
        const wf = url.searchParams.get('workspaceFolder');
        if (!wf) {
          const text = JSON.stringify({ error: 'workspaceFolder is required' });
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.setHeader('content-length', Buffer.byteLength(text));
          res.end(text);
          return;
        }
        const found = discoveryFindFirstByWorkspace(wf);
        if (found) {
          const text = JSON.stringify({ port: found.port });
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.setHeader('content-length', Buffer.byteLength(text));
          res.end(text);
          return;
        }
        const text = JSON.stringify({ discovery: discoveryGetCopy() });
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.setHeader('content-length', Buffer.byteLength(text));
        res.end(text);
        return;
      }

      // POST /request-handover
      if (req.method === 'POST' && url.pathname === '/request-handover') {
        this.outputChannel.appendLine('Received handover request');
        const text = JSON.stringify({ success: true });
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.setHeader('content-length', Buffer.byteLength(text));
        res.end(text);
        // Initiate graceful shutdown
        void this.shutdownServer();
        this.serverStatus = 'stopped';
        this.outputChannel.appendLine('Server is now not running due to handover request');
        return;
      }

      // GET /sse -> establish SSE stream
      if (req.method === 'GET' && url.pathname === '/sse') {
        this.outputChannel.appendLine('New SSE connection');
        // Enforce single active client: close any existing transports first
        try {
          await this.closeCurrentConnection();
          this.outputChannel.appendLine('Closed previous SSE transports due to new connection');
        } catch { /* ignore */ }
        // Advertise absolute POST endpoint via headers
        try {
          const host = (req.headers['host'] ?? `localhost:${this.listenPort}`) as string;
          const absolutePostUrl = `http://${host}/messages`;
          res.setHeader('Link', `<${absolutePostUrl}>; rel="mcp"; type="application/json"`);
          res.setHeader('X-MCP-Post', absolutePostUrl);
        } catch { /* ignore */ }

        // Create SSE transport; Node response object is used by SDK
        const transport = new SSEServerTransport('/messages', res);
        this.transports[transport.sessionId] = transport;
        this.lastActiveSessionId = transport.sessionId;

        // Heartbeat
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
          this.outputChannel.appendLine(`SSE connection error (sessionId: ${transport.sessionId})`);
        });

        try {
          await this.mcpServer.connect(transport);
          this.outputChannel.appendLine('MCP server connected to SSE transport');
          // Flush any pending messages that arrived before SSE was connected
          if (this.pendingMessages.length > 0) {
            const toFlush = this.pendingMessages.splice(0, this.pendingMessages.length);
            for (const msg of toFlush) {
              try {
                await transport.handleMessage(msg);
              } catch (e) {
                const em = e instanceof Error ? e.message : String(e);
                this.outputChannel.appendLine('Error flushing queued message: ' + em);
              }
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.outputChannel.appendLine('Failed to connect MCP server to SSE transport: ' + msg);
          try { res.end(); } catch { /* ignore */ }
          delete this.transports[transport.sessionId];
        }
        return; // SDK handles writing SSE headers and initial events
      }

      // POST /messages[?sessionId=...]
      if (req.method === 'POST' && (url.pathname === '/messages' || url.pathname === '/sse' || url.pathname === '/')) {
        // parse body (JSON)
        const body = await this.readJsonBody(req).catch(() => undefined);
        const now = () => new Date().toISOString();
        const msgId = (() => {
          try {
            const id = (body as any)?.id;
            return typeof id === 'string' || typeof id === 'number' ? String(id) : '<no-id>';
          } catch { return '<no-id>'; }
        })();
        const method = (() => {
          try { return (body as any)?.method ?? '<unknown>'; } catch { return '<unknown>'; }
        })();
        console.error(`[sse-http] ${now()} proxy->ext POST ${url.pathname} method=${method} id=${msgId}`);
        const sessionId = url.searchParams.get('sessionId') || undefined;

        // Select transport: explicit session -> matching; else if not found -> fallback to lastActive
        let transport = sessionId ? this.transports[sessionId] : undefined;
        if (!transport && this.lastActiveSessionId) {
          transport = this.transports[this.lastActiveSessionId];
        }

        // Special server-side fallback: promote POST /sse without sessionId to establish SSE stream
        if (!transport && url.pathname === '/sse' && !sessionId) {
          this.outputChannel.appendLine('Promoting POST /sse without sessionId to SSE stream');
          // Advertise absolute POST endpoint via headers
          try {
            const host = (req.headers['host'] ?? `localhost:${this.listenPort}`) as string;
            const absolutePostUrl = `http://${host}/messages`;
            res.setHeader('Link', `<${absolutePostUrl}>; rel="mcp"; type="application/json"`);
            res.setHeader('X-MCP-Post', absolutePostUrl);
          } catch { /* ignore */ }

          // Create SSE transport bound to this response; keep connection open
          // Enforce single active client: close any previous transports
          try {
            await this.closeCurrentConnection();
            this.outputChannel.appendLine('Closed previous SSE transports due to POST /sse promotion');
          } catch { /* ignore */ }
          const newTransport = new SSEServerTransport('/messages', res);
          this.transports[newTransport.sessionId] = newTransport;
          this.lastActiveSessionId = newTransport.sessionId;

          // Heartbeat for this SSE stream
          try {
            const timer = setInterval(() => {
              try {
                res.write(`: ping ${Date.now()}\n\n`);
              } catch {
                clearInterval(timer);
              }
            }, 25000);
            this.heartbeats[newTransport.sessionId] = timer;
          } catch { /* ignore */ }

          res.on('close', () => {
            delete this.transports[newTransport.sessionId];
            const hb = this.heartbeats[newTransport.sessionId];
            if (hb) {
              clearInterval(hb);
              delete this.heartbeats[newTransport.sessionId];
            }
            this.outputChannel.appendLine(`SSE connection closed (sessionId: ${newTransport.sessionId})`);
          });
          res.on('error', () => {
            const hb = this.heartbeats[newTransport.sessionId];
            if (hb) {
              clearInterval(hb);
              delete this.heartbeats[newTransport.sessionId];
            }
            this.outputChannel.appendLine(`SSE connection error (sessionId: ${newTransport.sessionId})`);
          });

          try {
            await this.mcpServer.connect(newTransport);
            this.outputChannel.appendLine('MCP server connected to SSE transport (POST /sse)');
            console.error(`[sse-http] ${now()} ext SSE transport connected via POST /sse sessionId=${newTransport.sessionId}`);
            // If POST carried an initial JSON-RPC message, handle it as the first message
            if (body && typeof body === 'object') {
              try {
                console.error(`[sse-http] ${now()} ext handling initial POST body as message id=${msgId} method=${method}`);
                await newTransport.handleMessage(body as JSONRPCMessage);
                console.error(`[sse-http] ${now()} ext handled initial POST body id=${msgId}`);
              } catch (e) {
                const em = e instanceof Error ? e.message : String(e);
                this.outputChannel.appendLine('Error handling initial POST body as message: ' + em);
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.outputChannel.appendLine('Failed to connect MCP server to SSE transport (POST /sse): ' + msg);
            try { res.end(); } catch { /* ignore */ }
            delete this.transports[newTransport.sessionId];
          }
          // Do not end the response: keep SSE stream open
          return;
        }
        if (!transport) {
          this.outputChannel.appendLine(`No transport found for sessionId: ${sessionId ?? '<none>'}`);
          if (sessionId) {
            // Instruct client to re-establish SSE stream immediately
            try {
              const host = (req.headers['host'] ?? `localhost:${this.listenPort}`) as string;
              const absolutePostUrl = `http://${host}/messages`;
              res.statusCode = 303; // See Other — client should perform GET to Location
              res.setHeader('Location', '/sse');
              // Provide discovery headers similar to GET /sse
              res.setHeader('Link', `<${absolutePostUrl}>; rel="mcp"; type="application/json"`);
              res.setHeader('X-MCP-Post', absolutePostUrl);
              // Queue the message so it can be processed right after SSE reconnects
              if (body && typeof body === 'object') {
                try { this.pendingMessages.push(body as JSONRPCMessage); } catch { /* ignore */ }
              }
              res.end();
            } catch {
              // Fallback: respond with 400 to avoid silent hangs
              res.statusCode = 400;
              res.setHeader('content-type', 'text/plain');
              const text = 'No transport found for session';
              res.setHeader('content-length', Buffer.byteLength(text));
              res.end(text);
            }
          } else {
            // Without sessionId, fail fast to prevent long waits
            res.statusCode = 400;
            res.setHeader('content-type', 'text/plain');
            const text = 'No transport found for session';
            res.setHeader('content-length', Buffer.byteLength(text));
            res.end(text);
          }
          return;
        }

        try {
          console.error(`[sse-http] ${now()} ext handling POST message id=${msgId} method=${method} sessionId=${transport.sessionId}`);
          await transport.handlePostMessage(req as any, res, body);
          console.error(`[sse-http] ${now()} ext handled POST message id=${msgId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.outputChannel.appendLine('Error handling POST message: ' + msg);
          console.error(`[sse-http] ${now()} ext ERROR handling POST id=${msgId} message=${msg}`);
          res.statusCode = 500;
          res.setHeader('content-type', 'text/plain');
          res.end('Internal Server Error');
          return;
        }

        // Transition to running after tool list is requested (first handshake)
        try {
          const method = (body as JSONRPCMessage | undefined as any)?.method as string | undefined;
          if (method === 'tools/list' && this.serverStatus !== 'running') {
            this.serverStatus = 'running';
          }
        } catch { /* ignore */ }
        return;
      }

      // Fallback 404
      res.statusCode = 404;
      res.setHeader('content-type', 'text/plain');
      res.end('Not Found');
    });

    // Configure timeouts suitable for SSE
    server.requestTimeout = 0;
    // @ts-ignore
    server.headersTimeout = 0;
    server.keepAliveTimeout = 120000;

    // Track sockets to ensure prompt shutdown
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });

    // Prepare close notification
    server.on('close', () => {
      this.httpServer = undefined;
      if (this.serverCloseResolve) {
        this.serverCloseResolve();
        this.serverCloseResolve = undefined;
        this.serverClosingPromise = undefined;
      }
    });

    // Start listening
    try {
      await this.listenWithRetry(server, this.listenPort, 3, 300);
    } catch (err) {
      this.serverStatus = 'stopped';
      throw err;
    }

    // Consider server running when HTTP listener is ready
    this.serverStatus = 'running';
    this.outputChannel.appendLine('SSE server is ready for client connection');
  }

  async close(): Promise<void> {
    this.serverStatus = 'stopped';
    // Stop registration timer
    if (this.registrationTimer) {
      try { clearInterval(this.registrationTimer); } catch { /* ignore */ }
      this.registrationTimer = undefined;
    }
    // Close additional listeners
    for (const srv of this.additionalServers.splice(0)) {
      try { srv.close(); } catch { /* ignore */ }
    }
    await this.closeCurrentConnection();
    if (this.httpServer) {
      this.outputChannel.appendLine('Closing SSE HTTP server');
      this.httpServer.close();
      this.httpServer = undefined;
    }
    // Explicit stop should fully close MCP server
    try { await this.mcpServer.close(); } catch { /* ignore */ }
  }

  private async closeCurrentConnection() {
    // Close all active transports
    for (const id of Object.keys(this.transports)) {
      const t = this.transports[id];
      try { await t.close(); } catch { /* ignore */ }
      delete this.transports[id];
    }
    this.lastActiveSessionId = undefined;
    // Do NOT close the MCP server here to preserve tool registry/state across restarts
  }

  // Read and parse JSON body from Node http request
  private readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          if (!text) return resolve(undefined);
          resolve(JSON.parse(text));
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }

  // ======= Additional listening support =======
  /**
   * Try to additionally listen on a base port without restarting the main instance.
   * Returns true on success, false if port is occupied or bind failed.
   */
  public async listenAdditionally(port: number): Promise<boolean> {
    if (port === this.listenPort) {
      return true; // already listening on this port as primary
    }
    // If already bound on this port, return
    if (this.additionalServers.some((s) => (s.address() as any)?.port === port)) {
      return true;
    }
    const server = http.createServer(this.httpServer?.listeners('request')[0] as any);
    // mirror timeouts
    server.requestTimeout = 0;
    // @ts-ignore
    server.headersTimeout = 0;
    server.keepAliveTimeout = 120000;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', (err: NodeJS.ErrnoException) => {
          server.removeAllListeners('listening');
          reject(err);
        });
        server.once('listening', () => {
          server.removeAllListeners('error');
          this.additionalServers.push(server);
          resolve();
        });
        server.listen(port);
      });
      this.outputChannel.appendLine(`MCP (SSE) added listening at :${port}`);
      return true;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'EADDRINUSE') {
        return false;
      }
      return false;
    }
  }

  /** Lightweight /ping probe with timeout ms. */
  public static async probePing(port: number, timeoutMs: number): Promise<boolean> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    try {
      const res = await fetch(`http://localhost:${port}/ping`, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  }


  // Shutdown server and connections, await close
  private async shutdownServer(): Promise<void> {
    // Close transports first to end SSE responses
    await this.closeCurrentConnection();
    if (this.httpServer) {
      this.outputChannel.appendLine('Stopping server due to shutdown request');
      const srv = this.httpServer;
      // Create wait promise
      if (!this.serverClosingPromise) {
        this.serverClosingPromise = new Promise<void>((resolve) => { this.serverCloseResolve = resolve; });
      }
      srv.close();
      // Destroy any lingering sockets after a short grace period
      setTimeout(() => {
        for (const s of Array.from(this.sockets)) {
          try { s.destroy(); } catch { /* ignore */ }
        }
      }, 200);
      await this.waitForServerClose(3000).catch(() => { /* ignore */ });
    }
  }

  // Await server close if in progress
  private async waitForServerClose(timeoutMs: number): Promise<void> {
    if (!this.httpServer) return;
    if (!this.serverClosingPromise) {
      this.serverClosingPromise = new Promise<void>((resolve) => { this.serverCloseResolve = resolve; });
      // If server is still open, ask it to close politely without dropping if not requested elsewhere
      try { this.httpServer.close(); } catch { /* ignore */ }
    }
    if (timeoutMs <= 0) {
      await this.serverClosingPromise;
      return;
    }
    await Promise.race([
      this.serverClosingPromise,
      new Promise<void>((_, rej) => setTimeout(() => rej(new Error('close timeout')), timeoutMs)),
    ]).catch(() => { /* ignore timeout */ });
  }

  // Listen with retry on EADDRINUSE
  private async listenWithRetry(server: http.Server, port: number, retries: number, backoffMs: number): Promise<void> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', (err: NodeJS.ErrnoException) => {
            server.removeAllListeners('listening');
            reject(err);
          });
          server.once('listening', () => {
            server.removeAllListeners('error');
            this.httpServer = server;
            this.outputChannel.appendLine(`MCP (SSE) HTTP server listening at :${port}`);
            resolve();
          });
          server.listen(port);
        });
        return; // success
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        this.outputChannel.appendLine(`Failed to listen on port ${port}: ${e.message}`);
        if (e.code === 'EADDRINUSE' && attempt < retries) {
          await new Promise(r => setTimeout(r, backoffMs * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  }

  // ======= Discovery registration (periodic) =======
  /**
   * Schedule periodic POST /register against the basePort and sync local discovery copy.
   * Performs an immediate registration once and then every intervalMs.
   */
  public scheduleDiscoveryRegistration(opts: RegistrationOptions): void {
    const intervalMs = Math.max(1000, opts.intervalMs ?? 60_000);
    this.registrationBasePort = opts.basePort;
    this.registrationWorkspaceFolder = opts.workspaceFolder;
    const makeBody = () => ({ port: this.listenPort, workspaceFolder: this.registrationWorkspaceFolder! });

    const doRegister = async () => {
      try {
        // Lazy cleanup of our local store before merging remote
        discoveryLazyCleanup();
        const res = await fetch(`http://localhost:${this.registrationBasePort}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(makeBody()),
        });
        if (!res.ok) return; // silent per requirements
        const json = await res.json() as { discovery?: unknown };
        const copy = json?.discovery;
        if (isDiscoveryArray(copy)) {
          discoveryReplaceAll(copy);
        }
      } catch {
        // Silent failure by design
      }
    };

    // Clear previous interval if any
    if (this.registrationTimer) {
      try { clearInterval(this.registrationTimer); } catch { /* ignore */ }
      this.registrationTimer = undefined;
    }
    // Fire immediately and then schedule
    void doRegister();
    try {
      this.registrationTimer = setInterval(() => { void doRegister(); }, intervalMs);
    } catch { /* ignore */ }
  }
}

// ======= DiscoveryStore (process-local) =======

type DiscoveryRecord = {
  port: number;
  workspaceFolder: string; // stored as provided, not normalized
  lastSeen: number; // unix ms
};

const DISCOVERY_TTL_MS = 120_000; // 120s
const DISCOVERY_SWEEP_INTERVAL_MS = 60_000; // 60s

const discoveryStore: DiscoveryRecord[] = [];
let discoverySweepTimer: NodeJS.Timeout | undefined;

function ensureDiscoverySweepTimer(output: vscode.OutputChannel | undefined): void {
  if (discoverySweepTimer) return;
  try {
    discoverySweepTimer = setInterval(() => {
      try {
        discoveryRemoveExpired(Date.now());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        output?.appendLine(`[discovery] sweep error: ${msg}`);
      }
    }, DISCOVERY_SWEEP_INTERVAL_MS);
  } catch { /* ignore */ }
}

function discoveryLazyCleanup(): void {
  try { discoveryRemoveExpired(Date.now()); } catch { /* ignore */ }
}

function discoveryRemoveExpired(now: number): void {
  for (let i = discoveryStore.length - 1; i >= 0; i--) {
    const r = discoveryStore[i];
    if (now - r.lastSeen > DISCOVERY_TTL_MS) {
      discoveryStore.splice(i, 1);
    }
  }
}

function discoveryUpsert(port: number, workspaceFolder: string, now: number): void {
  // unique by port; keep insertion order stable
  const idx = discoveryStore.findIndex((r) => r.port === port);
  if (idx >= 0) {
    const rec = discoveryStore[idx];
    rec.workspaceFolder = workspaceFolder;
    rec.lastSeen = now;
    return;
  }
  discoveryStore.push({ port, workspaceFolder, lastSeen: now });
}

function discoveryFindFirstByWorkspace(workspaceFolder: string): DiscoveryRecord | undefined {
  for (const r of discoveryStore) {
    if (arePathsEqual(r.workspaceFolder, workspaceFolder)) {
      return r;
    }
  }
  return undefined;
}

function discoveryGetCopy(): DiscoveryRecord[] {
  return discoveryStore.map((r) => ({ ...r }));
}

function isRegisterBody(v: unknown): v is { port: number; workspaceFolder: string } {
  if (!v || typeof v !== 'object') return false;
  const port = (v as Record<string, unknown>).port;
  const wf = (v as Record<string, unknown>).workspaceFolder;
  return typeof port === 'number' && Number.isFinite(port) && port > 0 && typeof wf === 'string' && wf.length > 0;
}

function isDiscoveryArray(v: unknown): v is DiscoveryRecord[] {
  if (!Array.isArray(v)) return false;
  return v.every((r) => r && typeof r === 'object'
    && typeof (r as any).port === 'number'
    && Number.isFinite((r as any).port)
    && (r as any).port > 0
    && typeof (r as any).workspaceFolder === 'string'
    && typeof (r as any).lastSeen === 'number');
}

function discoveryReplaceAll(copy: DiscoveryRecord[]): void {
  // Replace the local store contents preserving array instance identity is not required
  discoveryStore.length = 0;
  const now = Date.now();
  for (const r of copy) {
    // Clamp lastSeen forward if too old (keeps TTL semantics sane)
    const lastSeen = typeof r.lastSeen === 'number' ? r.lastSeen : now;
    discoveryStore.push({ port: r.port, workspaceFolder: r.workspaceFolder, lastSeen });
  }
  // Drop any expired immediately
  discoveryRemoveExpired(Date.now());
}

// ======= Discovery registration (periodic) =======

export interface RegistrationOptions {
  basePort: number;
  workspaceFolder: string;
  intervalMs?: number; // default 60s
}
