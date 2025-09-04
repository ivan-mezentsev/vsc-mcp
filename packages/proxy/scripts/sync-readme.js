#!/usr/bin/env node
// Copies the repo root README.md into packages/proxy/README.md so it gets included in npm pack
// Note: `npm pack --dry-run` does not run lifecycle scripts. Run `npm run sync:readme` manually before dry-run.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const proxyDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(proxyDir, '../..');
const srcReadme = path.join(repoRoot, 'README.md');
const dstReadme = path.join(proxyDir, 'README.md');

if (!fs.existsSync(srcReadme)) {
  console.error(`[sync-readme] Root README not found at ${srcReadme}`);
  process.exit(1);
}

try {
  const content = fs.readFileSync(srcReadme, 'utf8');
  // Optional: adjust relative links/images if needed. For now, copy as-is.
  fs.writeFileSync(dstReadme, content, 'utf8');
  console.log(`[sync-readme] Copied ${path.relative(repoRoot, srcReadme)} -> ${path.relative(repoRoot, dstReadme)}`);
} catch (err) {
  console.error('[sync-readme] Failed to copy README:', err);
  process.exit(1);
}
