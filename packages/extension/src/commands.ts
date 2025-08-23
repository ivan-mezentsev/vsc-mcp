import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as vscode from 'vscode';

export interface ServerState {
  value: boolean;
}

import { SseHttpServer } from './sse-http-server';

export function registerVSCodeCommands(
  context: vscode.ExtensionContext,
  mcpServer: McpServer,
  outputChannel: vscode.OutputChannel,
  startServer: (port: number) => Promise<void>,
  transport?: SseHttpServer
) {
  // テキストエディタのアクションコマンドを登録
  context.subscriptions.push(
    vscode.commands.registerCommand('textEditor.applyChanges', () => {
      vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      return true;
    }),
    vscode.commands.registerCommand('textEditor.cancelChanges', () => {
      vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      return false;
    })
  );
  // COMMAND PALETTE COMMAND: Stop the MCP Server
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpServer.stopServer', async () => {
      try {
        await mcpServer.close();
        if (transport) {
          await transport.close();
        }
        outputChannel.appendLine('MCP Server stopped.');
      } catch (err) {
        vscode.window.showWarningMessage('MCP Server is not running.');
        outputChannel.appendLine('Attempted to stop the MCP Server, but it is not running.');
        return;
      }
    }),
  );

  // COMMAND PALETTE COMMAND: Start the MCP Server
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpServer.startServer', async () => {
      try {
        const port = vscode.workspace.getConfiguration('mcpServer').get<number>('port', 60100);
        await startServer(port);
        outputChannel.appendLine(`MCP Server started on port ${port}.`);
        vscode.window.showInformationMessage(`MCP Server started on port ${port}.`);
      } catch (err) {
        outputChannel.appendLine(`Failed to start MCP Server: ${err}`);
        vscode.window.showErrorMessage(`Failed to start MCP Server: ${err}`);
      }
    }),
  );

  // Request handover
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpServer.toggleActiveStatus', async () => {
      if (!transport) {
        vscode.window.showWarningMessage('MCP Server is not running.');
        return;
      }

      try {
        const success = await transport.requestHandover();
        if (success) {
          outputChannel.appendLine('Handover request successful');
        } else {
          vscode.window.showErrorMessage('Failed to complete handover request.');
        }
      } catch (err) {
        outputChannel.appendLine(`Error requesting handover: ${err}`);
        vscode.window.showErrorMessage(`Failed to complete handover request: ${err}`);
      }
    })
  );
}
