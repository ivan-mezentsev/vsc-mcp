import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface PreviewUrlParams {
  url: string;
}

export function registerPreviewUrlTool(server: McpServer, registerTool: (tool: any) => void) {
  const tool = {
    name: 'preview_url',
    description: 'Open URLs in VSCode integrated browser',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to preview in VSCode browser'
        }
      },
      required: ['url']
    }
  };

  registerTool(tool);

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    if (request.params.name !== 'preview_url') {
      return { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] };
    }

    const params = request.params.arguments as PreviewUrlParams;
    return handlePreviewUrl(params);
  });
}

async function handlePreviewUrl(params: PreviewUrlParams): Promise<CallToolResult> {
  try {
    const { url } = params;

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid URL format' }]
      };
    }

    // Open URL in VSCode's simple browser
    await vscode.commands.executeCommand('simpleBrowser.show', url);

    return {
      content: [{ type: 'text', text: `URL opened in VSCode browser: ${url}` }]
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ 
        type: 'text', 
        text: `Failed to preview URL: ${error instanceof Error ? error.message : String(error)}` 
      }]
    };
  }
}