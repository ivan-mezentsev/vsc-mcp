# VSC MCP - VSCode as Model Context Protocol Server

**VSC MCP** is a complete monorepo implementation that provides all the functionality of vscode-as-mcp-server but with modern architecture, VSC MCP branding, and latest library versions.

## 🚀 What's New

- **Modern Architecture**: Clean TypeScript codebase with latest dependencies (MCP SDK 1.17.2, TypeScript 5.9.2, ESLint 9.18.0)
- **VSC MCP Branding**: Renamed throughout with author Ivan Mezentsev and future publication URL https://github.com/ivan-mezentsev/vsc-mcp
- **Monorepo Structure**: Professional pnpm workspace with two packages
- **Strict TypeScript**: No "as any" or "as unknown" - proper typing throughout
- **Complete Tool Set**: All 12+ tools from original implementation reproduced

## 📦 Packages

### Extension Package (`packages/extension`)
VSCode extension that exposes VSCode features as MCP server

**Features:**
- **MCP Server**: HTTP-based server exposing VSCode functionality through MCP protocol
- **Status Bar Integration**: Real-time server status with start/stop/toggle commands
- **Complete Tool Set**: All 12+ tools with extensible architecture
- **Configuration**: Full VSCode settings for port, auto-start, confirmation UI preferences
- **Auto-start**: Configurable server startup when VSCode activates

**Available Tools:**
1. `text_editor` - File operations: view, edit, create files with diff preview
2. `execute_command` - Execute commands in VSCode integrated terminal
3. `list_directory` - List directory contents in tree format
4. `get_terminal_output` - Retrieve terminal output by ID
5. `code_checker` - Get workspace diagnostics from language services
6. `focus_editor` - Open files and navigate to specific lines/columns
7. `list_debug_sessions` - List active debug sessions
8. `start_debug_session` - Start new debug sessions
9. `restart_debug_session` - Restart debug sessions
10. `stop_debug_session` - Stop debug sessions
11. `list_vscode_commands` - List available VSCode commands
12. `execute_vscode_command` - Execute VSCode commands by ID
13. `preview_url` - Open URLs in VSCode's built-in browser
14. `search_symbol` - Search for symbols across the workspace

### Relay Package (`packages/relay`)
NPX package for external MCP client access with tool filtering

**Features:**
- **NPX Support**: Run as `npx vsc-mcp-relay` for external MCP client access
- **Tool Filtering**: `--disable` and `--enable` flags for selective tool exposure
- **Intelligent Caching**: Tool list caching with automatic updates and cache invalidation
- **Robust Networking**: Retry logic with exponential backoff for reliable communication
- **Command Line Interface**: Full argument parsing for server URL and tool management

## 🛠️ Installation & Usage

### VSCode Extension

1. **Install the extension** (when published)
2. **Configure settings** in VSCode:
   ```json
   {
     "vscMcp.startOnActivate": true,
     "vscMcp.port": 60100,
     "vscMcp.confirmationUI": "quickPick",
     "vscMcp.confirmNonDestructiveCommands": false
   }
   ```

3. **Use VSCode commands**:
   - `VSC MCP: Start Server`
   - `VSC MCP: Stop Server`
   - `VSC MCP: Restart Server`
   - `VSC MCP: Toggle Server`

### NPX Relay

Connect external MCP clients to your VSCode instance:

```bash
# Basic usage
npx vsc-mcp-relay

# Custom server URL
npx vsc-mcp-relay --server-url http://localhost:8080

# Disable specific tools
npx vsc-mcp-relay --disable debug_tools,terminal_tools

# Enable only specific tools
npx vsc-mcp-relay --enable text_editor,execute_command,list_directory

# Custom cache directory
npx vsc-mcp-relay --cache-dir /tmp/vsc-mcp-cache
```

**Command Line Options:**
- `--server-url, -s <url>`: VSCode MCP server URL (default: http://localhost:60100)
- `--enable <tools>`: Comma-separated list of tools to enable (exclusive)
- `--disable <tools>`: Comma-separated list of tools to disable
- `--cache-dir <dir>`: Directory for tool cache (default: system temp)
- `--help, -h`: Show help

## 🏗️ Development

### Prerequisites
- Node.js 18+
- pnpm 8+
- VSCode

### Setup
```bash
# Clone repository
git clone https://github.com/ivan-mezentsev/vsc-mcp
cd VSC\ MCP

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Lint all packages
pnpm lint

# Run in development mode
pnpm dev
```

### Project Structure
```
VSC MCP/
├── packages/
│   ├── extension/          # VSCode extension
│   │   ├── src/
│   │   │   ├── extension.ts      # Main activation logic
│   │   │   ├── mcp-server.ts     # MCP server implementation
│   │   │   ├── transport/        # HTTP transport layer
│   │   │   ├── tools/            # All 12+ MCP tools
│   │   │   ├── integrations/     # Terminal and misc integrations
│   │   │   └── utils/            # Utilities and providers
│   │   └── package.json          # Extension dependencies
│   └── relay/              # NPX relay package
│       ├── src/
│       │   ├── index.ts          # Main relay implementation
│       │   └── initial-tools.ts  # Fallback tool definitions
│       └── package.json          # Relay dependencies
├── package.json            # Workspace configuration
├── pnpm-workspace.yaml     # Workspace definition
├── eslint.config.js        # Strict TypeScript linting
└── README.md              # This file
```

## 🔧 Configuration

### VSCode Settings

```json
{
  "vscMcp.startOnActivate": true,
  "vscMcp.port": 60100,
  "vscMcp.confirmationUI": "quickPick",
  "vscMcp.confirmNonDestructiveCommands": false
}
```

**Settings:**
- `vscMcp.startOnActivate`: Auto-start server when VSCode activates
- `vscMcp.port`: Port for MCP server (default: 60100)
- `vscMcp.confirmationUI`: UI type for confirmations (`quickPick`, `inputBox`, `modal`)
- `vscMcp.confirmNonDestructiveCommands`: Show confirmations for read-only commands

## 📡 MCP Protocol

The server implements the Model Context Protocol with the following capabilities:

### Transport
- **HTTP Server**: Listens on configurable port (default: 60100)
- **CORS Support**: Allows cross-origin requests for web clients
- **JSON-RPC 2.0**: Standard MCP message format

### Tools
All tools use proper Zod schemas for validation and provide comprehensive error handling:

```typescript
// Example tool usage
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "text_editor",
    "arguments": {
      "command": "view",
      "path": "./README.md",
      "view_range": [1, 50]
    }
  }
}
```

## 🧪 Quality Assurance

### TypeScript Strict Mode
- No `any` or `unknown` types allowed
- Explicit function return types required
- Strict boolean expressions enforced
- Comprehensive type checking

### ESLint Configuration
```javascript
// Strict rules enforced
'@typescript-eslint/no-explicit-any': 'error',
'@typescript-eslint/no-unsafe-any': 'error',
'@typescript-eslint/explicit-function-return-type': 'error',
'@typescript-eslint/no-floating-promises': 'error'
```

### Build System
- **Extension**: esbuild for fast bundling
- **Relay**: TypeScript compiler for clean output
- **Linting**: ESLint with TypeScript strict rules
- **Testing**: Comprehensive test coverage (planned)

## 🚀 Future Plans

- [ ] Comprehensive test suite
- [ ] VSCode Marketplace publication
- [ ] NPM package publication
- [ ] Additional tool implementations
- [ ] WebSocket transport support
- [ ] Plugin architecture for custom tools

## 📄 License

MIT License - see LICENSE file for details

## 👨‍💻 Author

**Ivan Mezentsev**  
GitHub: [@ivan-mezentsev](https://github.com/ivan-mezentsev)  
Project: [VSC MCP](https://github.com/ivan-mezentsev/vsc-mcp)

---

*VSC MCP provides a solid foundation for the VSCode MCP ecosystem with professional code quality, comprehensive documentation, and production-ready architecture.*