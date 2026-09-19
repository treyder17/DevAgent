// desktop/build.js — bundle the Electron main process + the whole DevAgent
// engine (and its deps) into one self-contained ESM file, so the packaged app
// needs no node_modules and no ../src at runtime.

import { build } from 'esbuild';

await build({
  entryPoints: ['main.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'build/main.mjs',
  external: ['electron'],
  banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
  logLevel: 'info',
});

console.log('Bundled desktop/build/main.mjs');
