import * as net from 'node:net';
import * as vscode from 'vscode';
import { registerVSCodeCommands } from './commands';
import { createMcpServer, extensionDisplayName } from './mcp-server';
import { SseHttpServer } from './sse-http-server';

// MCP Server のステータスを表示するステータスバーアイテム
let serverStatusBarItem: vscode.StatusBarItem;
let sseServer: SseHttpServer | undefined;

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

  // Resolve port from configuration
  const mcpConfig = vscode.workspace.getConfiguration('mcpServer');
  const port = mcpConfig.get<number>('port', 60100);
  const workspaceFolder = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]?.uri.fsPath) || process.cwd();

  // Quiet probe for the first free port starting at desiredPort
  async function findAvailablePort(desiredPort: number, maxSteps = 100): Promise<number> {
    for (let p = desiredPort, i = 0; i <= maxSteps && p <= 65535; i++, p++) {
      if (p < 1024) continue; // skip privileged
      const free = await new Promise<boolean>((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(false));
        srv.once('listening', () => {
          srv.close(() => resolve(true));
        });
        // Match HTTP default binding (no host); exclusive to detect occupancy correctly
        srv.listen({ port: p, exclusive: true });
        srv.unref();
      });
      if (free) return p;
    }
    throw new Error('No free port found');
  }

  // Start server with port-scan (single HTTP server instance)
  async function startServerWithPortScan(desiredPort: number) {
    const chosenPort = await findAvailablePort(desiredPort);
    // Create server only once on the chosen port
    sseServer = new SseHttpServer(chosenPort, outputChannel, mcpServer);
    sseServer.onServerStatusChanged = (status) => updateServerStatusBar(status);
    await sseServer.start();
    // Schedule periodic registration to base port (from config) every 60s
    sseServer.scheduleDiscoveryRegistration({ basePort: port, workspaceFolder });
    // Probe base port every 60s; if not responsive within 0.5s, try to additionally listen on base port with small jitter
    try {
      const jitterMs = Math.floor(Math.random() * 200);
      setInterval(async () => {
        // skip if server not initialized
        if (!sseServer) return;
        const ok = await SseHttpServer.probePing(port, 500);
        if (ok) return;
        // small jitter to reduce thundering herd
        await new Promise((r) => setTimeout(r, jitterMs));
        const added = await sseServer.listenAdditionally(port);
        if (added) {
          outputChannel.appendLine(`VSC MCP additionally listening on base port ${port}.`);
        }
      }, 60_000);
    } catch { /* silent */ }
    updateServerStatusBar(sseServer.serverStatus);
    // Only positive success log
    outputChannel.appendLine(`VSC MCP started on port ${chosenPort}.`);
  }

  // Auto-start server based on configuration
  const startOnActivate = mcpConfig.get<boolean>('startOnActivate', true);
  if (startOnActivate) {
    try {
      await startServerWithPortScan(port);
    } catch (err) {
      outputChannel.appendLine(`Failed to start VSC MCP: ${err}`);
    }
  }

  // Register VSCode commands
  registerVSCodeCommands(context, mcpServer, outputChannel, startServerWithPortScan, sseServer);

  outputChannel.appendLine(`${extensionDisplayName} activated.`);
};

export function deactivate() {
  // Clean-up is managed by the disposables added in the activate method.
}
