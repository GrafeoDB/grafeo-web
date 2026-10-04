import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

const pkg = readJson('../package.json');
const lock = readJson('../package-lock.json');

// grafeo-web ships in lockstep with grafeo: each release depends on exactly the
// wasm build it was tested against. A caret range (what `npm install --save`
// writes) lets a fresh install pull the next engine release, and with it a new
// snapshot format for IndexedDB, without a web upgrade.
describe('lockstep wasm dependencies', () => {
  const wasmDeps = ['@grafeo-db/wasm', '@grafeo-db/wasm-lite'];
  // A web-only hotfix (0.5.40-hotfix.1) still ships on its core release.
  const coreVersion = pkg.version.split('-')[0];

  it.each(wasmDeps)('%s is pinned to exactly the core version of this release', (dep) => {
    expect(pkg.dependencies[dep]).toBe(coreVersion);
  });

  it.each(wasmDeps)('%s has the same pin in package-lock.json', (dep) => {
    expect(lock.packages[''].dependencies[dep]).toBe(pkg.dependencies[dep]);
    expect(lock.packages[`node_modules/${dep}`].version).toBe(pkg.dependencies[dep]);
  });

  it.each(wasmDeps)('%s is installed at the pinned version', (dep) => {
    expect(readJson(`../node_modules/${dep}/package.json`).version).toBe(pkg.dependencies[dep]);
  });
});
