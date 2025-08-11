import * as express from 'express';
import { Server as HttpServer } from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { JSONRPCRequest, JSONRPCResponse } from '@modelcontextprotocol/sdk/types.js';

export class HttpTransport {
  private app: express.Application;
  private server: HttpServer | undefined;

  constructor(private port: number) {
    this.app = express();
    this.app.use(express.json());
    this.app.use(express.text());
    
    // Enable CORS for browser clients
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });
  }

  async start(mcpServer: McpServer) {
    // Handle MCP requests
    this.app.post('/', async (req, res) => {
      try {
        let request: JSONRPCRequest;
        
        if (typeof req.body === 'string') {
          request = JSON.parse(req.body);
        } else {
          request = req.body;
        }

        const response = await mcpServer.handleRequest(request);
        res.json(response);
      } catch (error) {
        const errorResponse: JSONRPCResponse = {
          jsonrpc: '2.0',
          id: req.body?.id || null,
          error: {
            code: -32603,
            message: `Internal error: ${error}`
          }
        };
        res.status(500).json(errorResponse);
      }
    });

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', service: 'VSC MCP' });
    });

    // Tools update notification endpoint
    this.app.post('/notify-tools-updated', (req, res) => {
      // This endpoint is used by the relay to notify that tools have been updated
      res.json({ status: 'acknowledged' });
    });

    return new Promise<void>((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        resolve();
      });
      
      this.server.on('error', (error) => {
        reject(error);
      });
    });
  }

  async stop() {
    if (this.server) {
      return new Promise<void>((resolve) => {
        this.server!.close(() => {
          this.server = undefined;
          resolve();
        });
      });
    }
  }
}