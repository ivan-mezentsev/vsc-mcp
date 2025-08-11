import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface SearchSymbolParams {
  query: string;
  type?: 'all' | 'files' | 'symbols';
}

export function registerSearchSymbolTool(server: McpServer, registerTool: (tool: any) => void) {
  const tool = {
    name: 'search_symbol',
    description: 'Search for symbols, files, or text in workspace',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string'
        },
        type: {
          type: 'string',
          enum: ['all', 'files', 'symbols'],
          default: 'all',
          description: 'Type of search to perform'
        }
      },
      required: ['query']
    }
  };

  registerTool(tool);

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    if (request.params.name !== 'search_symbol') {
      return { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] };
    }

    const params = request.params.arguments as SearchSymbolParams;
    return handleSearchSymbol(params);
  });
}

async function handleSearchSymbol(params: SearchSymbolParams): Promise<CallToolResult> {
  try {
    const { query, type = 'all' } = params;

    switch (type) {
      case 'files':
        return await searchFiles(query);
      case 'symbols':
        return await searchSymbols(query);
      case 'all':
      default:
        const fileResults = await searchFiles(query);
        const symbolResults = await searchSymbols(query);
        
        const combinedText = `File search results:\n${fileResults.content[0].text}\n\nSymbol search results:\n${symbolResults.content[0].text}`;
        return {
          content: [{ type: 'text', text: combinedText }]
        };
    }
  } catch (error) {
    return {
      isError: true,
      content: [{ 
        type: 'text', 
        text: `Search failed: ${error instanceof Error ? error.message : String(error)}` 
      }]
    };
  }
}

async function searchFiles(query: string): Promise<CallToolResult> {
  try {
    // Use VSCode's file search
    const files = await vscode.workspace.findFiles(`**/*${query}*`, '**/node_modules/**', 20);
    
    if (files.length === 0) {
      return {
        content: [{ type: 'text', text: `No files found matching: ${query}` }]
      };
    }

    const fileList = files.map(file => file.fsPath).join('\n');
    return {
      content: [{ type: 'text', text: `Files matching "${query}":\n${fileList}` }]
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ 
        type: 'text', 
        text: `File search failed: ${error instanceof Error ? error.message : String(error)}` 
      }]
    };
  }
}

async function searchSymbols(query: string): Promise<CallToolResult> {
  try {
    // Use VSCode's workspace symbol search
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      'vscode.executeWorkspaceSymbolProvider',
      query
    );

    if (!symbols || symbols.length === 0) {
      return {
        content: [{ type: 'text', text: `No symbols found matching: ${query}` }]
      };
    }

    const symbolList = symbols.slice(0, 20).map(symbol => {
      const location = symbol.location;
      const uri = location.uri;
      const range = location.range;
      const line = range.start.line + 1; // Convert to 1-indexed
      
      return `${symbol.name} (${vscode.SymbolKind[symbol.kind]}) - ${uri.fsPath}:${line}`;
    }).join('\n');

    return {
      content: [{ type: 'text', text: `Symbols matching "${query}":\n${symbolList}` }]
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ 
        type: 'text', 
        text: `Symbol search failed: ${error instanceof Error ? error.message : String(error)}` 
      }]
    };
  }
}