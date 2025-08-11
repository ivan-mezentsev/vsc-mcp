import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface ExecuteCommandParams {
  command: string;
  customCwd?: string;
  modifySomething?: boolean;
  background?: boolean;
  timeout?: number;
}

export function registerExecuteCommandTool(server: McpServer, registerTool: (tool: any) => void) {
  const tool = {
    name: 'execute_command',
    description: 'Execute commands in VSCode integrated terminal',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to execute'
        },
        customCwd: {
          type: 'string',
          description: 'Optional custom working directory for command execution'
        },
        modifySomething: {
          type: 'boolean',
          default: true,
          description: 'Flag indicating if command is potentially destructive. Set false for read-only commands'
        },
        background: {
          type: 'boolean',
          default: false,
          description: 'Run command in background without waiting for completion'
        },
        timeout: {
          type: 'number',
          default: 300000,
          description: 'Timeout in milliseconds (default: 5 minutes)'
        }
      },
      required: ['command']
    }
  };

  registerTool(tool);

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    if (request.params.name !== 'execute_command') {
      return { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] };
    }

    const params = request.params.arguments as ExecuteCommandParams;
    return handleExecuteCommand(params);
  });
}

async function handleExecuteCommand(params: ExecuteCommandParams): Promise<CallToolResult> {
  try {
    const {
      command,
      customCwd,
      modifySomething = true,
      background = false,
      timeout = 300000
    } = params;

    // Get confirmation setting
    const config = vscode.workspace.getConfiguration('vscMcp');
    const confirmNonDestructive = config.get<boolean>('confirmNonDestructiveCommands', false);

    // Check if confirmation is needed
    if (modifySomething || confirmNonDestructive) {
      const confirmResult = await vscode.window.showQuickPick(
        ['Execute', 'Cancel'],
        {
          placeHolder: `Execute command: ${command}`,
          ignoreFocusOut: true
        }
      );

      if (confirmResult !== 'Execute') {
        return {
          content: [{ type: 'text', text: 'Command execution cancelled by user' }]
        };
      }
    }

    // Get or create terminal
    const terminal = getOrCreateTerminal(customCwd);
    
    if (background) {
      // Execute in background
      terminal.sendText(command);
      terminal.show();
      
      return {
        content: [{ 
          type: 'text', 
          text: `Command executed in background: ${command}\nCheck the terminal for output.` 
        }]
      };
    } else {
      // Execute and wait for completion (simplified approach)
      terminal.sendText(command);
      terminal.show();
      
      // Wait for a brief moment to let command start
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return {
        content: [{ 
          type: 'text', 
          text: `Command executed: ${command}\nCheck the terminal for output and completion status.` 
        }]
      };
    }
  } catch (error) {
    return {
      isError: true,
      content: [{ 
        type: 'text', 
        text: `Failed to execute command: ${error instanceof Error ? error.message : String(error)}` 
      }]
    };
  }
}

function getOrCreateTerminal(customCwd?: string): vscode.Terminal {
  const existingTerminal = vscode.window.terminals.find(t => t.name === 'VSC MCP');
  
  if (existingTerminal) {
    return existingTerminal;
  }

  const options: vscode.TerminalOptions = {
    name: 'VSC MCP'
  };

  if (customCwd) {
    options.cwd = customCwd;
  } else {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      options.cwd = workspaceRoot;
    }
  }

  return vscode.window.createTerminal(options);
}