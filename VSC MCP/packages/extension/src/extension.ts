import * as vscode from 'vscode';
import { createMcpServer } from './mcp-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { HTTPServerTransport } from './transport/http-transport';

let mcpServer: McpServer | null = null;
let mcpTransport: HTTPServerTransport | null = null;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  console.log('VSC MCP extension is being activated');

  // Create output channel
  outputChannel = vscode.window.createOutputChannel('VSC MCP');
  context.subscriptions.push(outputChannel);

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100);
  statusBarItem.command = 'vscMcp.toggle';
  context.subscriptions.push(statusBarItem);

  // Register commands
  const commands = [
    vscode.commands.registerCommand('vscMcp.start', () => startServer()),
    vscode.commands.registerCommand('vscMcp.stop', () => stopServer()),
    vscode.commands.registerCommand('vscMcp.restart', () => restartServer()),
    vscode.commands.registerCommand('vscMcp.toggle', () => toggleServer()),
  ];

  commands.forEach(command => context.subscriptions.push(command));

  // Update status bar initially
  updateStatusBar();

  // Auto-start if configured
  const config = vscode.workspace.getConfiguration('vscMcp');
  const startOnActivate = config.get<boolean>('startOnActivate', true);
  
  if (startOnActivate) {
    outputChannel.appendLine('Auto-starting VSC MCP server...');
    await startServer();
  }
}

export function deactivate() {
  console.log('VSC MCP extension is being deactivated');
  return stopServer();
}

async function startServer(): Promise<void> {
  if (mcpServer) {
    outputChannel.appendLine('VSC MCP server is already running');
    return;
  }

  try {
    const config = vscode.workspace.getConfiguration('vscMcp');
    const port = config.get<number>('port', 60100);

    outputChannel.appendLine(`Starting VSC MCP server on port ${port}...`);

    // Create MCP server
    mcpServer = createMcpServer(outputChannel);

    // Create HTTP transport
    mcpTransport = new HTTPServerTransport(port, outputChannel);

    // Start the transport
    await mcpTransport.start();

    // Connect server to transport
    await mcpServer.connect(mcpTransport);

    outputChannel.appendLine(`VSC MCP server started successfully on port ${port}`);
    vscode.window.showInformationMessage(`VSC MCP server running on port ${port}`);

  } catch (error) {
    const errorMessage = `Failed to start VSC MCP server: ${error instanceof Error ? error.message : String(error)}`;
    outputChannel.appendLine(errorMessage);
    vscode.window.showErrorMessage(errorMessage);
    
    // Clean up on error
    mcpServer = null;
    mcpTransport = null;
  }

  updateStatusBar();
}

async function stopServer(): Promise<void> {
  if (!mcpServer) {
    outputChannel.appendLine('VSC MCP server is not running');
    return;
  }

  try {
    outputChannel.appendLine('Stopping VSC MCP server...');

    // Disconnect and cleanup
    if (mcpTransport) {
      await mcpTransport.close();
      mcpTransport = null;
    }

    if (mcpServer) {
      await mcpServer.close();
      mcpServer = null;
    }

    outputChannel.appendLine('VSC MCP server stopped successfully');
    vscode.window.showInformationMessage('VSC MCP server stopped');

  } catch (error) {
    const errorMessage = `Error stopping VSC MCP server: ${error instanceof Error ? error.message : String(error)}`;
    outputChannel.appendLine(errorMessage);
    vscode.window.showErrorMessage(errorMessage);
  }

  updateStatusBar();
}

async function restartServer(): Promise<void> {
  outputChannel.appendLine('Restarting VSC MCP server...');
  await stopServer();
  await startServer();
}

async function toggleServer(): Promise<void> {
  if (mcpServer) {
    await stopServer();
  } else {
    await startServer();
  }
}

function updateStatusBar(): void {
  if (mcpServer) {
    const config = vscode.workspace.getConfiguration('vscMcp');
    const port = config.get<number>('port', 60100);
    statusBarItem.text = `$(server-process) VSC MCP:${port}`;
    statusBarItem.tooltip = `VSC MCP server running on port ${port}. Click to stop.`;
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = `$(server-process) VSC MCP:Off`;
    statusBarItem.tooltip = 'VSC MCP server is stopped. Click to start.';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  statusBarItem.show();
}