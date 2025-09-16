const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const test = process.argv.includes('--test');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'warning',
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  });
  // build webview vendor (marked + highlight.js) - separate build because it's browser targeted
  await esbuild.build({
    entryPoints: ['src/webview/markdownDeps.ts'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    globalName: 'McpMarkdownDeps',
    minify: production,
    sourcemap: false,
    outfile: 'media/markdown-deps.js',
    logLevel: 'warning',
  });
  // copy highlight.js css theme from node_modules
  await copyHighlightCss();
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

async function testBuild() {
  const ctx = await esbuild.context({
    entryPoints: ['src/**/*.ts'],
    bundle: true,
    format: 'cjs',
    minify: false,
    sourcemap: true,
    sourcesContent: false,
    platform: 'node',
    outdir: 'out',
    logLevel: 'warning',
    external: ['vscode'],
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  });
  await ctx.rebuild();
  await ctx.dispose();
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location == null) return;
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  },
};

if (test) {
  testBuild().catch(e => {
    console.error(e);
    process.exit(1);
  });
} else {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}

const fs = require('node:fs');
const path = require('node:path');

async function copyHighlightCss() {
  try {
    const src = require.resolve('highlight.js/styles/github.css');
  const target = path.join(__dirname, 'media', 'highlight.github.css');
  fs.copyFileSync(src, target);
  } catch (e) {
  console.warn('[build] unable to copy highlight.js css', e && e.message ? e.message : e);
  }
}

