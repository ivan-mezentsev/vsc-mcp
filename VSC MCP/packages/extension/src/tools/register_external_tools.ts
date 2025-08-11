import { Tool } from '@modelcontextprotocol/sdk/types';
import * as vscode from 'vscode';
import { ToolRegistry } from '../mcp-server';

// ホワイトリストとして登録するツールの名前の配列
// const ALLOWED_TOOLS = [
//   'copilot_semanticSearch',
//   'copilot_searchWorkspaceSymbols',
//   'copilot_listCodeUsages',
//   'copilot_vscodeAPI',
//   'copilot_findFiles',
//   'copilot_findTextInFiles',
//   'copilot_readFile',
//   'copilot_listDirectory',
//   'copilot_getErrors',
//   // 'copilot_readProjectStructure', // No InputSchema
//   'copilot_getChangedFiles',
//   // 'copilot_testFailure', // No InputSchema
//   'copilot_runTests',
//   'copilot_runVsCodeTask'
//   // below are not allowed without invocationToken
//   // 'copilot_runInTerminal',
//   // 'copilot_getTerminalOutput',
//   // 'copilot_getTerminalSelection',
//   // 'copilot_getTerminalLastCommand',
//   // 'copilot_editFile'
// ];

const notAllowedTools = [
  // No Input Schema
  'copilot_readProjectStructure',
  'copilot_testFailure',
  // not allowed without invocationToken
  'copilot_runInTerminal',
  'copilot_getTerminalOutput',
  'copilot_getTerminalSelection',
  'copilot_getTerminalLastCommand',
  'copilot_editFile',
];

// Function to register all allowed external tools to the MCP server
export function registerExternalTools(mcpServer: ToolRegistry) {
  if (!vscode.lm || !vscode.lm.tools) {
    console.error('vscode.lm.tools is not available');
    return;
  }

  // ホワイトリストに含まれているツールだけを登録
  for (const tool of vscode.lm.tools) {
    if (!notAllowedTools.includes(tool.name)) {
      if (!tool.inputSchema || !('type' in tool.inputSchema) || tool.inputSchema.type !== 'object') {
        console.error(`Tool ${tool.name} has no input schema or invalid type`);
        continue
      }
      registerTool(mcpServer, tool);
    }
  }
}

// 各ツールを登録する関数
function registerTool(mcpServer: ToolRegistry, tool: vscode.LanguageModelToolInformation) {
  try {
    mcpServer.toolWithRawInputSchema(
      tool.name,
      tool.description || `Tool: ${tool.name}`,
      tool.inputSchema as (Tool['inputSchema'] | undefined) ?? { type: 'object' },
      async (params: any) => {
        try {
          // VSCode のネイティブツールを呼び出す
          const result = await vscode.lm.invokeTool(tool.name, {
            input: params,
            toolInvocationToken: undefined,
          });

          // 結果を適切な形式に変換
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result.content),
              },
            ],
            isError: false,
          };
        } catch (error) {
          console.error(`Error invoking tool ${tool.name}:`, error);
          return {
            content: [{ type: 'text' as const, text: `Error invoking ${tool.name}: ${error}` }],
            isError: true,
          };
        }
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('is already registered')) {
      // Skip duplicate registrations to keep activation idempotent across environments
      console.warn(`Skip registering external tool '${tool.name}' because it is already registered.`);
      return;
    }
    throw e;
  }
}
