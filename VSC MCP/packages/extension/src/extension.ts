import * as vscode from 'vscode';
import { HttpTransport } from './transport/http-transport';
import { registerCommands } from './commands';
import { createMcpServer, EXTENSION_NAME } from './mcp-server';
import { DIFF_VIEW_URI_SCHEME, DiffViewProvider } from './utils/diff-view-provider';

let serverStatusBarItem: vscode.StatusBarItem;
let transport: HttpTransport;

function updateServerStatusBar(status: 'running' | 'stopped' | 'starting') {
  if (!serverStatusBarItem) {
    return;
  }

  switch (status) {
    case 'running':
      serverStatusBarItem.text = '$(server) VSC MCP';
      serverStatusBarItem.tooltip = 'VSC MCP server is running';
      serverStatusBarItem.command = 'vscMcp.stopServer';
      break;
    case 'starting':
      serverStatusBarItem.text = '$(sync~spin) VSC MCP';
      serverStatusBarItem.tooltip = 'Starting VSC MCP server...';
      serverStatusBarItem.command = undefined;
      break;
    case 'stopped':
    default:
      serverStatusBarItem.text = '$(circle-slash) VSC MCP';
      serverStatusBarItem.tooltip = 'VSC MCP server is not running';
      serverStatusBarItem.command = 'vscMcp.toggleActiveStatus';
      break;
  }
  serverStatusBarItem.show();
}

export const activate = async (context: vscode.ExtensionContext) => {
  const outputChannel = vscode.window.createOutputChannel(EXTENSION_NAME);
  outputChannel.appendLine(`Activating ${EXTENSION_NAME}...`);

  const mcpServer = createMcpServer();

  // Initialize status bar
  serverStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  updateServerStatusBar('stopped');
  context.subscriptions.push(serverStatusBarItem);

  // Register commands
  registerCommands(context, {
    startServer: async () => {
      try {
        updateServerStatusBar('starting');
        const config = vscode.workspace.getConfiguration('vscMcp');
        const port = config.get<number>('port', 60100);
        
        transport = new HttpTransport(port);
        await transport.start(mcpServer);
        
        updateServerStatusBar('running');
        outputChannel.appendLine(`VSC MCP server started on port ${port}`);
        vscode.window.showInformationMessage(`VSC MCP server started on port ${port}`);
      } catch (error) {
        updateServerStatusBar('stopped');
        const message = `Failed to start VSC MCP server: ${error}`;
        outputChannel.appendLine(message);
        vscode.window.showErrorMessage(message);
      }
    },
    stopServer: async () => {
      try {
        if (transport) {
          await transport.stop();
          transport = undefined;
        }
        updateServerStatusBar('stopped');
        outputChannel.appendLine('VSC MCP server stopped');
        vscode.window.showInformationMessage('VSC MCP server stopped');
      } catch (error) {
        const message = `Failed to stop VSC MCP server: ${error}`;
        outputChannel.appendLine(message);
        vscode.window.showErrorMessage(message);
      }
    },
    toggleActiveStatus: async () => {
      if (transport) {
        vscode.commands.executeCommand('vscMcp.stopServer');
      } else {
        vscode.commands.executeCommand('vscMcp.startServer');
      }
    }
  });

  // Register diff view provider
  const diffViewProvider = new DiffViewProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      DIFF_VIEW_URI_SCHEME,
      diffViewProvider
    )
  );

  // Auto-start server if configured
  const config = vscode.workspace.getConfiguration('vscMcp');
  if (config.get<boolean>('startOnActivate', true)) {
    await vscode.commands.executeCommand('vscMcp.startServer');
  }

  outputChannel.appendLine(`${EXTENSION_NAME} activated successfully`);
};

export const deactivate = async () => {
  if (transport) {
    await transport.stop();
  }
};