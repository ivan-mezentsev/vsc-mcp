import * as vscode from 'vscode';
import { z } from 'zod';

// Zod schema consistent with other tools
export const focusEditorSchema = z.object({
    filePath: z.string().describe('The absolute path to the file to focus in the editor.'),
    line: z.number().int().min(0).optional().default(0).describe('The line number to navigate to (default: 0).'),
    column: z.number().int().min(0).optional().default(0).describe('The column position to navigate to (default: 0).'),
    startLine: z.number().int().min(0).optional().describe('The starting line number for highlighting.'),
    startColumn: z.number().int().min(0).optional().describe('The starting column number for highlighting.'),
    endLine: z.number().int().min(0).optional().describe('The ending line number for highlighting.'),
    endColumn: z.number().int().min(0).optional().describe('The ending column number for highlighting.'),
});

// Internal executor: focuses editor and returns a user-facing message
async function focusEditorExecute(params: z.infer<typeof focusEditorSchema>): Promise<string> {
    const {
        filePath,
        line = 0,
        column = 0,
        startLine,
        startColumn,
        endLine,
        endColumn,
    } = params;

    const uri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(uri); // Open the document
    const editor = await vscode.window.showTextDocument(document); // Show it in the editor

    // Highlight range if all range parameters are provided and not all zeros
    if (
        typeof startLine === 'number' &&
        typeof startColumn === 'number' &&
        typeof endLine === 'number' &&
        typeof endColumn === 'number' &&
        (startLine !== 0 || startColumn !== 0 || endLine !== 0 || endColumn !== 0)
    ) {
        const start = new vscode.Position(startLine, startColumn);
        const end = new vscode.Position(endLine, endColumn);
        editor.selection = new vscode.Selection(start, end);
        editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
        return `Focused file: ${filePath} with highlighted range from line ${startLine}, column ${startColumn} to line ${endLine}, column ${endColumn}`;
    }

    // Move the cursor to the specified position
    const position = new vscode.Position(line, column);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(position, position);
    return `Focused file: ${filePath} at line ${line}, column ${column}`;
}

// Public handler with unified return shape
export async function focusEditorToolHandler(params: z.infer<typeof focusEditorSchema>) {
    try {
        const message = await focusEditorExecute(params);
        return {
            isError: false,
            content: [{ text: message }],
        };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
            isError: true,
            content: [{ text: `Failed to focus editor: ${msg}` }],
        };
    }
}
