import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface DebugToolParams {
  action: 'list_sessions' | 'start_session' | 'restart_session' | 'stop_session';
  session_id?: string;
  configuration?: string;
}

export function registerDebugTool(server: McpServer, registerTool: (tool: any) => void) {
  const tool = {
    name: 'debug_tools',
    description: 'Manage debug sessions in VSCode',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list_sessions', 'start_session', 'restart_session', 'stop_session'],
          description: 'Debug action to perform'
        },
        session_id: {
          type: 'string',
          description: 'Debug session ID (required for restart_session and stop_session)'
        },
        configuration: {
          type: 'string',
          description: 'Debug configuration name (for start_session)'
        }
      },
      required: ['action']
    }
  };

  registerTool(tool);

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    if (request.params.name !== 'debug_tools') {
      return { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] };
    }

    const params = request.params.arguments as DebugToolParams;
    return handleDebugTool(params);
  });
}

async function handleDebugTool(params: DebugToolParams): Promise<CallToolResult> {
  try {
    const { action, session_id, configuration } = params;

    switch (action) {
      case 'list_sessions':
        return listDebugSessions();
      
      case 'start_session':
        return startDebugSession(configuration);
      
      case 'restart_session':
        if (!session_id) {
          return { 
            isError: true, 
            content: [{ type: 'text', text: 'session_id is required for restart_session' }] 
          };
        }
        return restartDebugSession(session_id);
      
      case 'stop_session':
        if (!session_id) {
          return { 
            isError: true, 
            content: [{ type: 'text', text: 'session_id is required for stop_session' }] 
          };
        }
        return stopDebugSession(session_id);
      
      default:
        return { 
          isError: true, 
          content: [{ type: 'text', text: 'Invalid debug action' }] 
        };
    }
  } catch (error) {
    return {
      isError: true,
      content: [{ 
        type: 'text', 
        text: `Debug operation failed: ${error instanceof Error ? error.message : String(error)}` 
      }]
    };
  }
}

async function listDebugSessions(): Promise<CallToolResult> {
  const sessions = vscode.debug.activeDebugSession ? [vscode.debug.activeDebugSession] : [];
  
  if (sessions.length === 0) {
    return {
      content: [{ type: 'text', text: 'No active debug sessions' }]
    };
  }

  const sessionInfo = sessions.map(session => 
    `Session ID: ${session.id}\nName: ${session.name}\nType: ${session.type}`
  ).join('\n\n');

  return {
    content: [{ type: 'text', text: `Active debug sessions:\n\n${sessionInfo}` }]
  };
}

async function startDebugSession(configuration?: string): Promise<CallToolResult> {
  try {
    let success: boolean;
    
    if (configuration) {
      success = await vscode.debug.startDebugging(undefined, configuration);
    } else {
      success = await vscode.debug.startDebugging(undefined);
    }

    if (success) {
      return {
        content: [{ type: 'text', text: 'Debug session started successfully' }]
      };
    } else {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Failed to start debug session' }]
      };
    }
  } catch (error) {
    return {
      isError: true,
      content: [{ 
        type: 'text', 
        text: `Failed to start debug session: ${error instanceof Error ? error.message : String(error)}` 
      }]
    };
  }
}

async function restartDebugSession(sessionId: string): Promise<CallToolResult> {
  const activeSession = vscode.debug.activeDebugSession;
  
  if (!activeSession || activeSession.id !== sessionId) {
    return {
      isError: true,
      content: [{ type: 'text', text: `No active debug session with ID: ${sessionId}` }]
    };
  }

  try {
    await vscode.commands.executeCommand('workbench.action.debug.restart');
    return {
      content: [{ type: 'text', text: `Debug session ${sessionId} restarted` }]
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ 
        type: 'text', 
        text: `Failed to restart debug session: ${error instanceof Error ? error.message : String(error)}` 
      }]
    };
  }
}

async function stopDebugSession(sessionId: string): Promise<CallToolResult> {
  const activeSession = vscode.debug.activeDebugSession;
  
  if (!activeSession || activeSession.id !== sessionId) {
    return {
      isError: true,
      content: [{ type: 'text', text: `No active debug session with ID: ${sessionId}` }]
    };
  }

  try {
    await vscode.commands.executeCommand('workbench.action.debug.stop');
    return {
      content: [{ type: 'text', text: `Debug session ${sessionId} stopped` }]
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ 
        type: 'text', 
        text: `Failed to stop debug session: ${error instanceof Error ? error.message : String(error)}` 
      }]
    };
  }
}