import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function registerListVscodeCommandsTool(server: McpServer, registerTool: (tool: any) => void) {
  const tool = {
    name: 'list_vscode_commands',
    description: 'List available VSCode commands',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  };

  registerTool(tool);

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    if (request.params.name !== 'list_vscode_commands') {
      return { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] };
    }

    return handleListVscodeCommands();
  });
}

async function handleListVscodeCommands(): Promise<CallToolResult> {
  try {
    // Get all available commands
    const commands = await vscode.commands.getCommands();
    
    // Filter out internal commands and sort
    const filteredCommands = commands
      .filter(cmd => !cmd.startsWith('_') && !cmd.startsWith('vscode.'))
      .sort();

    const commandList = filteredCommands.join('\n');
    
    return {
      content: [{ 
        type: 'text', 
        text: `Available VSCode commands (${filteredCommands.length} total):\n\n${commandList}` 
      }]
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ 
        type: 'text', 
        text: `Failed to list VSCode commands: ${error instanceof Error ? error.message : String(error)}` 
      }]
    };
  }
}