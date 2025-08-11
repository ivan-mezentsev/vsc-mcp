# VSC MCP

VSCode as MCP Server - Expose VSCode features through Model Context Protocol, enabling LLMs to access file viewing, editing, and VSCode functionalities.

## Overview

VSC MCP provides two packages:

1. **Extension** (`packages/extension`): A VSCode extension that exposes VSCode features as an MCP server
2. **Relay** (`packages/relay`): An NPX package that relays MCP requests to the VSCode extension

## Features

- **File Operations**: View, edit, create files with diff review
- **Terminal Integration**: Execute commands in VSCode's integrated terminal  
- **Directory Listing**: Browse project structure
- **Code Diagnostics**: Access error and warning information
- **Symbol Search**: Find files and symbols in workspace
- **Debug Management**: Control debug sessions
- **URL Preview**: Open URLs in VSCode's integrated browser
- **VSCode Commands**: Execute arbitrary VSCode commands

## Installation

### VSCode Extension

Install from the VSCode marketplace or build locally:

```bash
cd packages/extension
pnpm install
pnpm run package-extension
```

### NPX Relay

Install globally or use npx directly:

```bash
npx vsc-mcp
```

## Configuration

The extension can be configured in VSCode settings:

- `vscMcp.startOnActivate`: Auto-start server when VSCode activates (default: true)
- `vscMcp.port`: Server port (default: 60100)
- `vscMcp.confirmationUI`: UI for confirmations (quickPick/statusBar)
- `vscMcp.confirmNonDestructiveCommands`: Require confirmation for read-only commands

## Command Line Options (Relay)

- `--server-url`: VSCode extension server URL (default: http://localhost:60100)
- `--disable [tool]`: Disable specific tools
- `--enable [tool]`: Enable only specific tools (whitelist mode)

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Lint code
pnpm run lint
```

## Author

Ivan Mezentsev

## License

MIT