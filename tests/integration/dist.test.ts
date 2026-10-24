/**
 * Checks on the built package (run `npm run build` first; CI builds before
 * the integration tests): what each entry loads, read from dist/ itself.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = resolve(root, 'dist');

const STATIC_IMPORT = /^\s*(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** Every module `entry` loads statically, itself included, and the bare specifiers they import. */
function staticGraph(entry: string): { files: string[]; packages: string[] } {
  const files: string[] = [];
  const packages = new Set<string>();
  const queue = [resolve(dist, entry)];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (files.includes(file)) continue;
    files.push(file);
    for (const match of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      const specifier = match[1] ?? match[2];
      if (specifier.startsWith('.')) queue.push(resolve(dirname(file), specifier));
      else packages.add(specifier);
    }
  }
  return { files, packages: [...packages] };
}

function dynamicImports(files: string[]): string[] {
  return files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(DYNAMIC_IMPORT)].map((m) => m[1]));
}

describe('dist', () => {
  it('is built', () => {
    expect(existsSync(resolve(dist, 'index.js')), 'dist/ is missing: run `npm run build` first').toBe(true);
  });

  it('every export of package.json points at a built file', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    const targets: string[] = [];
    const collect = (value: unknown) => {
      if (typeof value === 'string') targets.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(pkg.exports);
    const missing = targets.filter((target) => !existsSync(resolve(root, target)));
    expect(missing).toEqual([]);
  });

  it('worker-client loads no engine on the main thread', () => {
    const { files, packages } = staticGraph('worker-client.js');
    expect(packages).toEqual([]);
    expect(dynamicImports(files)).toEqual([]);
  });

  it('the main entry still loads the engine for direct mode', () => {
    expect(staticGraph('index.js').packages).toContain('@grafeo-db/wasm');
  });

  // A static import would hold the worker's message handler back until the
  // WASM is compiled (Vite: top-level await), losing the first message.
  it('the worker loads the engine with a dynamic import only', () => {
    const { files, packages } = staticGraph('worker.js');
    expect(packages).toEqual([]);
    expect(dynamicImports(files)).toEqual(['@grafeo-db/wasm']);
  });

  it('the worker client starts dist/worker.js', () => {
    const { files } = staticGraph('worker-client.js');
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).toMatch(/new Worker\(\s*(?:\/\/[^\n]*\n\s*)*new URL\("\.\/worker\.js", import\.meta\.url\)/);
    expect(existsSync(resolve(dist, 'worker.js'))).toBe(true);
  });
});
