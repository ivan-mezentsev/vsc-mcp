#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  CallToolResult, 
  JSONRPCRequest, 
  JSONRPCResponse, 
  ListToolsRequestSchema, 
  ListToolsResult 
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { initialTools } from './initial-tools.js';

const CACHE_DIR = path.join(os.homedir(), '.vsc-mcp-relay-cache');
const TOOLS_CACHE_FILE = path.join(CACHE_DIR, 'tools-list-cache.json');
const MAX_RETRIES = 3;
const RETRY_INTERVAL = 1000;

class VscMcpRelay {
  private mcpServer: McpServer;
  private disabledTools: Set<string>;
  private enabledTools: Set<string> | null;

  constructor(
    readonly serverUrl: string, 
    disabledTools: string[] = [], 
    enabledTools: string[] = []
  ) {
    this.disabledTools = new Set(disabledTools);
    this.enabledTools = enabledTools.length > 0 ? new Set(enabledTools) : null;
    
    this.mcpServer = new McpServer({
      name: 'vsc-mcp',
      version: '1.0.0',
    }, {
      capabilities: {
        tools: {},
      },
    });

    // Periodically update tools list
    setInterval(async () => {
      await this.updateToolsCache();
    }, 3600000); // Every hour

    this.setupHandlers();
  }

  private setupHandlers() {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
      const cachedTools = await this.getToolsCache() ?? initialTools;

      let tools: any[];
      try {
        const response = await this.requestWithRetry(this.serverUrl, JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          params: {},
          id: Math.floor(Math.random() * 1000000),
        } as JSONRPCRequest));
        
        const parsedResponse = response as JSONRPCResponse;
        tools = parsedResponse.result.tools as any[];
      } catch (error) {
        console.error(`Failed to fetch tools list: ${(error as Error).message}`);
        const filteredCachedTools = this.filterTools(cachedTools);
        return { tools: filteredCachedTools as any[] };
      }

      // Update cache
      try {
        await this.saveToolsCache(tools);
      } catch (cacheError) {
        console.error(`Failed to cache tools response: ${(cacheError as Error).message}`);
      }

      const filteredTools = this.filterTools(tools);
      return { tools: filteredTools };
    });

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      try {
        const response = await this.requestWithRetry(this.serverUrl, JSON.stringify({
          jsonrpc: '2.0',
          method: request.method,
          params: request.params,
          id: Math.floor(Math.random() * 1000000),
        } as JSONRPCRequest));
        
        const parsedResponse = response as JSONRPCResponse;
        return parsedResponse.result as any;
      } catch (error) {
        console.error(`Failed to call tool: ${(error as Error).message}`);
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `Failed to communicate with VSC MCP Extension. Please ensure that the VSC MCP Extension is installed and "VSC MCP" is displayed in the status bar.`,
          }],
        };
      }
    });
  }

  private async updateToolsCache(): Promise<void> {
    try {
      const response = await this.requestWithRetry(this.serverUrl, JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: Math.floor(Math.random() * 1000000),
      } as JSONRPCRequest));
      
      const parsedResponse = response as JSONRPCResponse;
      const tools = parsedResponse.result.tools as any[];
      const filteredTools = this.filterTools(tools);
      
      const cachedTools = await this.getToolsCache();
      
      if (cachedTools && cachedTools.length === filteredTools.length) {
        console.error('Tools list unchanged, not updating cache');
        return;
      }

      try {
        await this.requestWithRetry(this.serverUrl + '/notify-tools-updated', '');
      } catch (error) {
        console.error(`Failed to notify tools updated: ${(error as Error).message}`);
      }

      await this.saveToolsCache(filteredTools);
    } catch (error) {
      console.error(`Failed to update tools cache: ${(error as Error).message}`);
    }
  }

  private async initCacheDir(): Promise<void> {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        console.error(`Failed to initialize cache directory: ${(error as Error).message}`);
      }
    }
  }

  private async saveToolsCache(tools: any[]): Promise<void> {
    await this.initCacheDir();
    try {
      await fs.writeFile(TOOLS_CACHE_FILE, JSON.stringify(tools), 'utf8');
      console.error('Tools list cache saved');
    } catch (error) {
      console.error(`Failed to save cache: ${(error as Error).message}`);
    }
  }

  private async getToolsCache(): Promise<any[] | null> {
    try {
      await fs.access(TOOLS_CACHE_FILE);
      const cacheData = await fs.readFile(TOOLS_CACHE_FILE, 'utf8');
      return JSON.parse(cacheData) as any[];
    } catch (error) {
      console.error(`Failed to load cache file: ${(error as Error).message}`);
      return null;
    }
  }

  private async requestWithRetry(url: string, body: string): Promise<unknown> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.error(`Retry attempt ${attempt + 1}/${MAX_RETRIES}`);
        await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
      }

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: body,
        });

        const responseText = await response.text();

        if (response.status >= 500) {
          lastError = new Error(`Request failed with status ${response.status}: ${responseText}`);
          continue;
        }

        return JSON.parse(responseText);
      } catch (error) {
        lastError = error as Error;
      }
    }

    throw new Error(`All retry attempts failed: ${lastError?.message}`);
  }

  private filterTools(tools: any[]): any[] {
    return tools.filter(tool => {
      if (this.enabledTools !== null) {
        return this.enabledTools.has(tool.name);
      }
      return !this.disabledTools.has(tool.name);
    }).map(tool => this.sanitizeToolSchema(tool));
  }

  private sanitizeToolSchema(tool: any): any {
    if (!tool.inputSchema) {
      return tool;
    }

    const sanitizedTool = JSON.parse(JSON.stringify(tool));
    
    const sanitizeSchema = (schema: any): any => {
      if (typeof schema !== 'object' || schema === null) {
        return schema;
      }

      const sanitized = { ...schema };
      
      // Remove unsupported meta-schema features
      delete sanitized.$dynamicRef;
      delete sanitized.$dynamicAnchor;
      delete sanitized.$recursiveRef;
      delete sanitized.$recursiveAnchor;
      
      // Downgrade schema version to draft-07
      if (sanitized.$schema && sanitized.$schema.includes('2020-12')) {
        sanitized.$schema = 'http://json-schema.org/draft-07/schema#';
      }
      
      // Recursively sanitize nested objects
      Object.keys(sanitized).forEach(key => {
        if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
          if (Array.isArray(sanitized[key])) {
            sanitized[key] = sanitized[key].map((item: any) => 
              typeof item === 'object' ? sanitizeSchema(item) : item
            );
          } else {
            sanitized[key] = sanitizeSchema(sanitized[key]);
          }
        }
      });
      
      return sanitized;
    };

    sanitizedTool.inputSchema = sanitizeSchema(sanitizedTool.inputSchema);
    return sanitizedTool;
  }

  start() {
    return this.mcpServer.connect(new StdioServerTransport());
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  let serverUrl = 'http://localhost:60100';
  const disabledTools: string[] = [];
  const enabledTools: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server-url' && i + 1 < args.length) {
      serverUrl = args[i + 1];
      i++;
    } else if (args[i] === '--disable' && i + 1 < args.length) {
      disabledTools.push(args[i + 1]);
      i++;
    } else if (args[i] === '--enable' && i + 1 < args.length) {
      enabledTools.push(args[i + 1]);
      i++;
    }
  }

  return { serverUrl, disabledTools, enabledTools };
}

try {
  const { serverUrl, disabledTools, enabledTools } = parseArgs();
  const relay = new VscMcpRelay(serverUrl, disabledTools, enabledTools);
  await relay.start();
} catch (error) {
  console.error(`Fatal error: ${(error as Error).message}`);
  process.exit(1);
}