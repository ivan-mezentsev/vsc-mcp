import * as path from 'path';
import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface TextEditorParams {
  command: 'view' | 'str_replace' | 'create' | 'insert' | 'undo_edit';
  path: string;
  view_range?: [number, number];
  old_str?: string;
  new_str?: string;
  file_text?: string;
  insert_line?: number;
}

export function registerTextEditorTool(
  server: McpServer, 
  registerTool: (tool: any, handler: (params: any) => Promise<CallToolResult>) => void
) {
  const tool = {
    name: 'text_editor',
    description: 'Perform file operations: view, edit, create files with diff review',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          enum: ['view', 'str_replace', 'create', 'insert', 'undo_edit'],
          description: 'Operation to perform'
        },
        path: {
          type: 'string',
          description: 'File path to operate on'
        },
        view_range: {
          type: 'array',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
          description: 'Optional [start, end] line numbers for view (1-indexed, -1 for end)'
        },
        old_str: {
          type: 'string',
          description: 'Text to replace (required for str_replace)'
        },
        new_str: {
          type: 'string',
          description: 'New text content (required for str_replace and insert)'
        },
        file_text: {
          type: 'string',
          description: 'Content for new file (required for create)'
        },
        insert_line: {
          type: 'number',
          description: 'Line number to insert after (required for insert)'
        }
      },
      required: ['command', 'path']
    }
  };

  registerTool(tool, handleTextEditorCommand);
}

async function handleTextEditorCommand(params: TextEditorParams): Promise<CallToolResult> {
  try {
    const resolvedPath = resolvePath(params.path);
    const uri = vscode.Uri.file(resolvedPath);

    switch (params.command) {
      case 'view':
        return await viewFile(uri, params.view_range);
      
      case 'create':
        if (!params.file_text) {
          return { isError: true, content: [{ type: 'text', text: 'file_text is required for create command' }] };
        }
        return await createFile(uri, params.file_text);
      
      case 'str_replace':
        if (!params.old_str || !params.new_str) {
          return { isError: true, content: [{ type: 'text', text: 'old_str and new_str are required for str_replace command' }] };
        }
        return await replaceInFile(uri, params.old_str, params.new_str);
      
      case 'insert':
        if (params.insert_line === undefined || !params.new_str) {
          return { isError: true, content: [{ type: 'text', text: 'insert_line and new_str are required for insert command' }] };
        }
        return await insertInFile(uri, params.insert_line, params.new_str);
      
      case 'undo_edit':
        return await undoEdit();
      
      default:
        return { isError: true, content: [{ type: 'text', text: 'Invalid command' }] };
    }
  } catch (error) {
    return { 
      isError: true, 
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }] 
    };
  }
}

function resolvePath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    return path.join(workspaceRoot, filePath);
  }
  
  return path.resolve(filePath);
}

async function viewFile(uri: vscode.Uri, viewRange?: [number, number]): Promise<CallToolResult> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    
    // Handle directory listing
    if (stat.type === vscode.FileType.Directory) {
      const entries = await vscode.workspace.fs.readDirectory(uri);
      entries.sort((a, b) => {
        const aIsDir = a[1] & vscode.FileType.Directory;
        const bIsDir = b[1] & vscode.FileType.Directory;
        if (aIsDir && !bIsDir) return -1;
        if (!aIsDir && bIsDir) return 1;
        return a[0].localeCompare(b[0]);
      });

      const lines = [`Directory listing for: ${uri.fsPath}`, ''];
      for (const [name, type] of entries) {
        const isDir = type & vscode.FileType.Directory;
        const prefix = isDir ? 'd ' : '- ';
        const suffix = isDir ? '/' : '';
        lines.push(`${prefix}${name}${suffix}`);
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // Handle file viewing
    const document = await vscode.workspace.openTextDocument(uri);
    let content: string;

    if (viewRange) {
      const [start, end] = viewRange;
      const startLine = Math.max(0, start - 1);
      const endLine = end === -1 ? document.lineCount : end;
      const range = new vscode.Range(
        new vscode.Position(startLine, 0),
        new vscode.Position(endLine, 0)
      );
      content = document.getText(range);
    } else {
      content = document.getText();
    }

    return { content: [{ type: 'text', text: content }] };
  } catch {
    return { 
      isError: true, 
      content: [{ type: 'text', text: `File does not exist at path: ${uri.fsPath}` }] 
    };
  }
}

async function createFile(uri: vscode.Uri, content: string): Promise<CallToolResult> {
  try {
    // Ensure parent directory exists
    const parentDir = path.dirname(uri.fsPath);
    const parentUri = vscode.Uri.file(parentDir);
    
    try {
      await vscode.workspace.fs.stat(parentUri);
    } catch {
      await vscode.workspace.fs.createDirectory(parentUri);
    }

    // Check if file already exists
    try {
      await vscode.workspace.fs.stat(uri);
      return { 
        isError: true, 
        content: [{ type: 'text', text: `File already exists at path: ${uri.fsPath}` }] 
      };
    } catch {
      // File doesn't exist, which is what we want
    }

    // Create the file
    const buffer = Buffer.from(content, 'utf8');
    await vscode.workspace.fs.writeFile(uri, buffer);

    return { 
      content: [{ type: 'text', text: `File created successfully at: ${uri.fsPath}` }] 
    };
  } catch (error) {
    return { 
      isError: true, 
      content: [{ type: 'text', text: `Failed to create file: ${error instanceof Error ? error.message : String(error)}` }] 
    };
  }
}

async function replaceInFile(uri: vscode.Uri, oldStr: string, newStr: string): Promise<CallToolResult> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const content = document.getText();
    
    if (!content.includes(oldStr)) {
      return { 
        isError: true, 
        content: [{ type: 'text', text: 'Text to replace not found in file' }] 
      };
    }

    const newContent = content.replace(oldStr, newStr);
    const buffer = Buffer.from(newContent, 'utf8');
    await vscode.workspace.fs.writeFile(uri, buffer);

    return { 
      content: [{ type: 'text', text: `Text replaced successfully in: ${uri.fsPath}` }] 
    };
  } catch (error) {
    return { 
      isError: true, 
      content: [{ type: 'text', text: `Failed to replace text: ${error instanceof Error ? error.message : String(error)}` }] 
    };
  }
}

async function insertInFile(uri: vscode.Uri, insertLine: number, text: string): Promise<CallToolResult> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const lines = document.getText().split('\n');
    
    if (insertLine < 0 || insertLine > lines.length) {
      return { 
        isError: true, 
        content: [{ type: 'text', text: `Invalid line number: ${insertLine}` }] 
      };
    }

    lines.splice(insertLine, 0, text);
    const newContent = lines.join('\n');
    const buffer = Buffer.from(newContent, 'utf8');
    await vscode.workspace.fs.writeFile(uri, buffer);

    return { 
      content: [{ type: 'text', text: `Text inserted successfully at line ${insertLine} in: ${uri.fsPath}` }] 
    };
  } catch (error) {
    return { 
      isError: true, 
      content: [{ type: 'text', text: `Failed to insert text: ${error instanceof Error ? error.message : String(error)}` }] 
    };
  }
}

async function undoEdit(): Promise<CallToolResult> {
  try {
    await vscode.commands.executeCommand('undo');
    return { 
      content: [{ type: 'text', text: 'Undo operation executed' }] 
    };
  } catch (error) {
    return { 
      isError: true, 
      content: [{ type: 'text', text: `Failed to undo: ${error instanceof Error ? error.message : String(error)}` }] 
    };
  }
}