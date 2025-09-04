# Changelog

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
