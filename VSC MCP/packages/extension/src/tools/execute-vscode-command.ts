import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface ExecuteVscodeCommandParams {
  command: string;
  args?: any[];
}

export function registerExecuteVscodeCommandTool(server: McpServer, registerTool: (tool: any) => void) {
  const tool = {
    name: 'execute_vscode_command',
    description: 'Execute arbitrary VSCode commands',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'VSCode command ID to execute'
        },
        args: {
          type: 'array',
          description: 'Optional arguments for the command'
        }
      },
      required: ['command']
    }
  };

  registerTool(tool);

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    if (request.params.name !== 'execute_vscode_command') {
      return { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] };
    }

    const params = request.params.arguments as ExecuteVscodeCommandParams;
    return handleExecuteVscodeCommand(params);
  });
}

async function handleExecuteVscodeCommand(params: ExecuteVscodeCommandParams): Promise<CallToolResult> {
  try {
    const { command, args } = params;

    // Execute the VSCode command
    const result = await vscode.commands.executeCommand(command, ...(args || []));

    let resultText: string;
    if (result === undefined) {
      resultText = `Command "${command}" executed successfully (no return value)`;
    } else if (typeof result === 'string') {
      resultText = `Command "${command}" result: ${result}`;
    } else {
      resultText = `Command "${command}" result: ${JSON.stringify(result, null, 2)}`;
    }

    return {
      content: [{ type: 'text', text: resultText }]
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ 
        type: 'text', 
        text: `Failed to execute VSCode command: ${error instanceof Error ? error.message : String(error)}` 
      }]
    };
  }
}