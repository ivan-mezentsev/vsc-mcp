import { defineConfig } from '@vscode/test-cli';
import path from 'node:path';
import url from 'node:url';

// Resolve absolute path to the repo root so tests run with the real workspace
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const workspaceFolder = path.resolve(__dirname, '../..');

export default defineConfig({
  files: 'out/test/**/*.test.js',
  // Launch VS Code with the current project workspace instead of an empty window
  workspaceFolder,
});
