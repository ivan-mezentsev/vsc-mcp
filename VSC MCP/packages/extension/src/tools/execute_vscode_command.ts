import * as vscode from "vscode";
import { z } from "zod";

export const executeVSCodeCommandSchema = z.object({
  command: z.string().describe("The VSCode command ID to execute"),
  args: z.array(z.any()).optional().describe("Optional arguments to pass to the command")
})

export async function executeVSCodeCommandToolHandler(params: z.infer<typeof executeVSCodeCommandSchema>) {
  try {
    // Check if the command exists in the list of available commands
    const availableCommands = await vscode.commands.getCommands(true);
    if (!availableCommands.includes(params.command)) {
      return {
        isError: true,
        content: [{ text: `Command "${params.command}" not found in the list of available commands` }]
      };
    }

    // Execute the command with optional arguments
    const result = params.args
      ? await vscode.commands.executeCommand(params.command, ...params.args)
      : await vscode.commands.executeCommand(params.command);

    let resultText = `Command "${params.command}" executed successfully`;

    // If the command returned a result, include it in the response
    if (result !== undefined) {
      try {
        // Try to stringify the result if it's an object
        if (typeof result === 'object') {
          const stringifiedResult = JSON.stringify(result, null, 2);
          resultText += `\n\nResult:\n${stringifiedResult}`;
        } else {
          resultText += `\n\nResult: ${result}`;
        }
      } catch (error) {
        resultText += `\n\nCommand returned a result, but it could not be stringified: ${error}`;
      }
    }

    return {
      isError: false,
      content: [{ text: resultText }]
    };
  } catch (error) {
    console.error("Error executing VSCode command:", error);
    return {
      isError: true,
      content: [{ text: `Error executing VSCode command "${params.command}": ${error}` }]
    };
  }
}
