import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol';
import { CallToolRequestSchema, CallToolResult, ErrorCode, ListResourcesRequestSchema, ListToolsRequestSchema, ListToolsResult, McpError, Tool, ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import dedent from 'dedent';
import * as vscode from 'vscode';
import { AnyZodObject, z, ZodRawShape } from 'zod';
import { zodToJsonSchema } from "zod-to-json-schema";
import packageJson from '../package.json';
import { codeCheckerTool } from './tools/code_checker';
import {
  listDebugSessions,
  listDebugSessionsSchema,
  startDebugSession,
  startDebugSessionSchema,
  stopDebugSession,
  stopDebugSessionSchema,
} from './tools/debug_tools';
import { executeCommandSchema, executeCommandToolHandler } from './tools/execute_command';
import { executeVSCodeCommandSchema, executeVSCodeCommandToolHandler } from './tools/execute_vscode_command';
import { focusEditorTool } from './tools/focus_editor';
import { getTerminalOutputSchema, getTerminalOutputToolHandler } from './tools/get_terminal_output';
import { listDirectorySchema, listDirectoryTool } from './tools/list_directory';
import { listVSCodeCommandsSchema, listVSCodeCommandsToolHandler } from './tools/list_vscode_commands';
import { previewUrlSchema, previewUrlToolHandler } from './tools/preview_url';
import { registerExternalTools } from './tools/register_external_tools';
import { searchSymbolSchema, searchSymbolTool } from './tools/search_symbol';
import { textEditorSchema, textEditorTool } from './tools/text_editor';

export const extensionName = 'vsc-mcp';
export const extensionDisplayName = 'VSC MCP';

/**
 * Transform JSON Schema to draft 2020-12
 * This is needed because zod-to-json-schema generates draft-07 schemas
 */
function toJsonSchema2020(schema: any): any {
  return {
    ...schema,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    // Remove additionalProperties: false as it can cause issues with Claude Code
    additionalProperties: undefined
  };
}

interface RegisteredTool {
  description?: string;
  inputZodSchema?: AnyZodObject;
  inputSchema?: Tool['inputSchema'];
  callback: ToolCallback<undefined | ZodRawShape>;
}

export class ToolRegistry {
  private _registeredTools: { [name: string]: RegisteredTool } = {};
  private _toolHandlersInitialized = false;
  constructor(readonly server: Server) { }
  
  toolWithRawInputSchema(
    name: string,
    description: string,
    inputSchema: Tool['inputSchema'],
    cb: (args: unknown, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => ReturnType<ToolCallback<any>>,
  ) {
    if (this._registeredTools[name]) {
      throw new Error(`Tool ${name} is already registered`);
    }

    this._registeredTools[name] = {
      description,
      inputSchema,
      callback: cb,
    };

    this.#setToolRequestHandlers();
  }
  
  tool<Args extends ZodRawShape>(
    name: string,
    description: string,
    paramsSchema: Args,
    cb: ToolCallback<Args>,
  ) {
    if (this._registeredTools[name]) {
      throw new Error(`Tool ${name} is already registered`);
    }

    this._registeredTools[name] = {
      description,
      inputZodSchema:
        paramsSchema === undefined ? undefined : z.object(paramsSchema),
      callback: cb,
    };

    this.#setToolRequestHandlers();
  }
  
  #setToolRequestHandlers() {
    if (this._toolHandlersInitialized) {
      return;
    }

    this.server.assertCanSetRequestHandler(
      ListToolsRequestSchema.shape.method.value,
    );
    this.server.assertCanSetRequestHandler(
      CallToolRequestSchema.shape.method.value,
    );

    this.server.registerCapabilities({
      tools: {},
    });

    this.server.setRequestHandler(ListToolsRequestSchema, (): ListToolsResult => ({
      tools: Object.entries(this._registeredTools).map(([name, tool]): Tool => {
        let inputSchema: Tool['inputSchema'];
        
        if (tool.inputSchema) {
          inputSchema = tool.inputSchema;
        } else if (tool.inputZodSchema) {
          const generatedSchema = zodToJsonSchema(tool.inputZodSchema, {
            strictUnions: true,
          });
          inputSchema = toJsonSchema2020(generatedSchema) as Tool['inputSchema'];
        } else {
          inputSchema = toJsonSchema2020({ type: "object" }) as Tool['inputSchema'];
        }
        
        return {
          name,
          description: tool.description,
          inputSchema,
        };
      }),
    }));

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request, extra): Promise<CallToolResult> => {
        const tool = this._registeredTools[request.params.name];
        if (!tool) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Tool ${request.params.name} not found`,
          );
        }

        if (tool.inputSchema) {
          // Skip validation because raw inputschema tool is used by another tool provider
          const args = request.params.arguments;
          const cb = tool.callback as (args: unknown, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => ReturnType<ToolCallback<any>>;
          return await Promise.resolve(cb(args, extra));
        } else if (tool.inputZodSchema) {
          const parseResult = await tool.inputZodSchema.safeParseAsync(
            request.params.arguments,
          );
          if (!parseResult.success) {
            throw new McpError(
              ErrorCode.InvalidParams,
              `Invalid arguments for tool ${request.params.name}: ${parseResult.error.message}`,
            );
          }

          const args = parseResult.data;
          const cb = tool.callback as ToolCallback<ZodRawShape>;
          try {
            return await Promise.resolve(cb(args, extra));
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: error instanceof Error ? error.message : String(error),
                },
              ],
              isError: true,
            };
          }
        } else {
          const cb = tool.callback as ToolCallback<undefined>;
          try {
            return await Promise.resolve(cb(extra));
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: error instanceof Error ? error.message : String(error),
                },
              ],
              isError: true,
            };
          }
        }
      },
    );

    this._toolHandlersInitialized = true;
  }
}

export function createMcpServer(_outputChannel: vscode.OutputChannel): McpServer {
  const mcpServer = new McpServer({
    name: extensionName,
    version: packageJson.version,
  }, {
    capabilities: {
      resources: {},
      tools: {},
    },
  });

  const toolRegistry = new ToolRegistry(mcpServer.server);

  // Register tools
  registerTools(toolRegistry);
  // Register resource handlers
  registerResourceHandlers(mcpServer);

  return mcpServer;
}

function registerTools(mcpServer: ToolRegistry) {
  // Register the "execute_command" tool
  mcpServer.tool(
    'execute_command',
    dedent`
      Execute a command in a VSCode integrated terminal with proper shell integration.
      This tool provides detailed output and exit status information, and supports:
      - Custom working directory
      - Shell integration for reliable output capture
      - Output compression for large outputs
      - Detailed exit status reporting
      - Flag for potentially destructive commands (modifySomething: false to skip confirmation for read-only commands)

      When running commands that might prompt for user input, include appropriate flags like '-y' or '--yes'
      to prevent interactive prompts from blocking execution.
    `.trim(),
    executeCommandSchema.shape,
    async (params) => {
      const result = await executeCommandToolHandler(params);
      return {
        content: result.content.map(item => ({
          ...item,
          type: 'text' as const,
        })),
        isError: result.isError,
      };
    }
  );

  // Register the "code_checker" tool
  mcpServer.tool(
    'code_checker',
    dedent`
      Retrieve diagnostics from VSCode's language services for the active workspace.
      Use this tool after making changes to any code in the filesystem to ensure no new
      errors were introduced, or when requested by the user.
      Returns errors, warnings, and other diagnostics for all files in the workspace.
    `.trim(),
    {},
    async () => {
      const result = await codeCheckerTool();
      return {
        content: [{ type: 'text', text: result.text }],
        isError: false,
      };
    }
  );

  // Register the "focus_editor" tool
  mcpServer.tool(
    'focus_editor',
    dedent`
      Open the specified file in the VSCode editor and navigate to a specific line and column.
      Use this tool to bring a file into focus and position the editor's cursor where desired.
      Note: This tool operates on the editor visual environment so that the user can see the file. It does not return the file contents in the tool call result.
    `.trim(),
    {
      path: z.string().describe('Path to the file to open'),
      line: z.number().optional().describe('Line number to navigate to (1-indexed)'),
      column: z.number().optional().describe('Column number to navigate to (1-indexed)'),
    },
    async (params) => {
      const result = await focusEditorTool(params);
      return {
        content: [{ type: 'text', text: result.text }],
        isError: false,
      };
    }
  );

  // Register debug session tools
  mcpServer.tool(
    'list_debug_sessions',
    'List all active debug sessions in the workspace.',
    listDebugSessionsSchema.shape,
    async () => {
      const result = listDebugSessions();
      return {
        content: [{ type: 'text', text: result.text }],
        isError: false,
      };
    }
  );

  mcpServer.tool(
    'start_debug_session',
    'Start a new debug session with the provided configuration.',
    startDebugSessionSchema.shape,
    async (params) => {
      const result = await startDebugSession(params);
      return {
        content: [{ type: 'text', text: result.text }],
        isError: false,
      };
    }
  );

  mcpServer.tool(
    'restart_debug_session',
    'Restart a debug session by stopping it and then starting it with the provided configuration.',
    startDebugSessionSchema.shape,
    async (params) => {
      await stopDebugSession({ sessionName: params.configuration.name });
      const result = await startDebugSession(params);
      return {
        content: [{ type: 'text', text: result.text }],
        isError: false,
      };
    }
  );

  mcpServer.tool(
    'stop_debug_session',
    'Stop all debug sessions that match the provided session name.',
    stopDebugSessionSchema.shape,
    async (params) => {
      const result = await stopDebugSession(params);
      return {
        content: [{ type: 'text', text: result.text }],
        isError: false,
      };
    }
  );

  // Register the "text_editor" tool
  mcpServer.tool(
    'text_editor',
    dedent`
      A text editor tool that provides file manipulation capabilities using VSCode's native APIs:
      - view: Read file contents with optional line range
      - str_replace: Replace text in file
      - create: Create new file with content
      - insert: Insert text at specific line
      - undo_edit: Undo last edit

      This tool shows changes in a diff view before applying them and requires user confirmation.
    `.trim(),
    textEditorSchema.shape,
    async (params) => {
      const result = await textEditorTool(params);
      return {
        content: result.content,
        isError: result.isError,
      };
    }
  );

  // Register the "list_directory" tool
  mcpServer.tool(
    'list_directory',
    dedent`
      List directory contents in a tree format, respecting .gitignore patterns.
      Shows files and directories with proper indentation and icons.
      Useful for exploring workspace structure while excluding ignored files.
    `.trim(),
    listDirectorySchema.shape,
    async (params) => {
      const result = await listDirectoryTool(params);
      return {
        content: [{ type: 'text', text: result.text }],
        isError: false,
      };
    }
  );

  // Register the "get_terminal_output" tool
  mcpServer.tool(
    'get_terminal_output',
    dedent`
      Retrieve the output from a specific terminal by its ID (default: "1").
      This tool allows you to check the current or historical output of a terminal,
      which is particularly useful when working with long-running commands or
      background processes started with the execute_command tool.
    `.trim(),
    getTerminalOutputSchema.shape,
    async (params) => {
      const result = await getTerminalOutputToolHandler(params);
      return {
        content: result.content.map(item => ({
          ...item,
          type: 'text' as const,
        })),
        isError: result.isError,
      };
    }
  );

  // Register the "list_vscode_commands" tool
  mcpServer.tool(
    'list_vscode_commands',
    dedent`
      List available VSCode commands with optional filtering.
      This tool returns a list of command IDs that can be executed with the execute_vscode_command tool.
      Use it to discover available commands or find specific commands by keyword.
    `.trim(),
    listVSCodeCommandsSchema.shape,
    async (params) => {
      const result = await listVSCodeCommandsToolHandler(params);
      return {
        content: result.content.map(item => ({
          ...item,
          type: 'text' as const,
        })),
        isError: result.isError,
      };
    }
  );

  // Register the "execute_vscode_command" tool
  mcpServer.tool(
    'execute_vscode_command',
    dedent`
      Execute any VSCode command by its command ID.
      This tool allows direct access to VSCode's command API, enabling actions like opening views,
      triggering built-in functionality, or invoking extension commands.
    `.trim(),
    executeVSCodeCommandSchema.shape,
    async (params) => {
      const result = await executeVSCodeCommandToolHandler(params);
      return {
        content: result.content.map(item => ({
          ...item,
          type: 'text' as const,
        })),
        isError: result.isError,
      };
    }
  );

  // Register the "preview_url" tool
  mcpServer.tool(
    'preview_url',
    dedent`
      Open a URL in VSCode's built-in simple browser, beside the current editor.
      This tool provides a convenient way to preview web content directly within VSCode,
      without switching to an external browser.
    `.trim(),
    previewUrlSchema.shape,
    async (params) => {
      const result = await previewUrlToolHandler(params);
      return {
        content: result.content.map(item => ({
          ...item,
          type: 'text' as const,
        })),
        isError: result.isError,
      };
    }
  );

  // Register the "search_symbol" tool
  mcpServer.tool(
    'search_symbol',
    dedent`
      Search for symbols in the workspace using VSCode's symbol search capabilities.
      This tool helps find classes, functions, variables, and other symbols across the codebase.
      Useful for code navigation and understanding project structure.
    `.trim(),
    searchSymbolSchema.shape,
    async (params) => {
      const result = await searchSymbolTool(params);
      return {
        content: [{ type: 'text', text: result.text }],
        isError: false,
      };
    }
  );

  // Register external tools (from other extensions)
  registerExternalTools(mcpServer);
}

function registerResourceHandlers(mcpServer: McpServer) {
  // Set up resource handlers for file content access
  mcpServer.server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: [] };
  });
}