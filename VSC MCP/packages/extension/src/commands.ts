import * as vscode from 'vscode';

interface CommandHandlers {
  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
  toggleActiveStatus: () => Promise<void>;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  handlers: CommandHandlers
) {
  const commands = [
    vscode.commands.registerCommand('vscMcp.startServer', handlers.startServer),
    vscode.commands.registerCommand('vscMcp.stopServer', handlers.stopServer),
    vscode.commands.registerCommand('vscMcp.toggleActiveStatus', handlers.toggleActiveStatus)
  ];

  commands.forEach(command => context.subscriptions.push(command));
}