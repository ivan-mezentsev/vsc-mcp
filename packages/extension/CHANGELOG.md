# Changelog

## 0.5.0 - 2025-09-16

- Replaced marked.min.js with markdown-deps.js to bundle marked and highlight.js.
- Added highlight.js CSS for code block styling.
- Integrated highlight.js for automatic code block highlighting in markdown.
- Created markdownDeps.ts to expose marked and highlight.js to the webview.

## 0.4.4 - 2025-09-16

- style(ask_report): improve markdown styling for a native look

## 0.4.3 - 2025-09-12

- feat(status-bar): add wrapper command for reset cached tools

## 0.4.2 - 2025-09-11

- update instructions

## 0.4.1 - 2025-09-11

- Updated tool descriptions for more accurate interpretation by LLMs.
  - To refresh cached tool definitions using the official method:
    1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
    2. Type: `MCP: Reset Cached Tools`
    3. Select the command and execute it
  - If the new MCP version still shows outdated tool descriptions (there is currently no automatic way to invalidate the `mcpToolCache` due to a VS Code bug), manually clear the cache on macOS:
    - Fully quit all VS Code instances
    - Then run:

    ```bash
    cd "${HOME}/Library/Application Support/Code"
    # cd "${HOME}/Library/Application Support/Code - Insiders"

    # Show potential matches in sqlite DBs
    for db in $(find . -type f -name "*.vscdb"); do echo "=== $db ==="; sqlite3 "$db" "SELECT key FROM ItemTable WHERE key = 'mcpToolCache';"; done

    # Delete the exact key from all .vscdb files (only after backup)
    for db in $(find . -type f -name "*.vscdb"); do sqlite3 "$db" "DELETE FROM ItemTable WHERE key='mcpToolCache';"; done
    ```

## 0.4.0 - 2025-09-04

- Introduced full multi-instance support with automatic discovery service and proxying via stdio service.

## 0.3.2 - 2025-08-26

- Introduced a new "Save" button in the ask report webview.

## 0.3.1 - 2025-08-25

- Remove express dependency.

## 0.3.0 - 2025-08-24

- Introduced the `ask_report` tool to prompt users for input via a webview.

## 0.2.1 - 2025-08-23

- docs(extension): update README

## 0.2.0 - 2025-08-23

- feat(transport): replace relay with direct-to-client SSE implementation
- feat(sse-http-server): implement SSE server with heartbeat and session management
- chore: remove relay package and related files

## 0.1.2 - 2025-08-22

- fix(confirmation_ui): set cursor position in input box confirmation

## 0.1.1 - 2025-08-22

- docs(extension): improve documentation
- ci(extension): automate extension build via GitHub Actions for increased transparency
- Eliminate QuickPick as a UI option for command confirmation.

## 0.1.0 - 2025-08-21

- feat(extension): enhance command confirmation UI with InputBox option
- fix(extension): update status bar item icon for running state
- Initial public release as a fork of `acomagu/vscode-as-mcp-server` by Yuki Ito (acomagu). This distribution is maintained by Ivan Mezentsev.
