import * as vscode from 'vscode';
import { StatusBarManager } from './StatusBarManager';

/**
 * Configuration-based confirmation UI utility class for VSC MCP
 */
export class ConfirmationUI {
  // StatusBarManager singleton instance
  private static statusBarManager: StatusBarManager | null = null;

  /**
   * Gets or initializes the StatusBarManager instance
   */
  private static getStatusBarManager(): StatusBarManager {
    if (!this.statusBarManager) {
      this.statusBarManager = new StatusBarManager();
    }
    return this.statusBarManager;
  }

  /**
   * Shows confirmation UI based on configuration
   * @param message Confirmation message
   * @param detail Additional detail information (like command)
   * @param approveLabel Label for approve button
   * @param denyLabel Label for deny button
   * @returns "Approve" if approved, "Deny" or reason text if denied
   */
  static async confirm(message: string, detail: string, approveLabel: string, denyLabel: string): Promise<string> {
    // Get confirmation UI method from configuration
    const config = vscode.workspace.getConfiguration('vscMcp');
    const confirmationUI = config.get<string>('confirmationUI', 'quickPick');

    console.log(`[ConfirmationUI] Using ${confirmationUI} UI for confirmation`);

    if (confirmationUI === 'quickPick') {
      return await this.showQuickPickConfirmation(message, detail, approveLabel, denyLabel);
    } else {
      return await this.showStatusBarConfirmation(message, detail, approveLabel, denyLabel);
    }
  }

  /**
   * Shows confirmation UI using QuickPick
   */
  private static async showQuickPickConfirmation(
    message: string, 
    detail: string, 
    approveLabel: string,
    denyLabel: string
  ): Promise<string> {
    // Create QuickPick
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
   * Shows confirmation UI using status bar
   */
  private static async showStatusBarConfirmation(
    message: string, 
    detail: string, 
    approveLabel: string,
    denyLabel: string
  ): Promise<string> {
    // Show message
    vscode.window.showInformationMessage(`${message} ${detail ? `- ${detail}` : ''}`);

    // Get StatusBarManager instance
    try {
      const statusBarManager = this.getStatusBarManager();

      // Use StatusBarManager to wait for user selection
      console.log('[ConfirmationUI] Using StatusBarManager for confirmation');
      const approved = await statusBarManager.ask(approveLabel, denyLabel);
      statusBarManager.hide();

      // Return "Approve" if approved
      if (approved) {
        return "Approve";
      }

      // If denied, collect additional feedback
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
      // Fall back to QuickPick if error occurs
      console.log('[ConfirmationUI] Falling back to QuickPick confirmation');
      return await this.showQuickPickConfirmation(message, detail, approveLabel, denyLabel);
    }
  }
}