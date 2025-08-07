import * as vscode from 'vscode';
import { BidiHttpTransport } from './bidi-http-transport';
import { registerVSCodeCommands } from './commands';
import { createMcpServer, extensionDisplayName } from './mcp-server';
import { DIFF_VIEW_URI_SCHEME } from './utils/DiffViewProvider';

// MCP Server のステータスを表示するステータスバーアイテム
let serverStatusBarItem: vscode.StatusBarItem;
let transport: BidiHttpTransport;

// ステータスバーを更新する関数
function updateServerStatusBar(status: 'running' | 'stopped' | 'starting' | 'tool_list_updated') {
  if (!serverStatusBarItem) {
    return;
  }

  switch (status) {
    case 'running':
      serverStatusBarItem.text = '$(server) VSC MCP';
      serverStatusBarItem.tooltip = 'VSC MCP is running';
      serverStatusBarItem.command = 'mcpServer.stopServer';
      break;
    case 'starting':
      serverStatusBarItem.text = '$(sync~spin) VSC MCP';
      serverStatusBarItem.tooltip = 'Starting...';
      serverStatusBarItem.command = undefined;
      break;
    case 'tool_list_updated':
      // serverStatusBarItem.text = '$(warning) VSC MCP';
      // serverStatusBarItem.tooltip = 'Tool list updated - Restart MCP Client';
      // serverStatusBarItem.command = 'mcpServer.stopServer';
      break;
    case 'stopped':
    default:
      serverStatusBarItem.text = '$(circle-slash) VSC MCP';
      serverStatusBarItem.tooltip = 'VSC MCP is not running';
      serverStatusBarItem.command = 'mcpServer.toggleActiveStatus';
      break;
  }
  serverStatusBarItem.show();
}

export const activate = async (context: vscode.ExtensionContext) => {
  // Removed unsafe access to vscode.lm.tools which may be undefined across IDEs

  // Create the output channel for logging
  const outputChannel = vscode.window.createOutputChannel(extensionDisplayName);
  outputChannel.appendLine(`Activating ${extensionDisplayName}...`);

  // Initialize the MCP server instance
  const mcpServer = createMcpServer(outputChannel);

  // Create status bar item with a stable identifier for modern VS Code versions
  serverStatusBarItem = vscode.window.createStatusBarItem('mcpServer.status', vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(serverStatusBarItem);
  // Show initial state to ensure visibility even before server starts
  updateServerStatusBar('starting');

  // Server start function
  async function startServer(port: number) {
    outputChannel.appendLine(`DEBUG: Starting VSC MCP on port ${port}...`);
    transport = new BidiHttpTransport(port, outputChannel);
    // サーバー状態変更のイベントハンドラを設定
    transport.onServerStatusChanged = (status) => {
      updateServerStatusBar(status);
    };

    await mcpServer.connect(transport); // connect calls transport.start().
    updateServerStatusBar(transport.serverStatus);
  }

  // Register Diff View Provider for file comparison functionality
  const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return Buffer.from(uri.query, "base64").toString("utf-8");
    }
  })();

  // DiffViewProvider の URI スキームを mcp-diff に変更
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider),
  );

  // Start server if configured to do so
  const mcpConfig = vscode.workspace.getConfiguration('mcpServer');
  const port = mcpConfig.get<number>('port', 60100);
  try {
    await startServer(port);
    outputChannel.appendLine(`VSC MCP started on port ${port}.`);
  } catch (err) {
    outputChannel.appendLine(`Failed to start VSC MCP: ${err}`);
  }

  // Register VSCode commands
  registerVSCodeCommands(context, mcpServer, outputChannel, startServer, transport);

  outputChannel.appendLine(`${extensionDisplayName} activated.`);
};

export function deactivate() {
  // Clean-up is managed by the disposables added in the activate method.
}
