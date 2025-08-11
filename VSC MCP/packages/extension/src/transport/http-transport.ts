import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import * as http from 'node:http';
import * as vscode from 'vscode';

export class HTTPServerTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  
  private httpServer?: http.Server;
  private pendingResponses = new Map<string | number, (resp: JSONRPCMessage) => void>();

  constructor(
    private readonly port: number,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.httpServer.on('error', (error) => {
        this.outputChannel.appendLine(`HTTP Server error: ${error.message}`);
        this.onerror?.(error);
        reject(error);
      });

      this.httpServer.listen(this.port, () => {
        this.outputChannel.appendLine(`HTTP Server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          this.outputChannel.appendLine('HTTP Server closed');
          this.onclose?.();
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/mcp') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          const message: JSONRPCMessage = JSON.parse(body);
          this.handleMessage(message, res);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.outputChannel.appendLine(`Failed to parse JSON: ${errorMessage}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }

  private handleMessage(message: JSONRPCMessage, res: http.ServerResponse): void {
    if ('id' in message && message.id !== undefined) {
      // This is a request that expects a response
      this.pendingResponses.set(message.id, (response: JSONRPCMessage) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      });
    }

    // Forward message to MCP server
    this.onmessage?.(message);

    // If this is a notification (no id), send empty response
    if (!('id' in message) || message.id === undefined) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    }
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve) => {
      if ('id' in message && message.id !== undefined) {
        // This is a response to a previous request
        const responseHandler = this.pendingResponses.get(message.id);
        if (responseHandler) {
          responseHandler(message);
          this.pendingResponses.delete(message.id);
        }
      }
      resolve();
    });
  }
}