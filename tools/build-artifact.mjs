/**
 * @file Bundle the game into a single self-contained HTML page.
 *
 * The published page runs under a strict CSP with no external requests
 * permitted, and the game is ~90 ES modules. esbuild flattens them into one
 * IIFE which is then inlined, so the result is a single file with no network
 * dependencies at all — which is only possible because the game has no asset
 * files to begin with.
 *
 * Usage: `node tools/build-artifact.mjs [outfile]`
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = process.argv[2] ?? 'dist/aetherweir.html';
const BUNDLE = path.join(path.dirname(OUT) || '.', '.aetherweir.bundle.js');

fs.mkdirSync(path.dirname(OUT) || '.', { recursive: true });

execFileSync('npx', [
  'esbuild', 'src/main.js', '--bundle', '--format=iife',
  '--global-name=AW', '--minify', '--target=es2022', `--outfile=${BUNDLE}`,
], { stdio: 'inherit' });

// A minified string could contain the literal `</script`, which would close the
// tag early. Escaping the slash is inert to JS and safe to the HTML parser.
const bundle = fs.readFileSync(BUNDLE, 'utf8').replace(/<\/script/gi, '<\\/script');
fs.rmSync(BUNDLE);

const shell = fs.readFileSync('tools/artifact-shell.html', 'utf8');
fs.writeFileSync(OUT, shell.replace('/*__BUNDLE__*/', () => bundle));

console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)}kb)`);
