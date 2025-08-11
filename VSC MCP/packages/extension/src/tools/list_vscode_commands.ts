import * as vscode from "vscode";
import { z } from "zod";

export const listVSCodeCommandsSchema = z.object({
  filter: z.string().optional().describe("Optional filter string to narrow down the commands list"),
  limit: z.number().optional().default(100).describe("Maximum number of commands to return (default: 100)")
})

export async function listVSCodeCommandsToolHandler(params: z.infer<typeof listVSCodeCommandsSchema>) {
  try {
    // Get all available commands
    const commands = await vscode.commands.getCommands(true);

    // Filter commands if a filter string is provided
    let filteredCommands = commands;
    if (params.filter) {
      const filterLower = params.filter.toLowerCase();
      filteredCommands = commands.filter(cmd => cmd.toLowerCase().includes(filterLower));
    }

    // Sort commands alphabetically
    filteredCommands.sort();

    // Apply limit
    const limitedCommands = filteredCommands.slice(0, params.limit);

    // Format the response
    const totalCount = filteredCommands.length;
    const shownCount = limitedCommands.length;

    let resultText = `Found ${totalCount} commands`;
    if (params.filter) {
      resultText += ` matching filter "${params.filter}"`;
    }

    if (totalCount > shownCount) {
      resultText += ` (showing first ${shownCount})`;
    }

    resultText += ":\n\n";
    resultText += limitedCommands.join("\n");

    return {
      isError: false,
      content: [{ text: resultText }]
    };
  } catch (error) {
    console.error("Error listing VSCode commands:", error);
    return {
      isError: true,
      content: [{ text: `Error listing VSCode commands: ${error}` }]
    };
  }
}
