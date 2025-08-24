import * as vscode from 'vscode';
import { SseHttpServer } from './sse-http-server';
import { registerVSCodeCommands } from './commands';
import { createMcpServer, extensionDisplayName } from './mcp-server';

// MCP Server のステータスを表示するステータスバーアイテム
let serverStatusBarItem: vscode.StatusBarItem;
let sseServer: SseHttpServer;

// ステータスバーを更新する関数
function updateServerStatusBar(status: 'running' | 'stopped' | 'starting') {
  if (!serverStatusBarItem) {
    return;
  }

  switch (status) {
    case 'running':
      serverStatusBarItem.text = '$(tools) VSC MCP';
      serverStatusBarItem.tooltip = 'VSC MCP is running';
      serverStatusBarItem.command = 'mcpServer.stopServer';
      break;
    case 'starting':
      serverStatusBarItem.text = '$(sync~spin) VSC MCP';
      serverStatusBarItem.tooltip = 'Starting...';
      serverStatusBarItem.command = undefined;
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

  // Create status bar item with a stable identifier; place it on the left with priority -100
  serverStatusBarItem = vscode.window.createStatusBarItem('mcpServer.status', vscode.StatusBarAlignment.Left, -100);
  context.subscriptions.push(serverStatusBarItem);
  // Show initial state to ensure visibility even before server starts
  updateServerStatusBar('starting');

  // Resolve port and instantiate server once so handover works even if initial start fails
  const mcpConfig = vscode.workspace.getConfiguration('mcpServer');
  const port = mcpConfig.get<number>('port', 60100);
  sseServer = new SseHttpServer(port, outputChannel, mcpServer);
  sseServer.onServerStatusChanged = (status) => {
    updateServerStatusBar(status);
  };

  // Server start function (reuses single instance)
  async function startServer(p: number) {
    if (p !== sseServer.listenPort) {
      // If port changed, recreate server instance
      sseServer = new SseHttpServer(p, outputChannel, mcpServer);
      sseServer.onServerStatusChanged = (status) => updateServerStatusBar(status);
    }
    outputChannel.appendLine(`DEBUG: Starting VSC MCP (SSE) on port ${p}...`);
    await sseServer.start();
    updateServerStatusBar(sseServer.serverStatus);
  }

  // Auto-start server based on configuration
  const startOnActivate = mcpConfig.get<boolean>('startOnActivate', true);
  if (startOnActivate) {
    try {
      await startServer(port);
      outputChannel.appendLine(`VSC MCP started on port ${port}.`);
    } catch (err) {
      outputChannel.appendLine(`Failed to start VSC MCP: ${err}`);
    }
  }

  // Register VSCode commands
  registerVSCodeCommands(context, mcpServer, outputChannel, startServer, sseServer);

  outputChannel.appendLine(`${extensionDisplayName} activated.`);
};

export function deactivate() {
  // Clean-up is managed by the disposables added in the activate method.
}
