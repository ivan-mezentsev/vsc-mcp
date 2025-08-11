import * as vscode from "vscode"
import { z } from "zod"
import { TerminalManager } from "../integrations/terminal/TerminalManager"
import { ConfirmationUI } from "../utils/confirmation_ui"
import { formatResponse, ToolResponse } from "../utils/response"
import { delay } from "../utils/time.js"

export const executeCommandSchema = z.object({
  command: z.string().describe("The command to execute"),
  customCwd: z.string().optional().describe("Optional custom working directory for command execution"),
  modifySomething: z.boolean().optional().default(true).describe(
    "Flag indicating if the command is potentially destructive or modifying. Default is true. " +
      "Set to false for read-only commands (like grep, find, ls) to skip user confirmation. " +
      "Commands that could modify files or system state should keep this as true. " +
      "Note: User can override this behavior with the vscMcp.confirmNonDestructiveCommands setting."
  ),
  background: z.boolean().optional().default(false).describe(
    "Flag indicating if the command should run in the background without waiting for completion. " +
    "When true, the tool will return immediately after starting the command. " +
    "Default is false, which means the tool will wait for command completion. " +
    "Always specify background=true or a timeout for commands that may never terminate, such as servers, " +
    "or commands that might invoke pagers. This greatly impacts user experience."
  ),
  timeout: z.number().optional().default(300000).describe(
    "Timeout in milliseconds after which the command execution will be considered complete for reporting purposes. " +
    "Does not actually terminate the command. Default is 300000 (5 minutes). " +
    "Always specify background=true or an appropriate timeout for commands that may never terminate, such as servers, " +
    "or commands that might invoke pagers. This greatly impacts user experience."
  ),
})

export class ExecuteCommandTool {
  private cwd: string
  private terminalManager: TerminalManager

  constructor(cwd: string) {
    this.cwd = cwd
    this.terminalManager = new TerminalManager()
  }

  async execute(
    command: string,
    customCwd?: string,
    modifySomething: boolean = true,
    background: boolean = false,
    timeout: number = 300000
  ): Promise<[userRejected: boolean, ToolResponse]> {
    // Get setting for confirming non-destructive commands
    const config = vscode.workspace.getConfiguration("vscMcp");
    const confirmNonDestructiveCommands = config.get<boolean>("confirmNonDestructiveCommands", false);

    // Determine if we need to ask for confirmation
    const shouldConfirm = modifySomething || confirmNonDestructiveCommands;

    if (shouldConfirm) {
      // Ask for permission based on either:
      // 1. Command is potentially destructive OR
      // 2. User has enabled confirmation for all commands
      const userResponse = await this.ask(command);

      // If user denied execution
      if (userResponse !== "Approve") {
        return [
          false,
          formatResponse.toolResult(`Command execution was denied by the user. ${userResponse !== "Deny" ? `Feedback: ${userResponse}` : ""}`)
        ];
      }
    } else {
      // For non-destructive commands when confirmation is disabled, log that we're skipping confirmation
      console.log(`Executing read-only command without confirmation: ${command}`);
    }

    const terminalInfo = await this.terminalManager.getOrCreateTerminal(customCwd || this.cwd)
    terminalInfo.terminal.show() // weird visual bug when creating new terminals (even manually) where there's an empty space at the top.
    const process = this.terminalManager.runCommand(terminalInfo, command)

    let result = ""
    process.on("line", (line) => {
      result += line + "\n"
    })

    let completed = false
    process.once("completed", () => {
      completed = true
    })

    process.once("no_shell_integration", async () => {
      await vscode.window.showWarningMessage("Shell integration is not available. Some features may be limited.")
    })

    // If background flag is set, don't wait for process completion
    if (background) {
      const terminalId = terminalInfo.id;
      return [
        false,
        formatResponse.toolResult(
          `Command started in background mode and is running in the terminal (id: ${terminalId}). ` +
          `You can check the output later using the get_terminal_output tool with this terminal id.`
        ),
      ]
    }

    // Create a promise that resolves after the timeout
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, timeout);
    });

    // Wait for either the process to complete or the timeout to occur
    await Promise.race([process, timeoutPromise]);

    // Wait for a short delay to ensure all messages are sent to the webview
    // This delay allows time for non-awaited promises to be created and
    // for their associated messages to be sent to the webview, maintaining
    // the correct order of messages (although the webview is smart about
    // grouping command_output messages despite any gaps anyways)
    await delay(50);

    result = result.trim();

    const terminalId = terminalInfo.id;

    if (completed) {
      return [false, formatResponse.toolResult(
        `Command executed in terminal (id: ${terminalId}).${result ? `\nOutput:\n${result}` : ""}`
      )]
    } else {
      // If we got here and it's not completed, it's either still running or hit the timeout
      const timeoutMessage = timeout !== 300000 ? ` (timeout: ${timeout}ms)` : "";
      return [
        false,
        formatResponse.toolResult(
          `Command is still running in terminal (id: ${terminalId})${timeoutMessage}.${result ? `\nHere's the output so far:\n${result}` : ""
          }\n\nYou can check for more output later using the get_terminal_output tool with this terminal id.`
        ),
      ]
    }
  }

  protected async ask(command: string): Promise<string> {
    return await ConfirmationUI.confirm("Execute Command?", command, "Execute Command", "Deny");
  }
}

export async function executeCommandToolHandler(params: z.infer<typeof executeCommandSchema>) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return {
      isError: true,
      content: [{ text: "No workspace folder is open" }],
    };
  }

  const tool = new ExecuteCommandTool(workspaceRoot);
  const [success, response] = await tool.execute(
    params.command,
    params.customCwd,
    params.modifySomething,
    params.background,
    params.timeout
  );

  return {
    isError: !success,
    content: [{ text: response.text }],
  };
}
