export const initialTools = [
  {
    "name": "execute_command",
    "description": "Execute a command in a VSCode integrated terminal with proper shell integration.\nThis tool provides detailed output and exit status information, and supports:\n- Custom working directory\n- Shell integration for reliable output capture\n- Output compression for large outputs\n- Detailed exit status reporting\n- Flag for potentially destructive commands (potentiallyDestructive: false to skip confirmation for read-only commands)",
    "inputSchema": {
      "type": "object",
      "properties": {
        "command": {
          "type": "string",
          "description": "The command to execute"
        },
        "customCwd": {
          "type": "string",
          "description": "Optional custom working directory for command execution"
        },
        "potentiallyDestructive": {
          "type": "boolean",
          "default": true,
          "description": "Flag indicating if the command is potentially destructive or modifying. Default is true. Set to false for read-only commands (like grep, find, ls) to skip user confirmation. Commands that could modify files or system state should keep this as true. Note: User can override this behavior with the mcpServer.confirmNonDestructiveCommands setting."
        },
        "background": {
          "type": "boolean",
          "default": false,
          "description": "Flag indicating if the command should run in the background without waiting for completion. When true, the tool will return immediately after starting the command. Default is false, which means the tool will wait for command completion."
        },
        "timeout": {
          "type": "number",
          "default": 300000,
          "description": "Timeout in milliseconds after which the command execution will be considered complete for reporting purposes. Does not actually terminate the command. Default is 300000 (5 minutes)."
        }
      },
      "required": [
        "command"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "code_checker",
    "description": "Retrieve diagnostics from VSCode's language services for the active workspace.\nUse this tool after making changes to any code in the filesystem to ensure no new\nerrors were introduced, or when requested by the user.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "severityLevel": {
          "type": "string",
          "enum": [
            "Error",
            "Warning",
            "Information",
            "Hint"
          ],
          "default": "Warning",
          "description": "Minimum severity level for checking issues: 'Error', 'Warning', 'Information', or 'Hint'."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "focus_editor",
    "description": "Open the specified file in the VSCode editor and navigate to a specific line and column.\nUse this tool to bring a file into focus and position the editor's cursor where desired.\nNote: This tool operates on the editor visual environment so that the user can see the file. It does not return the file contents in the tool call result.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "filePath": {
          "type": "string",
          "description": "The absolute path to the file to focus in the editor."
        },
        "line": {
          "type": "integer",
          "minimum": 0,
          "default": 0,
          "description": "The line number to navigate to (default: 0)."
        },
        "column": {
          "type": "integer",
          "minimum": 0,
          "default": 0,
          "description": "The column position to navigate to (default: 0)."
        },
        "startLine": {
          "type": "integer",
          "minimum": 0,
          "description": "The starting line number for highlighting."
        },
        "startColumn": {
          "type": "integer",
          "minimum": 0,
          "description": "The starting column number for highlighting."
        },
        "endLine": {
          "type": "integer",
          "minimum": 0,
          "description": "The ending line number for highlighting."
        },
        "endColumn": {
          "type": "integer",
          "minimum": 0,
          "description": "The ending column number for highlighting."
        }
      },
      "required": [
        "filePath"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "get_terminal_output",
    "description": "Retrieve the output from a specific terminal by its ID.\nThis tool allows you to check the current or historical output of a terminal,\nwhich is particularly useful when working with long-running commands or\ncommands started in background mode with the execute_command tool.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "terminalId": {
          "type": [
            "string",
            "number"
          ],
          "description": "The ID of the terminal to get output from"
        },
        "maxLines": {
          "type": "number",
          "default": 1000,
          "description": "Maximum number of lines to retrieve (default: 1000)"
        }
      },
      "required": [
        "terminalId"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  }
]
