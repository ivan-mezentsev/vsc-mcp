import * as vscode from "vscode"
import { z } from "zod"
import { stripAnsi } from "../integrations/terminal/ansiUtils.js"
import { TerminalRegistry } from "../integrations/terminal/TerminalRegistry"
import { formatResponse, ToolResponse } from "../utils/response"

export const getTerminalOutputSchema = z.object({
  terminalId: z.string().or(z.number()).describe("The ID of the terminal to get output from"),
  maxLines: z.number().optional().default(1000).describe("Maximum number of lines to retrieve (default: 1000)"),
})

export class GetTerminalOutputTool {
  async execute(terminalId: string | number, maxLines: number = 1000): Promise<ToolResponse> {
    // Convert terminalId to number if it's a string
    const id = typeof terminalId === 'string' ? parseInt(terminalId, 10) : terminalId

    if (isNaN(id)) {
      return formatResponse.toolResult(`Invalid terminal ID: ${terminalId}. Please provide a valid numeric ID.`)
    }

    // Get terminal from registry
    const terminalInfo = TerminalRegistry.getTerminal(id)
    if (!terminalInfo) {
      return formatResponse.toolResult(`Terminal with ID ${id} not found or has been closed.`)
    }

    try {
      // Focus the terminal
      terminalInfo.terminal.show()

      // Store original clipboard content to restore later
      const originalClipboard = await vscode.env.clipboard.readText()

      try {
        // Select terminal content
        await vscode.commands.executeCommand("workbench.action.terminal.selectAll")

        // Copy selection to clipboard
        await vscode.commands.executeCommand("workbench.action.terminal.copySelection")

        // Clear the selection
        await vscode.commands.executeCommand("workbench.action.terminal.clearSelection")

        // Get terminal contents from clipboard
        let terminalContents = (await vscode.env.clipboard.readText()).trim()

        // Check if there's actually a terminal open
        if (terminalContents === originalClipboard) {
          return formatResponse.toolResult(`No content found in terminal ${id}.`)
        }

        // Remove ANSI escape sequences
        terminalContents = stripAnsi(terminalContents)

        // Limit number of lines if needed
        let lines = terminalContents.split('\n')
        if (lines.length > maxLines) {
          lines = lines.slice(-maxLines)
          terminalContents = lines.join('\n')
        }

        return formatResponse.toolResult(
          `Terminal ${id} output (${terminalInfo.busy ? "busy" : "idle"})${terminalInfo.lastCommand ? `, last command: "${terminalInfo.lastCommand}"` : ""
          }:\n\n${terminalContents}`
        )
      } finally {
        // Restore original clipboard content
        await vscode.env.clipboard.writeText(originalClipboard)
      }
    } catch (error) {
      console.error(`Error retrieving terminal output:`, error)
      return formatResponse.toolResult(
        `Error retrieving output from terminal ${id}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}

export async function getTerminalOutputToolHandler(params: z.infer<typeof getTerminalOutputSchema>) {
  const tool = new GetTerminalOutputTool()
  const response = await tool.execute(params.terminalId, params.maxLines)

  return {
    isError: false,
    content: [{ text: response.text }],
  }
}
