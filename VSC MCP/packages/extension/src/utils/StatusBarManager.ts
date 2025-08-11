import * as vscode from 'vscode';

export class StatusBarManager {
  private applyButton: vscode.StatusBarItem;
  private discardButton: vscode.StatusBarItem;
  private resolvePromise: ((value: boolean) => void) | null = null;

  constructor() {
    // Create Apply button in status bar (checkmark icon)
    this.applyButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, Infinity);
    this.applyButton.text = "$(check)";
    this.applyButton.command = 'vscMcp.textEditor.applyChanges';
    this.applyButton.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.applyButton.tooltip = "Apply the pending changes";

    // Create Discard button in status bar (x icon)
    this.discardButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, Infinity);
    this.discardButton.text = "$(x)";
    this.discardButton.command = 'vscMcp.textEditor.cancelChanges';
    this.discardButton.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.discardButton.tooltip = "Discard the pending changes";

    // Register commands
    this.registerCommands();
  }

  private registerCommands(): void {
    console.log('[StatusBarManager] Registering commands');

    // Register VSC MCP text editor commands
    vscode.commands.registerCommand('vscMcp.textEditor.applyChanges', () => {
      console.log('[StatusBarManager] VSC MCP apply command triggered');
      this.hide();
      this.resolvePromise?.(true);
      this.resolvePromise = null;
      return true;
    });

    vscode.commands.registerCommand('vscMcp.textEditor.cancelChanges', () => {
      console.log('[StatusBarManager] VSC MCP cancel command triggered');
      this.hide();
      this.resolvePromise?.(false);
      this.resolvePromise = null;
      return false;
    });
  }

  /**
   * Show buttons in status bar and wait for user selection
   * @param applyLabel Label for apply button (default is "Apply Change")
   * @param discardLabel Label for discard button (default is "Discard Change")
   * @returns true if user selects apply button, false if discard button
   */
  async ask(applyLabel: string, discardLabel: string): Promise<boolean> {
    console.log('[StatusBarManager] ask method called');

    this.applyButton.text = `$(check) ${applyLabel}`;
    this.discardButton.text = `$(x) ${discardLabel}`;

    return new Promise<boolean>((resolve) => {
      console.log('[StatusBarManager] Setting resolvePromise and showing buttons');
      this.resolvePromise = resolve;
      this.show();
    });
  }

  /**
   * Show buttons in status bar
   */
  private show(): void {
    this.applyButton.show();
    this.discardButton.show();
  }

  /**
   * Hide buttons from status bar
   */
  hide(): void {
    this.applyButton.hide();
    this.discardButton.hide();
  }

  /**
   * Release resources
   */
  dispose(): void {
    this.hide();
    this.applyButton.dispose();
    this.discardButton.dispose();
  }
}