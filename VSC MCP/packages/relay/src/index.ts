#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initialTools } from './initial-tools';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: {
    tools?: Tool[];
    [key: string]: unknown;
  };
  error?: {
    message: string;
    code: number;
    data?: unknown;
  };
}

interface RelayArgs {
  serverUrl?: string;
  enable?: string[];
  disable?: string[];
  cacheDir?: string;
}

class VSCMCPRelay {
  private mcpServer: McpServer;
  private serverUrl: string;
  private enabledTools: Set<string> | null = null;
  private disabledTools: Set<string> = new Set();
  private cacheFile: string;
  private cachedTools: Tool[] = [];

  constructor(args: RelayArgs) {
    this.serverUrl = args.serverUrl || 'http://localhost:60100';
    this.cacheFile = path.join(args.cacheDir || os.tmpdir(), 'vsc-mcp-tools-cache.json');
    
    if (args.enable) {
      this.enabledTools = new Set(args.enable);
    }
    if (args.disable) {
      this.disabledTools = new Set(args.disable);
    }

    this.mcpServer = new McpServer({
      name: 'vsc-mcp-relay',
      version: '1.0.0'
    }, {
      capabilities: {
        tools: {}
      }
    });

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = await this.getFilteredTools();
      return { tools };
    });

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      try {
        const response = await fetch(`${this.serverUrl}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result: unknown = await response.json();
        
        // Type guard for proper return type
        if (typeof result === 'object' && result !== null) {
          return result as { [key: string]: unknown };
        }
        
        return { content: [{ type: 'text', text: `Unexpected response type: ${typeof result}` }], isError: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to execute tool: ${errorMessage}` }],
        };
      }
    });
  }

  private async getFilteredTools(): Promise<Tool[]> {
    try {
      const tools = await this.fetchToolsWithCache();
      return this.filterTools(tools);
    } catch (error) {
      console.error('Failed to fetch tools from server, using cached tools or fallback');
      const cachedTools = this.loadCachedTools();
      return this.filterTools(cachedTools.length > 0 ? cachedTools : initialTools);
    }
  }

  private async fetchToolsWithCache(): Promise<Tool[]> {
    try {
      const response = await this.fetchToolsFromServer();
      
      // Cache the successful response
      this.cacheTools(response);
      return response;
    } catch (error) {
      console.error('Failed to fetch tools from server, trying cache...');
      
      // Try to load from cache
      const cachedTools = this.loadCachedTools();
      if (cachedTools.length > 0) {
        return cachedTools;
      }
      
      throw error;
    }
  }

  private async fetchToolsFromServer(): Promise<Tool[]> {
    const listToolsRequest = {
      jsonrpc: '2.0' as const,
      id: Date.now(),
      method: 'tools/list',
      params: {}
    };

    const response = await fetch(`${this.serverUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(listToolsRequest),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const parsedResponseData: unknown = await response.json();
    
    // Type guard for JSON-RPC response
    if (typeof parsedResponseData !== 'object' || parsedResponseData === null) {
      throw new Error('Invalid response format');
    }
    
    const parsedResponse = parsedResponseData as JsonRpcResponse;
    
    if (parsedResponse.error) {
      throw new Error(`Server error: ${parsedResponse.error.message}`);
    }

    return parsedResponse.result?.tools || [];
  }

  private filterTools(tools: Tool[]): Tool[] {
    return tools.filter(tool => {
      // If enabledTools is set, only include tools in that set
      if (this.enabledTools) {
        return this.enabledTools.has(tool.name);
      }
      
      // Otherwise, exclude tools in disabledTools set
      return !this.disabledTools.has(tool.name);
    });
  }

  private cacheTools(tools: Tool[]): void {
    try {
      const cacheData = {
        timestamp: Date.now(),
        tools
      };
      fs.writeFileSync(this.cacheFile, JSON.stringify(cacheData, null, 2));
    } catch (error) {
      console.error('Failed to cache tools:', error);
    }
  }

  private loadCachedTools(): Tool[] {
    try {
      if (!fs.existsSync(this.cacheFile)) {
        return [];
      }

      const cacheData = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      
      // Check if cache is not too old (1 hour)
      const cacheAge = Date.now() - cacheData.timestamp;
      if (cacheAge > 60 * 60 * 1000) {
        return [];
      }

      return cacheData.tools || [];
    } catch (error) {
      console.error('Failed to load cached tools:', error);
      return [];
    }
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
  }
}

function parseArgs(): RelayArgs {
  const args: RelayArgs = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    
    if (arg === '--server-url' || arg === '-s') {
      args.serverUrl = argv[++i];
    } else if (arg === '--enable') {
      const tools = argv[++i];
      args.enable = tools.split(',').map(t => t.trim());
    } else if (arg === '--disable') {
      const tools = argv[++i];
      args.disable = tools.split(',').map(t => t.trim());
    } else if (arg === '--cache-dir') {
      args.cacheDir = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
VSC MCP Relay - Connect external MCP clients to VSCode

Usage: npx vsc-mcp-relay [options]

Options:
  --server-url, -s <url>    VSCode MCP server URL (default: http://localhost:60100)
  --enable <tools>          Comma-separated list of tools to enable (exclusive)
  --disable <tools>         Comma-separated list of tools to disable
  --cache-dir <dir>         Directory for tool cache (default: system temp)
  --help, -h                Show this help

Examples:
  npx vsc-mcp-relay
  npx vsc-mcp-relay --server-url http://localhost:8080
  npx vsc-mcp-relay --disable debug_tools,terminal_tools
  npx vsc-mcp-relay --enable text_editor,execute_command
      `);
      process.exit(0);
    }
  }

  return args;
}

async function main(): Promise<void> {
  try {
    const args = parseArgs();
    const relay = new VSCMCPRelay(args);
    await relay.start();
  } catch (error) {
    console.error('Failed to start VSC MCP Relay:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}