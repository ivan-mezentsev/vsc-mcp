import * as vscode from "vscode";
import { z } from "zod";

export const previewUrlSchema = z.object({
  url: z.string().url().describe("The URL to preview in the simple browser (must start with http:// or https://)"),
});

export async function previewUrlToolHandler(params: z.infer<typeof previewUrlSchema>) {
  try {
    // Validate URL
    try {
      new URL(params.url); // This will throw if invalid
    } catch (error) {
      return {
        isError: true,
        content: [{ text: `Invalid URL: ${params.url}. Error: ${error}` }]
      };
    }

    // Execute the command with ViewColumn.Two to open beside the current editor
    await vscode.commands.executeCommand('simpleBrowser.api.open', params.url, {
      viewColumn: vscode.ViewColumn.Two,
      preserveFocus: false
    });

    return {
      isError: false,
      content: [{ text: `Successfully opened ${params.url} in simple browser beside the current editor.` }]
    };
  } catch (error) {
    console.error("Error previewing URL:", error);
    return {
      isError: true,
      content: [{ text: `Error previewing URL ${params.url}: ${error}` }]
    };
  }
}
