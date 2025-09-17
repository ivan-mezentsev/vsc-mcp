import * as net from 'node:net';
import * as vscode from 'vscode';
import { registerVSCodeCommands } from './commands';
import { createMcpServer, extensionDisplayName } from './mcp-server';
import { DISCOVERY_TTL_MS, SseHttpServer, getDiscoverySnapshot } from './sse-http-server';

// Custom wrapper command to log result of the built-in reset command
const BUILT_IN_RESET_CMD = 'workbench.mcp.resetCachedTools';
const WRAPPED_RESET_CMD = 'vsc-mcp.resetCachedToolsWithLog';

// MCP Server のステータスを表示するステータスバーアイテム
let serverStatusBarItem: vscode.StatusBarItem;
let sseServer: SseHttpServer | undefined;
let tooltipRefreshTimer: NodeJS.Timeout | undefined;

// ステータスバーを更新する関数
function updateServerStatusBar(status: 'running' | 'stopped' | 'starting') {
  if (!serverStatusBarItem) {
    return;
  }

  switch (status) {
    case 'running':
      serverStatusBarItem.text = '$(tools) VSC MCP';
      // Tooltip shows discovery table (Port | TTL | Workspace), decoupled from MCP status text
      try {
        const snapshot = getDiscoverySnapshot();
        if (snapshot.length > 0) {
          const now = Date.now();
          const header = '| Port | TTL | Workspace |\n| :--- | ---: | :-------- |';
          const rows = snapshot
            .map((r) => {
              const ttlMs = Math.max(0, DISCOVERY_TTL_MS - (now - r.lastSeen));
              const ttlSec = Math.round(ttlMs / 1000);
              const ws = r.workspaceFolder.replace(/\|/g, '\\|');
              return `| ${r.port} | ${ttlSec} | \`${ws}\` |`;
            })
            .join('\n');
          const md = new vscode.MarkdownString(`${header}\n${rows}`);
          md.isTrusted = true;
          serverStatusBarItem.tooltip = md;
        } else {
          serverStatusBarItem.tooltip = 'No discovery instances';
        }
      } catch {
        serverStatusBarItem.tooltip = 'No discovery instances';
      }
      // Clicking status bar: run wrapper command that logs result of the built-in reset
      serverStatusBarItem.command = WRAPPED_RESET_CMD;
      // Ensure live TTL countdown by refreshing tooltip periodically
      try {
        if (!tooltipRefreshTimer) {
          tooltipRefreshTimer = setInterval(() => {
            // Only refresh when still running
            if (sseServer?.serverStatus === 'running') {
              try { updateServerStatusBar('running'); } catch { /* ignore */ }
            }
          }, 5000);
        }
      } catch { /* ignore */ }
      break;
    case 'starting':
      serverStatusBarItem.text = '$(sync~spin) VSC MCP';
      serverStatusBarItem.tooltip = sseServer?.listenPort
        ? `Starting on port ${sseServer.listenPort}...`
        : 'Starting...';
      serverStatusBarItem.command = undefined;
      // Stop live refresh while not running
      if (tooltipRefreshTimer) { try { clearInterval(tooltipRefreshTimer); } catch { /* ignore */ } tooltipRefreshTimer = undefined; }
      break;
    case 'stopped':
    default:
      serverStatusBarItem.text = '$(circle-slash) VSC MCP';
      serverStatusBarItem.tooltip = 'VSC MCP is not running';
      serverStatusBarItem.command = undefined;
      // Stop live refresh when stopped
      if (tooltipRefreshTimer) { try { clearInterval(tooltipRefreshTimer); } catch { /* ignore */ } tooltipRefreshTimer = undefined; }
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
    // Refresh tooltip when discovery snapshot changes
    sseServer.onDiscoveryUpdated = () => {
      if (sseServer?.serverStatus === 'running') {
        updateServerStatusBar('running');
      }
    };
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

  // Register wrapper command for logging result of built-in resetCachedTools command
  context.subscriptions.push(
    vscode.commands.registerCommand(WRAPPED_RESET_CMD, async () => {
      outputChannel.appendLine('Invoking reset cached tools...');
      // Preserve previous state
      const prevText = serverStatusBarItem.text;
      const prevTooltip = serverStatusBarItem.tooltip;
      try {
        serverStatusBarItem.text = '$(sync~spin) VSC MCP';
        serverStatusBarItem.tooltip = 'Resetting cached tools...';
        serverStatusBarItem.show();
        const startedAt = Date.now();
        const result = await vscode.commands.executeCommand(BUILT_IN_RESET_CMD as string);
        const elapsed = Date.now() - startedAt;
        outputChannel.appendLine(`Reset cached tools completed in ${elapsed} ms.`);
        // Ensure spinner visible at least 1s
        const remaining = 1000 - elapsed;
        await new Promise((r) => setTimeout(r, remaining > 0 ? remaining : 0));
        // Restore previous UI if still in running state
        serverStatusBarItem.text = prevText;
        serverStatusBarItem.tooltip = prevTooltip;
        serverStatusBarItem.show();
        return result;
      } catch (err: unknown) {
        const e = err as Error | string;
        outputChannel.appendLine('Error executing reset: ' + (e instanceof Error ? e.message : String(e)));
        // Restore previous UI (error state but keep original visual)
        serverStatusBarItem.text = prevText;
        serverStatusBarItem.tooltip = prevTooltip;
        serverStatusBarItem.show();
        throw err;
      }
    })
  );

  outputChannel.appendLine(`${extensionDisplayName} activated.`);
};

export function deactivate() {
  // Clean-up is managed by the disposables added in the activate method.
}
