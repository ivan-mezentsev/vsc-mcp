import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface FocusEditorParams {
  path: string;
  line?: number;
  column?: number;
}

export function registerFocusEditorTool(server: McpServer, registerTool: (tool: any) => void) {
  const tool = {
    name: 'focus_editor',
    description: 'Focus and navigate to specific locations within files',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to focus on'
        },
        line: {
          type: 'number',
          description: 'Optional line number to navigate to (1-indexed)'
        },
        column: {
          type: 'number',
          description: 'Optional column number to navigate to (1-indexed)'
        }
      },
      required: ['path']
    }
  };

  registerTool(tool);

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    if (request.params.name !== 'focus_editor') {
      return { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] };
    }

    const params = request.params.arguments as FocusEditorParams;
    return handleFocusEditor(params);
  });
}

async function handleFocusEditor(params: FocusEditorParams): Promise<CallToolResult> {
  try {
    const { path: filePath, line, column } = params;
    const uri = resolvePathToUri(filePath);

    // Open the document
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);

    // Navigate to specific position if provided
    if (line !== undefined) {
      const targetLine = Math.max(0, line - 1); // Convert to 0-indexed
      const targetColumn = column ? Math.max(0, column - 1) : 0;
      
      const position = new vscode.Position(targetLine, targetColumn);
      const range = new vscode.Range(position, position);
      
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }

    let message = `Focused on file: ${uri.fsPath}`;
    if (line !== undefined) {
      message += ` at line ${line}`;
      if (column !== undefined) {
        message += `, column ${column}`;
      }
    }

    return {
      content: [{ type: 'text', text: message }]
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ 
        type: 'text', 
        text: `Failed to focus editor: ${error instanceof Error ? error.message : String(error)}` 
      }]
    };
  }
}

function resolvePathToUri(filePath: string): vscode.Uri {
  if (filePath.startsWith('file://')) {
    return vscode.Uri.parse(filePath);
  }
  
  if (require('path').isAbsolute(filePath)) {
    return vscode.Uri.file(filePath);
  }
  
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    return vscode.Uri.file(require('path').join(workspaceRoot, filePath));
  }
  
  return vscode.Uri.file(require('path').resolve(filePath));
}