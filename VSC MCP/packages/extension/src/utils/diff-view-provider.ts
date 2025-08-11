import * as vscode from 'vscode';

export const DIFF_VIEW_URI_SCHEME = 'vsc-mcp-diff';

export class DiffViewProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this._onDidChange.event;

  private diffContents = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.diffContents.get(uri.toString()) || '';
  }

  setDiffContent(uri: vscode.Uri, content: string) {
    this.diffContents.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }

  dispose() {
    this._onDidChange.dispose();
  }
}