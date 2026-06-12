// Build script for the Pretoken plugin.
// - Bundles the sandbox code (src/main/code.ts) into dist/code.js
// - Bundles the UI (src/ui/ui.ts) and inlines it together with ui.css into a
//   single self-contained dist/ui.html (Figma requires the UI to be one HTML file).
//
// Usage:
//   node build.mjs           one-off build
//   node build.mjs --watch   rebuild on change
import { build, context } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const watch = process.argv.includes('--watch');
mkdirSync('dist', { recursive: true });

const codeOptions = {
  entryPoints: ['src/main/code.ts'],
  bundle: true,
  outfile: 'dist/code.js',
  target: 'es2017',
  format: 'iife',
  logLevel: 'info',
};

// Inline the bundled UI JS + ui.css into the HTML template.
function inlineHtml(js) {
  const css = readFileSync('src/ui/ui.css', 'utf8');
  const tpl = readFileSync('src/ui/ui.html', 'utf8');
  const html = tpl.replace('/*__CSS__*/', () => css).replace('//__JS__', () => js);
  writeFileSync('dist/ui.html', html);
  console.log('[inline-html] wrote dist/ui.html');
}

const uiOptions = {
  entryPoints: ['src/ui/ui.ts'],
  bundle: true,
  write: false,
  outfile: 'dist/ui.js',
  target: 'es2017',
  format: 'iife',
  logLevel: 'info',
};

function jsFrom(result) {
  const out = (result.outputFiles || []).find((f) => f.path.endsWith('.js'));
  if (!out) throw new Error('UI bundle produced no JS output');
  return out.text;
}

if (watch) {
  const codeCtx = await context(codeOptions);
  // A tiny plugin re-runs the inline step after every UI rebuild.
  const uiCtx = await context({
    ...uiOptions,
    plugins: [
      {
        name: 'inline-html',
        setup(b) {
          b.onEnd((result) => {
            if (result.outputFiles && result.outputFiles.length) inlineHtml(jsFrom(result));
          });
        },
      },
    ],
  });
  await Promise.all([codeCtx.watch(), uiCtx.watch()]);
  console.log('Watching for changes…');
} else {
  const [, uiResult] = await Promise.all([build(codeOptions), build(uiOptions)]);
  inlineHtml(jsFrom(uiResult));
  console.log('Build complete.');
}
