import * as path from 'path';
import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface ListDirectoryParams {
  path: string;
  recursive?: boolean;
  max_depth?: number;
}

export function registerListDirectoryTool(server: McpServer, registerTool: (tool: any) => void) {
  const tool = {
    name: 'list_directory',
    description: 'List directory contents in a tree format',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list'
        },
        recursive: {
          type: 'boolean',
          default: false,
          description: 'Whether to list subdirectories recursively'
        },
        max_depth: {
          type: 'number',
          default: 3,
          description: 'Maximum depth for recursive listing'
        }
      },
      required: ['path']
    }
  };

  registerTool(tool);

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    if (request.params.name !== 'list_directory') {
      return { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] };
    }

    const params = request.params.arguments as ListDirectoryParams;
    return handleListDirectory(params);
  });
}

async function handleListDirectory(params: ListDirectoryParams): Promise<CallToolResult> {
  try {
    const { path: dirPath, recursive = false, max_depth = 3 } = params;
    const resolvedPath = resolvePath(dirPath);
    const uri = vscode.Uri.file(resolvedPath);

    // Check if path exists and is a directory
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (!(stat.type & vscode.FileType.Directory)) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Path is not a directory: ${resolvedPath}` }]
        };
      }
    } catch {
      return {
        isError: true,
        content: [{ type: 'text', text: `Directory does not exist: ${resolvedPath}` }]
      };
    }

    const result = await listDirectoryContents(uri, recursive, max_depth, 0);
    
    return {
      content: [{ type: 'text', text: result }]
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ 
        type: 'text', 
        text: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}` 
      }]
    };
  }
}

function resolvePath(dirPath: string): string {
  if (path.isAbsolute(dirPath)) {
    return dirPath;
  }
  
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    return path.join(workspaceRoot, dirPath);
  }
  
  return path.resolve(dirPath);
}

async function listDirectoryContents(
  uri: vscode.Uri, 
  recursive: boolean, 
  maxDepth: number, 
  currentDepth: number,
  prefix: string = ''
): Promise<string> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    
    // Sort entries: directories first, then files, both alphabetically
    entries.sort((a, b) => {
      const aIsDir = a[1] & vscode.FileType.Directory;
      const bIsDir = b[1] & vscode.FileType.Directory;
      
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a[0].localeCompare(b[0]);
    });

    const lines: string[] = [];
    
    if (currentDepth === 0) {
      lines.push(`Directory listing for: ${uri.fsPath}`);
      lines.push('');
    }

    for (let i = 0; i < entries.length; i++) {
      const [name, type] = entries[i];
      const isLast = i === entries.length - 1;
      const isDir = type & vscode.FileType.Directory;
      const isSymlink = type & vscode.FileType.SymbolicLink;
      
      // Create tree symbols
      const connector = isLast ? '└── ' : '├── ';
      let icon = '';
      
      if (isDir) {
        icon = '📁 ';
      } else if (isSymlink) {
        icon = '🔗 ';
      } else {
        icon = '📄 ';
      }
      
      lines.push(`${prefix}${connector}${icon}${name}`);
      
      // Recursively list subdirectories if enabled and within depth limit
      if (recursive && isDir && currentDepth < maxDepth) {
        const childUri = vscode.Uri.joinPath(uri, name);
        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        
        try {
          const childContent = await listDirectoryContents(
            childUri, 
            recursive, 
            maxDepth, 
            currentDepth + 1, 
            childPrefix
          );
          
          // Only add child content if it's not just the header
          const childLines = childContent.split('\n').filter(line => line.trim());
          if (childLines.length > 0) {
            lines.push(...childLines);
          }
        } catch (error) {
          lines.push(`${childPrefix}├── ❌ Error reading directory: ${error}`);
        }
      }
    }
    
    return lines.join('\n');
  } catch (error) {
    return `Error reading directory ${uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`;
  }
}