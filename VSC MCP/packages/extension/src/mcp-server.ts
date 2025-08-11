import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  CallToolResult,
  ListToolsResult 
} from '@modelcontextprotocol/sdk/types.js';

export const EXTENSION_NAME = 'VSC MCP';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'vsc-mcp',
    version: '1.0.0'
  }, {
    capabilities: {
      tools: {}
    }
  });

  // Define available tools
  const tools: any[] = [
    {
      name: 'text_editor',
      description: 'Perform file operations: view, edit, create files',
      inputSchema: {
        type: 'object' as const,
        properties: {
          command: {
            type: 'string',
            enum: ['view', 'str_replace', 'create', 'insert', 'undo_edit'],
            description: 'Operation to perform'
          },
          path: {
            type: 'string',
            description: 'File path to operate on'
          }
        },
        required: ['command', 'path']
      }
    },
    {
      name: 'execute_command',
      description: 'Execute commands in VSCode integrated terminal',
      inputSchema: {
        type: 'object' as const,
        properties: {
          command: {
            type: 'string',
            description: 'The command to execute'
          }
        },
        required: ['command']
      }
    },
    {
      name: 'list_directory',
      description: 'List directory contents in a tree format',
      inputSchema: {
        type: 'object' as const,
        properties: {
          path: {
            type: 'string',
            description: 'Directory path to list'
          }
        },
        required: ['path']
      }
    }
  ];

  // Handle list tools requests
  server.server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
    return { tools };
  });

  // Handle tool call requests
  server.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const toolName = request.params.name;
    const args = request.params.arguments as any;

    switch (toolName) {
      case 'text_editor':
        return { content: [{ type: 'text', text: `Text editor tool called with: ${JSON.stringify(args)}` }] };
      
      case 'execute_command':
        return { content: [{ type: 'text', text: `Execute command tool called with: ${JSON.stringify(args)}` }] };
      
      case 'list_directory':
        return { content: [{ type: 'text', text: `List directory tool called with: ${JSON.stringify(args)}` }] };
      
      default:
        return {
          isError: true,
          content: [{ type: 'text', text: `Unknown tool: ${toolName}` }]
        };
    }
  });

  return server;
}