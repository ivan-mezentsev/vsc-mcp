export const initialTools = [
  {
    name: 'text_editor',
    description: 'Perform file operations: view, edit, create files',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          enum: ['view', 'str_replace', 'create', 'insert', 'undo_edit']
        },
        path: { type: 'string' }
      },
      required: ['command', 'path']
    }
  },
  {
    name: 'execute_command',
    description: 'Execute commands in VSCode terminal',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' }
      },
      required: ['command']
    }
  },
  {
    name: 'list_directory',
    description: 'List directory contents',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    }
  }
];