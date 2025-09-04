# VSC-MCP Server

A VSCode extension that exposes your IDE as an MCP server — compensating for missing capabilities required by AI agents and enabling advanced control.

## Key Features

### Ask Report "Human In The Loop"

- Interactive webview to prompt the user with Markdown content and predefined options or custom input. Includes copy-to-clipboard, external links handling, submit/cancel actions, and a configurable countdown timer with pause/resume.

![AskReport](https://github.com/ivan-mezentsev/vsc-mcp/raw/master/docs/demo_AskReport.gif)

Example of "Human In The Loop" mode in chat of Github Copilot:

```text
Can you check the docs and explain how the project works? #vscode
```

### Terminal Operations

- Execute commands within VSCode’s integrated terminal (supports background/foreground execution, and timeout settings).

![InputBox](https://github.com/ivan-mezentsev/vsc-mcp/raw/master/docs/demo_InputBox.gif)

## Available Built-in Tools

- **execute_command**: Execute commands in VSCode’s integrated terminal
- **code_checker**: Retrieve current diagnostics for your code
- **focus_editor**: Focus specific locations within files
- **get_terminal_output**: Fetch output from a specified terminal
- **ask_report**: Prompt the user via a webview using Markdown and optional predefined options.

## Configuration

1. Disable the IDE's default terminal tools
![IDE tools configuration](https://github.com/ivan-mezentsev/vsc-mcp/raw/master/docs/tools_setup.png)

2. Configure your MCP client:

    Clients like VSCode, Cursor, Trae: add the following to your configuration file (mcp.json):

    ```json
    {
      "mcpServers": {
        "vscode": {
          "command": "npx",
          "args": [
            "vsc-mcp"
          ],
          "type": "stdio",
          "env": {
            "DISCOVERY_PORT": 60100
          }
        }
      }
    }
    ```

3. Check the MCP server status in the bottom-left VSCode status bar:

    ![Server status indicator](https://github.com/ivan-mezentsev/vsc-mcp/raw/master/docs/status_on.png)

4. Recommended rules for AI agents:

```markdown
## Code Development
- **After code editing**: Always check code using `mcp_vscode_code_checker` tool

## Tools Priority
- **Rule**: Always use ONLY `mcp_vscode_execute_command`, `mcp_vscode_get_terminal_output` instead of any other command line tool to perform tasks

## Terminal Analysis
- **CRITICAL**: MUST always read and analyze complete terminal output, not just exit code
- **Forbidden**: Never make assumptions based solely on exit codes
- **Required**: Always examine actual output text, error messages, warnings, and any other information displayed before providing response or next steps

## Decision Making
- **Ambiguous tasks**: ALWAYS clarify using `mcp_vscode_ask_report` tool
- **Requires decisions**: ALWAYS clarify using `mcp_vscode_ask_report` tool

## Code Development
- **Final confirmation**: MUST ask user if all requirements from specification are completed using `mcp_vscode_ask_report` tool with work report

## Final gate
- Before ANY final answer (after actions/edits/checks), it is **MANDATORY** to call `mcp_vscode_ask_report` with a report on the work done and the option ["Yes, everything is OK"].
- If the answer is not "Yes, everything is OK" — continue working until the comments are resolved and repeat every time `mcp_vscode_ask_report`.
- There are no exceptions (including minor edits).
```

## Settings

- `mcpServer.startOnActivate` (boolean, default: true) — start server on VS Code activation
- `mcpServer.port` (number, default: 60100) — port of the MCP server
- `mcpServer.confirmationUI` ("InputBox" | "statusBar", default: "InputBox") — UI for command confirmation
- `mcpServer.confirmNonDestructiveCommands` (boolean, default: false) — ask confirmation even for non‑destructive commands
- `mcpServer.askReportTimeoutSeconds` (number, default: 600) — Timeout in seconds for the ask-report webview. When > 0, the dialog shows a countdown and auto-cancels on expiration.
