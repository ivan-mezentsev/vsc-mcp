import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface GetTerminalOutputParams {
  terminal_name?: string;
  last_lines?: number;
}

export function registerGetTerminalOutputTool(server: McpServer, registerTool: (tool: any) => void) {
  const tool = {
    name: 'get_terminal_output',
    description: 'Fetch output from specified terminal',
    inputSchema: {
      type: 'object',
      properties: {
        terminal_name: {
          type: 'string',
          description: 'Name of the terminal to get output from (defaults to active terminal)'
        },
        last_lines: {
          type: 'number',
          default: 50,
          description: 'Number of last lines to retrieve'
        }
      }
    }
  };

  registerTool(tool);

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    if (request.params.name !== 'get_terminal_output') {
      return { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] };
    }

    const params = request.params.arguments as GetTerminalOutputParams;
    return handleGetTerminalOutput(params);
  });
}

async function handleGetTerminalOutput(params: GetTerminalOutputParams): Promise<CallToolResult> {
  try {
    const { terminal_name, last_lines = 50 } = params;
    
    let terminal: vscode.Terminal | undefined;
    
    if (terminal_name) {
      terminal = vscode.window.terminals.find(t => t.name === terminal_name);
      if (!terminal) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Terminal not found: ${terminal_name}` }]
        };
      }
    } else {
      terminal = vscode.window.activeTerminal;
      if (!terminal) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'No active terminal found' }]
        };
      }
    }

    // Note: VSCode doesn't provide direct API to read terminal output
    // This is a limitation of the VSCode extension API
    // We can only indicate that the terminal exists and provide instructions
    
    return {
      content: [{ 
        type: 'text', 
        text: `Terminal "${terminal.name}" is available, but VSCode extension API doesn't provide direct access to terminal output. You can view the terminal content in the VSCode interface.` 
      }]
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ 
        type: 'text', 
        text: `Failed to get terminal output: ${error instanceof Error ? error.message : String(error)}` 
      }]
    };
  }
}