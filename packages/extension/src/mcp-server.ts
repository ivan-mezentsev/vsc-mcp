import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol';
import { CallToolRequestSchema, CallToolResult, ErrorCode, ListToolsRequestSchema, ListToolsResult, McpError, ServerNotification, ServerRequest, Tool } from '@modelcontextprotocol/sdk/types.js';
import dedent from 'dedent';
import * as vscode from 'vscode';
import { DiagnosticSeverity } from 'vscode';
import { AnyZodObject, z, ZodRawShape } from 'zod';
import { zodToJsonSchema } from "zod-to-json-schema";
import packageJson from '../package.json';
import { askReport } from './tools/ask_report';
import { codeCheckerTool } from './tools/code_checker';
import { executeCommandToolHandler } from './tools/execute_command';
import { focusEditorToolHandler } from './tools/focus_editor';
import { getTerminalOutputToolHandler } from './tools/get_terminal_output';
import { arePathsEqual, normalizePath } from './utils/path';

export const extensionName = 'vscode-mcp-server';
export const extensionDisplayName = 'VSCode MCP Server';

// Global workspace folder path (normalized)
let workspaceFolder: string | undefined;

function validateWorkspaceFolderParam(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return 'Parameter "workspaceFolder" is required and must be a non-empty string.';
  }
  if (!workspaceFolder) {
    return 'Server has no active workspace folder.';
  }
  if (!arePathsEqual(value, workspaceFolder)) {
    return `Invalid \"workspaceFolder\" value. Expected: ${workspaceFolder}`;
  }
  return null;
}

// Note: tools registered with raw schemas are passed through as-is.

interface RegisteredTool {
  description?: string;
  inputZodSchema?: AnyZodObject;
  inputSchema?: Tool['inputSchema'];
  callback: ToolCallback<undefined | ZodRawShape>;
};

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
          inputSchema = generatedSchema as Tool['inputSchema'];
        } else {
          inputSchema = { type: "object" } as Tool['inputSchema'];
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
        // Unconditional stderr logs for debugging tool calls end-to-end
        const now = () => new Date().toISOString();
        const reqId = (() => {
          const maybe = (request as unknown as { id?: unknown }).id;
          return typeof maybe === 'string' || typeof maybe === 'number' ? String(maybe) : '<no-id>';
        })();
        const toolName = request.params.name ?? '<unknown>';
        const short = (v: unknown): string => {
          try {
            const s = JSON.stringify(v);
            return s.length > 400 ? s.slice(0, 400) + '…' : s;
          } catch {
            return String(v);
          }
        };
        console.error(`[ext] ${now()} SSE->ext CALL_TOOL received id=${reqId} name=${toolName} args=${short(request.params.arguments)}`);
        const tool = this._registeredTools[request.params.name];
        if (!tool) {
          console.error(`[ext] ${now()} ext CALL_TOOL not-found id=${reqId} name=${toolName}`);
          throw new McpError(
            ErrorCode.InvalidParams,
            `Tool ${request.params.name} not found`,
          );
        }

        if (tool.inputSchema) {
          // Skip validation because raw inputschema tool is used by another tool provider
          const args = request.params.arguments;
          const cb = tool.callback as (args: unknown, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => ReturnType<ToolCallback<any>>;
          console.error(`[ext] ${now()} ext->tool CALL_TOOL invoking id=${reqId} name=${toolName} (raw)`);
          const r = await Promise.resolve(cb(args, extra));
          console.error(`[ext] ${now()} tool->ext CALL_TOOL result id=${reqId} name=${toolName} isError=${(r as { isError?: boolean }).isError === true}`);
          return r;
        } else if (tool.inputZodSchema) {
          const parseResult = await tool.inputZodSchema.safeParseAsync(
            request.params.arguments,
          );
          if (!parseResult.success) {
            console.error(`[ext] ${now()} ext CALL_TOOL invalid-args id=${reqId} name=${toolName} err=${parseResult.error.message}`);
            throw new McpError(
              ErrorCode.InvalidParams,
              `Invalid arguments for tool ${request.params.name}: ${parseResult.error.message}`,
            );
          }

          const args = parseResult.data;
          const cb = tool.callback as ToolCallback<ZodRawShape>;
          try {
            console.error(`[ext] ${now()} ext->tool CALL_TOOL invoking id=${reqId} name=${toolName}`);
            const r = await Promise.resolve(cb(args, extra));
            console.error(`[ext] ${now()} tool->ext CALL_TOOL result id=${reqId} name=${toolName} isError=${(r as { isError?: boolean }).isError === true}`);
            return r;
          } catch (error) {
            console.error(`[ext] ${now()} tool->ext CALL_TOOL ERROR id=${reqId} name=${toolName} message=${error instanceof Error ? error.message : String(error)}`);
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
            console.error(`[ext] ${now()} ext->tool CALL_TOOL invoking id=${reqId} name=${toolName} (no-args)`);
            const r = await Promise.resolve(cb(extra));
            console.error(`[ext] ${now()} tool->ext CALL_TOOL result id=${reqId} name=${toolName} isError=${(r as { isError?: boolean }).isError === true}`);
            return r;
          } catch (error) {
            console.error(`[ext] ${now()} tool->ext CALL_TOOL ERROR id=${reqId} name=${toolName} message=${error instanceof Error ? error.message : String(error)}`);
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
  // Initialize global workspace folder at server start
  const wf = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  workspaceFolder = wf ? normalizePath(wf) : undefined;

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

  return mcpServer;
}

function registerTools(mcpServer: ToolRegistry) {
  // Register the "execute_command" tool (RAW schema)
  mcpServer.toolWithRawInputSchema(
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
    {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        customCwd: { type: 'string', description: 'Optional custom working directory for command execution' },
        modifySomething: { type: 'boolean', description: 'Flag indicating if the command is potentially destructive or modifying. Default is true.' },
        background: { type: 'boolean', description: 'Run command without waiting for completion. Default is false.' },
        timeout: { type: 'number', description: 'Timeout in milliseconds for reporting purposes. Default is 300000 (5 minutes).' },
        workspaceFolder: { type: 'string', description: 'Absolute path to workspace (required)' },
      },
      required: ['command', 'workspaceFolder'],
    },
    async (params) => {
      const p = (params ?? {}) as {
        command: string;
        customCwd?: string;
        modifySomething?: boolean;
        background?: boolean;
        timeout?: number;
        workspaceFolder?: string;
      };

      const err = validateWorkspaceFolderParam(p.workspaceFolder);
      if (err) {
        return {
          content: [{ type: 'text', text: err }],
          isError: true,
        };
      }

      const result = await executeCommandToolHandler({
        command: p.command,
        customCwd: typeof p.customCwd === 'string' ? p.customCwd : undefined,
        modifySomething: typeof p.modifySomething === 'boolean' ? p.modifySomething : true,
        background: typeof p.background === 'boolean' ? p.background : false,
        timeout: typeof p.timeout === 'number' ? p.timeout : 300000,
      } as any);

      return {
        content: result.content.map(item => ({
          ...item,
          type: 'text' as const,
        })),
        isError: result.isError,
      };
    }
  );

  // Register the "code_checker" tool (RAW schema)
  mcpServer.toolWithRawInputSchema(
    'code_checker',
    dedent`
      Retrieve diagnostics from VSCode's language services for the active workspace.
      Use this tool after making changes to any code in the filesystem to ensure no new
      errors were introduced, or when requested by the user.
    `.trim(),
    {
      type: 'object',
      properties: {
        severityLevel: {
          type: 'string',
          description: "Minimum severity level: 'Error', 'Warning', 'Information', or 'Hint' (default: 'Warning').",
          enum: ['Error', 'Warning', 'Information', 'Hint'],
        },
        workspaceFolder: { type: 'string', description: 'Absolute path to workspace (required)' },
      },
      required: ['workspaceFolder'],
    },
    async (params) => {
      const p = (params ?? {}) as { severityLevel?: 'Error' | 'Warning' | 'Information' | 'Hint'; workspaceFolder?: string };
      const err = validateWorkspaceFolderParam(p.workspaceFolder);
      if (err) {
        return {
          content: [{ type: 'text', text: err }],
          isError: true,
        };
      }
      const severityLevel = p.severityLevel && DiagnosticSeverity[p.severityLevel]
        ? DiagnosticSeverity[p.severityLevel]
        : DiagnosticSeverity.Warning;
      const result = codeCheckerTool(severityLevel);
      return {
        ...result,
        content: result.content.map((c) => ({
          ...c,
          text: typeof (c as any).text === 'string' ? (c as any).text : String((c as any).text),
          type: 'text' as const,
        })),
      };
    },
  );

  // Register 'focus_editor' tool (RAW schema)
  mcpServer.toolWithRawInputSchema(
    'focus_editor',
    dedent`
      Open the specified file in the VSCode editor and navigate to a specific line and column.
      Use this tool to bring a file into focus and position the editor's cursor where desired.
      Note: This tool operates on the editor visual environment so that the user can see the file. It does not return the file contents in the tool call result.
    `.trim(),
    {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'The absolute path to the file to focus in the editor.' },
        line: { type: 'number', description: 'The line number to navigate to (default: 0).' },
        column: { type: 'number', description: 'The column position to navigate to (default: 0).' },
        startLine: { type: 'number', description: 'The starting line number for highlighting.' },
        startColumn: { type: 'number', description: 'The starting column number for highlighting.' },
        endLine: { type: 'number', description: 'The ending line number for highlighting.' },
        endColumn: { type: 'number', description: 'The ending column number for highlighting.' },
        workspaceFolder: { type: 'string', description: 'Absolute path to workspace (required)' },
      },
      required: ['filePath', 'workspaceFolder'],
    },
    async (params) => {
      const p = (params ?? {}) as {
        filePath: string;
        line?: number;
        column?: number;
        startLine?: number;
        startColumn?: number;
        endLine?: number;
        endColumn?: number;
        workspaceFolder?: string;
      };
      const err = validateWorkspaceFolderParam(p.workspaceFolder);
      if (err) {
        return {
          content: [{ type: 'text', text: err }],
          isError: true,
        };
      }
      const result = await focusEditorToolHandler(p as any);
      return {
        content: result.content.map(item => ({ ...item, type: 'text' as const })),
        isError: result.isError,
      };
    },
  );

  // Register get terminal output tool
  mcpServer.toolWithRawInputSchema(
    'get_terminal_output',
    dedent`
      Retrieve the output from a specific terminal by its ID (default: "1").
      This tool allows you to check the current or historical output of a terminal,
      which is particularly useful when working with long-running commands or
      commands started in background mode with the execute_command tool.
    `.trim(),
    {
      type: 'object',
      properties: {
        terminalId: {
          type: 'string',
          description: 'The ID of the terminal to get output from (provide as a string, e.g., "1").',
        },
        maxLines: {
          type: 'number',
          description: 'Maximum number of lines to retrieve (default: 1000)',
        },
        workspaceFolder: { type: 'string', description: 'Absolute path to workspace (required)' },
      },
      required: ['terminalId', 'workspaceFolder'],
    },
    async (params) => {
      const p = params as { terminalId: string; maxLines?: number; workspaceFolder?: string };
      const err = validateWorkspaceFolderParam(p.workspaceFolder);
      if (err) {
        return {
          content: [{ type: 'text', text: err }],
          isError: true,
        };
      }
      const result = await getTerminalOutputToolHandler({ terminalId: p.terminalId, maxLines: p.maxLines ?? 1000 });
      return {
        content: result.content.map(item => ({
          ...item,
          type: 'text' as const,
        })),
        isError: result.isError,
      };
    }
  );

  // Register the "ask_report" tool (RAW schema)
  mcpServer.toolWithRawInputSchema(
    'ask_report',
    dedent`
      Open a webview to ask for a user report/confirmation and return the decision.
      Input schema matches the reference 'ask_user' exactly.
    `.trim(),
    {
      type: 'object',
      properties: {
        projectName: { type: 'string', description: 'Identifies the context/project making the request' },
        message: { type: 'string', description: 'The specific question/report for the user. Supports Markdown formatting.' },
        predefinedOptions: { type: 'array', items: { type: 'string' }, description: 'Predefined options for the user to choose from (optional)' },
        workspaceFolder: { type: 'string', description: 'Absolute path to workspace (required)' },
      },
      required: ['projectName', 'message', 'workspaceFolder'],
    },
    async (params): Promise<CallToolResult> => {
      const p = (params ?? {}) as { projectName: string; message: string; predefinedOptions?: string[]; workspaceFolder?: string };
      const err = validateWorkspaceFolderParam(p.workspaceFolder);
      if (err) {
        return {
          content: [{ type: 'text', text: err }],
          isError: true,
        };
      }
      const result = await askReport({
        title: p.projectName,
        markdown: p.message,
        initialValue: '',
        predefinedOptions: p.predefinedOptions,
      });
      // Align responses with reference project for timeout and cancel cases
      let text: string;
      if (result.timeout === true) {
        text = 'User did not reply: Timeout occurred.';
      } else if (result.decision === 'Cancel' && (!result.value || result.value.trim() === '')) {
        text = 'User replied with empty input.';
      } else {
        // Keep Submit path informative
        text = `User replied: ${result.value}`;
      }
      return {
        content: [
          { type: 'text', text },
        ],
        isError: false,
      };
    },
  );
}
