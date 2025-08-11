import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface CodeCheckerParams {
  path?: string;
}

export function registerCodeCheckerTool(server: McpServer, registerTool: (tool: any) => void) {
  const tool = {
    name: 'code_checker',
    description: 'Retrieve current diagnostics (errors, warnings) for code files',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional file path to check. If not provided, checks all open files'
        }
      }
    }
  };

  registerTool(tool);

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    if (request.params.name !== 'code_checker') {
      return { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] };
    }

    const params = request.params.arguments as CodeCheckerParams;
    return handleCodeChecker(params);
  });
}

async function handleCodeChecker(params: CodeCheckerParams): Promise<CallToolResult> {
  try {
    const diagnostics: string[] = [];
    
    if (params.path) {
      // Check specific file
      const uri = resolvePathToUri(params.path);
      const fileDiagnostics = vscode.languages.getDiagnostics(uri);
      
      if (fileDiagnostics.length === 0) {
        diagnostics.push(`No diagnostics found for: ${uri.fsPath}`);
      } else {
        diagnostics.push(`Diagnostics for: ${uri.fsPath}`);
        diagnostics.push('');
        
        for (const diagnostic of fileDiagnostics) {
          const severity = getSeverityString(diagnostic.severity);
          const line = diagnostic.range.start.line + 1; // Convert to 1-indexed
          const char = diagnostic.range.start.character + 1;
          
          diagnostics.push(`[${severity}] Line ${line}:${char} - ${diagnostic.message}`);
          
          if (diagnostic.source) {
            diagnostics.push(`  Source: ${diagnostic.source}`);
          }
          
          if (diagnostic.code) {
            diagnostics.push(`  Code: ${diagnostic.code}`);
          }
          
          diagnostics.push('');
        }
      }
    } else {
      // Check all files with diagnostics
      const allDiagnostics = vscode.languages.getDiagnostics();
      
      if (allDiagnostics.length === 0) {
        diagnostics.push('No diagnostics found in any open files');
      } else {
        diagnostics.push('All diagnostics across open files:');
        diagnostics.push('');
        
        for (const [uri, fileDiagnostics] of allDiagnostics) {
          if (fileDiagnostics.length > 0) {
            diagnostics.push(`File: ${uri.fsPath}`);
            
            for (const diagnostic of fileDiagnostics) {
              const severity = getSeverityString(diagnostic.severity);
              const line = diagnostic.range.start.line + 1;
              const char = diagnostic.range.start.character + 1;
              
              diagnostics.push(`  [${severity}] Line ${line}:${char} - ${diagnostic.message}`);
            }
            
            diagnostics.push('');
          }
        }
      }
    }
    
    return {
      content: [{ type: 'text', text: diagnostics.join('\n') }]
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ 
        type: 'text', 
        text: `Failed to check diagnostics: ${error instanceof Error ? error.message : String(error)}` 
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

function getSeverityString(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'ERROR';
    case vscode.DiagnosticSeverity.Warning:
      return 'WARNING';
    case vscode.DiagnosticSeverity.Information:
      return 'INFO';
    case vscode.DiagnosticSeverity.Hint:
      return 'HINT';
    default:
      return 'UNKNOWN';
  }
}