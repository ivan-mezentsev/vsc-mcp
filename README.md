# VSC-MCP Server

A VSCode extension that exposes your IDE as an MCP server — compensating for missing capabilities required by AI agents and enabling advanced control.

## Local Build & Installation

### Build the Extension

```bash
cd packages/extension
npx vsce package --no-dependencies --allow-missing-repository
```

Install the packaged extension from disk:

```bash
code --install-extension packages/extension/vsc-mcp-server-0.1.0.vsix
```

## Key Features

### Terminal Operations

- Execute commands within VSCode’s integrated terminal (supports background/foreground execution, and timeout settings).

![InputBox](docs/demo_InputBox.gif)

### Multi-instance Switching

- Easily switch the MCP server between multiple open VSCode windows.(Just by clicking the status bar item)

![Multi-instance Switching](docs/demo_Multi-instance_Switching.gif)

## Available Built-in Tools

- **execute_command**: Execute commands in VSCode’s integrated terminal
- **code_checker**: Retrieve current diagnostics for your code
- **focus_editor**: Focus specific locations within files
- **get_terminal_output**: Fetch output from a specified terminal

## Configuration

1. Disable the IDE's default terminal tools
![IDE tools configuration](docs/tools_setup.png)

2. Configure your MCP client:

Clients like VSCode, Cursor, Trae: add the following to your configuration file (mcp.json):

```json
{
  "mcpServers": {
    "vscode": {
      "url": "http://localhost:60100/sse"
    }
  }
}
```

3. Check the MCP server status in the bottom-left VSCode status bar:

- 🛠️: Server is running
- ∅: Click to start the server

![Server status indicator](docs/status_on.png)

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
```

## Attribution

This project is a fork of [acomagu/vscode-as-mcp-server](https://github.com/acomagu/vscode-as-mcp-server) by Yuki Ito. Original copyrights and third-party notices are retained under Apache-2.0. This distribution is maintained by [Ivan Mezentsev](https://github.com/ivan-mezentsev).
