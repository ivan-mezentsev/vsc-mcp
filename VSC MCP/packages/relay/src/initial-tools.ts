import { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Fallback tools definition when VSCode server is not available
 * These match the actual tools provided by the VSC MCP extension
 */
export const initialTools: Tool[] = [
  {
    name: 'text_editor',
    description: 'A text editor tool that provides file manipulation capabilities using VSCode\'s native APIs: view, str_replace, create, insert, undo_edit. This tool shows changes in a diff view before applying them and requires user confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          enum: ['view', 'str_replace', 'create', 'insert', 'undo_edit'],
          description: 'Operation to perform'
        },
        path: {
          type: 'string',
          description: 'File path to operate on'
        },
        view_range: {
          type: 'array',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
          description: 'Optional [start, end] line numbers for view command (1-indexed, -1 for end)'
        },
        old_str: {
          type: 'string',
          description: 'Text to replace (required for str_replace command)'
        },
        new_str: {
          type: 'string',
          description: 'New text to insert (required for str_replace and insert commands)'
        },
        file_text: {
          type: 'string',
          description: 'Content for new file (required for create command)'
        },
        insert_line: {
          type: 'number',
          description: 'Line number to insert after (required for insert command)'
        },
        skip_dialog: {
          type: 'boolean',
          description: 'Skip confirmation dialog (for testing only)'
        }
      },
      required: ['command', 'path']
    }
  },
  {
    name: 'execute_command',
    description: 'Execute a command in a VSCode integrated terminal with proper shell integration. This tool provides detailed output and exit status information, and supports custom working directory, shell integration for reliable output capture, and flags for potentially destructive commands.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to execute'
        },
        customCwd: {
          type: 'string',
          description: 'Optional custom working directory for command execution'
        },
        modifySomething: {
          type: 'boolean',
          default: true,
          description: 'Flag indicating if the command is potentially destructive or modifying. Default is true. Set to false for read-only commands (like grep, find, ls) to skip user confirmation.'
        },
        background: {
          type: 'boolean',
          default: false,
          description: 'Flag indicating if the command should run in the background without waiting for completion. When true, the tool will return immediately after starting the command.'
        },
        timeout: {
          type: 'number',
          default: 300000,
          description: 'Timeout in milliseconds after which the command execution will be considered complete for reporting purposes. Does not actually terminate the command. Default is 300000 (5 minutes).'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'list_directory',
    description: 'List directory contents in a tree format, respecting .gitignore patterns. Shows files and directories with proper indentation and icons. Useful for exploring workspace structure while excluding ignored files.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list'
        },
        max_depth: {
          type: 'number',
          default: 3,
          description: 'Maximum depth to traverse (default: 3)'
        },
        show_hidden: {
          type: 'boolean',
          default: false,
          description: 'Whether to show hidden files and directories'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'get_terminal_output',
    description: 'Retrieve the output from a specific terminal by its ID (default: "1"). This tool allows you to check the current or historical output of a terminal, which is particularly useful when working with long-running commands or background processes.',
    inputSchema: {
      type: 'object',
      properties: {
        terminalId: {
          type: 'string',
          default: '1',
          description: 'The ID of the terminal to get output from'
        },
        maxLines: {
          type: 'number',
          default: 100,
          description: 'Maximum number of lines to retrieve'
        }
      }
    }
  },
  {
    name: 'code_checker',
    description: 'Retrieve diagnostics from VSCode\'s language services for the active workspace. Use this tool after making changes to any code in the filesystem to ensure no new errors were introduced, or when requested by the user. Returns errors, warnings, and other diagnostics for all files in the workspace.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'focus_editor',
    description: 'Open the specified file in the VSCode editor and navigate to a specific line and column. Use this tool to bring a file into focus and position the editor\'s cursor where desired. Note: This tool operates on the editor visual environment so that the user can see the file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to open'
        },
        line: {
          type: 'number',
          description: 'Line number to navigate to (1-indexed)'
        },
        column: {
          type: 'number',
          description: 'Column number to navigate to (1-indexed)'
        }
      },
      required: ['path']
    }
  }
];