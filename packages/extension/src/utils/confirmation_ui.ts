import * as vscode from 'vscode';
import { StatusBarManager } from './StatusBarManager';

/**
 * 設定に基づいて確認UIを表示するユーティリティクラス
 */
export class ConfirmationUI {
  // StatusBarManagerのシングルトンインスタンス
  private static statusBarManager: StatusBarManager | null = null;

  /**
   * StatusBarManagerのインスタンスを取得または初期化します
   */
  private static getStatusBarManager(): StatusBarManager {
    if (!this.statusBarManager) {
      this.statusBarManager = new StatusBarManager();
    }
    return this.statusBarManager;
  }

  /**
   * Show an InputBox-based confirmation with editable command text.
   * Returns the user's decision and the (possibly edited) command.
   */
  static async confirmCommandWithInputBox(
    message: string,
    initialCommand: string,
    approveLabel: string,
    denyLabel: string
  ): Promise<{ decision: 'Approve' | 'Deny'; command: string; feedback?: string }> {
    const inputBox = vscode.window.createInputBox();
    inputBox.title = message;
    inputBox.value = initialCommand;
    inputBox.ignoreFocusOut = true;

    const approveButton: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('check'),
      tooltip: approveLabel,
    };
    const denyButton: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('x'),
      tooltip: denyLabel,
    };
    inputBox.buttons = [approveButton, denyButton];

    return await new Promise((resolve) => {
      let handled = false; // set true when approve/deny button is used
      const approve = () => {
        handled = true;
        const cmd = inputBox.value;
        inputBox.hide();
        resolve({ decision: 'Approve', command: cmd });
      };
      const deny = async () => {
        handled = true;
        const cmd = inputBox.value;
        inputBox.hide();
        // Ask optional feedback similar to other UIs
        const fb = vscode.window.createInputBox();
        fb.title = 'Feedback';
        fb.placeholder = 'Add context for the agent (optional)';
        fb.ignoreFocusOut = true;
        const fbApproveButton: vscode.QuickInputButton = {
          iconPath: new vscode.ThemeIcon('check'),
          tooltip: 'Send feedback',
        };
        const fbBackButton: vscode.QuickInputButton = {
          iconPath: new vscode.ThemeIcon('x'),
          tooltip: 'Back to command',
        };
        fb.buttons = [fbApproveButton, fbBackButton];
        let sent = false;
        fb.onDidAccept(() => {
          sent = true;
          const feedback = fb.value.trim();
          fb.hide();
          resolve({ decision: 'Deny', command: cmd, feedback: feedback || undefined });
        });
        fb.onDidTriggerButton((btn) => {
          if (btn === fbApproveButton) {
            sent = true;
            const feedback = fb.value.trim();
            fb.hide();
            resolve({ decision: 'Deny', command: cmd, feedback: feedback || undefined });
          } else if (btn === fbBackButton) {
            fb.hide();
          }
        });
        fb.onDidHide(() => {
          // ESC/close or Back button => return to command (unless feedback was sent)
          if (!sent) {
            handled = false; // allow main input to decide later
            inputBox.show();
          }
        });
        fb.show();
      };

      inputBox.onDidTriggerButton((btn) => {
        if (btn === approveButton) {
          approve();
        } else if (btn === denyButton) {
          deny();
        }
      });
      inputBox.onDidAccept(() => {
        // Enter acts as Approve
        approve();
      });
      inputBox.onDidHide(() => {
        // ESC/close behaves like clicking Deny -> open feedback flow
        if (!handled) {
          deny();
        }
      });
      inputBox.show();
    });
  }

  /**
   * 設定に基づいてコマンド実行前の確認UIを表示します
   * @param message 確認メッセージ
   * @param detail 追加の詳細情報（コマンドなど）
   * @param approveLabel 承認ボタンのラベル
   * @param denyLabel 拒否ボタンのラベル
   * @returns 承認された場合は "Approve"、拒否された場合は "Deny" または理由テキスト
   */
  static async confirm(message: string, detail: string, approveLabel: string, denyLabel: string): Promise<string> {
    // 設定から確認UI方法を取得
    const config = vscode.workspace.getConfiguration('mcpServer');
    const confirmationUI = config.get<string>('confirmationUI', 'InputBox');

    console.log(`[ConfirmationUI] Using ${confirmationUI} UI for confirmation`);

    if (confirmationUI === 'InputBox') {
      return await this.showInputBoxConfirmation(message, detail, approveLabel, denyLabel);
    } else if (confirmationUI === 'quickPick') {
      return await this.showQuickPickConfirmation(message, detail, approveLabel, denyLabel);
    } else {
      return await this.showStatusBarConfirmation(message, detail, approveLabel, denyLabel);
    }
  }

  /**
   * QuickPickを使用した確認UIを表示します
   */
  private static async showQuickPickConfirmation(
    message: string, 
    detail: string, 
    approveLabel: string,
    denyLabel: string
  ): Promise<string> {
    // QuickPickを作成
    const quickPick = vscode.window.createQuickPick();

    quickPick.title = message;
    quickPick.placeholder = detail || '';

    quickPick.items = [
      { label: `$(check) Approve`, description: approveLabel },
      { label: `$(x) Deny`, description: denyLabel }
    ];
    quickPick.canSelectMany = false;
    quickPick.ignoreFocusOut = true;

    return new Promise<string>(async (resolve) => {
      quickPick.onDidAccept(async () => {
        const selection = quickPick.selectedItems[0];
        quickPick.hide();

        if (selection.label.includes("Approve")) {
          resolve("Approve");
        } else {
          // Show QuickInput for feedback if denied
          const inputBox = vscode.window.createInputBox();
          inputBox.title = "Feedback";
          inputBox.placeholder = "Add context for the agent (optional)";

          inputBox.onDidAccept(() => {
            const feedback = inputBox.value.trim();
            inputBox.hide();
            resolve(feedback || "Deny");
          });

          inputBox.onDidHide(() => {
            if (inputBox.value.trim() === "") {
              resolve("Deny");
            }
          });

          inputBox.show();
        }
      });

      quickPick.onDidHide(() => {
        // Handle dismissal of the QuickPick
        if (!quickPick.selectedItems || quickPick.selectedItems.length === 0) {
          resolve("Deny");
        }
      });

      quickPick.show();
    });
  }

  /**
   * Show an InputBox-based confirmation with approve/deny buttons.
   * Unlike confirmCommandWithInputBox, any edited value is ignored and only a decision or feedback is returned.
   */
  private static async showInputBoxConfirmation(
    message: string,
    detail: string,
    approveLabel: string,
    denyLabel: string
  ): Promise<string> {
    const inputBox = vscode.window.createInputBox();
    inputBox.title = message;
    inputBox.value = detail || '';
    inputBox.placeholder = detail ? '' : '';
    inputBox.ignoreFocusOut = true;

    const approveButton: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('check'),
      tooltip: approveLabel,
    };
    const denyButton: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('x'),
      tooltip: denyLabel,
    };
    inputBox.buttons = [approveButton, denyButton];

    return await new Promise<string>((resolve) => {
      let handled = false;
      const approve = () => {
        handled = true;
        inputBox.hide();
        resolve('Approve');
      };
      const deny = async () => {
        handled = true;
        inputBox.hide();

        // Ask optional feedback similar to other UIs
        const fb = vscode.window.createInputBox();
        fb.title = 'Feedback';
        fb.placeholder = 'Add context for the agent (optional)';
        fb.ignoreFocusOut = true;
        const fbApproveButton: vscode.QuickInputButton = {
          iconPath: new vscode.ThemeIcon('check'),
          tooltip: 'Send feedback',
        };
        const fbBackButton: vscode.QuickInputButton = {
          iconPath: new vscode.ThemeIcon('x'),
          tooltip: 'Back to confirmation',
        };
        fb.buttons = [fbApproveButton, fbBackButton];
        let sent = false;
        fb.onDidAccept(() => {
          sent = true;
          const feedback = fb.value.trim();
          fb.hide();
          resolve(feedback || 'Deny');
        });
        fb.onDidTriggerButton((btn) => {
          if (btn === fbApproveButton) {
            sent = true;
            const feedback = fb.value.trim();
            fb.hide();
            resolve(feedback || 'Deny');
          } else if (btn === fbBackButton) {
            fb.hide();
          }
        });
        fb.onDidHide(() => {
          // ESC/close or Back button => return to main input (unless feedback was sent)
          if (!sent) {
            handled = false;
            inputBox.show();
          }
        });
        fb.show();
      };

      inputBox.onDidTriggerButton((btn) => {
        if (btn === approveButton) {
          approve();
        } else if (btn === denyButton) {
          deny();
        }
      });
      inputBox.onDidAccept(() => {
        approve();
      });
      inputBox.onDidHide(() => {
        if (!handled) {
          deny();
        }
      });
      inputBox.show();
    });
  }

  /**
   * ステータスバーを使用した確認UIを表示します
   */
  private static async showStatusBarConfirmation(
    message: string, 
    detail: string, 
    approveLabel: string,
    denyLabel: string
  ): Promise<string> {
    // メッセージを表示
    vscode.window.showInformationMessage(`${message} ${detail ? `- ${detail}` : ''}`);

    // StatusBarManagerのインスタンスを取得
    try {
      const statusBarManager = this.getStatusBarManager();

      // StatusBarManagerを使用してユーザーの選択を待機
      console.log('[ConfirmationUI] Using StatusBarManager for confirmation');
      const approved = await statusBarManager.ask(approveLabel, denyLabel);
      statusBarManager.hide();

      // 承認された場合は "Approve" を返す
      if (approved) {
        return "Approve";
      }

      // 拒否された場合は追加のフィードバックを収集
      const inputBox = vscode.window.createInputBox();
      inputBox.title = "Feedback";
      inputBox.placeholder = "Add context for the agent (optional)";

      return new Promise<string>((resolve) => {
        inputBox.onDidAccept(() => {
          const feedback = inputBox.value.trim();
          inputBox.hide();
          resolve(feedback || "Deny");
        });

        inputBox.onDidHide(() => {
          if (inputBox.value.trim() === "") {
            resolve("Deny");
          }
        });

        inputBox.show();
      });
    } catch (error) {
      console.error('Error using StatusBarManager:', error);
      // エラーが発生した場合はQuickPickにフォールバック
      console.log('[ConfirmationUI] Falling back to QuickPick confirmation');
      return await this.showQuickPickConfirmation(message, detail, approveLabel, denyLabel);
    }
  }
}
