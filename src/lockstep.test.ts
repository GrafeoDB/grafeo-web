import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

const pkg = readJson('../package.json');
const lock = readJson('../package-lock.json');

// grafeo-web ships in lockstep with grafeo, version for version: each release
// depends on exactly the wasm build it was tested against. A caret range (what
// `npm install --save` writes) lets a fresh install pull a newer engine build
// than the one this release was tested with.
//
// While grafeo publishes only a pre-release of the next version, the next web
// version is prepared on it (web 0.6.0 pinned 0.6.0-beta.1 until 0.6.0 was out).
// The pin is still exact, still of the same core version, and both packages
// pin the same build. A stable web version is never published on such a pin:
// the Publish workflow runs this file with GRAFEO_WEB_RELEASE=1, which turns
// the last test below into a hard check.
const EXACT = /^(\d+\.\d+\.\d+)(?:-((?:alpha|beta|rc)\.\d+))?$/;

/** Why this package.json must not be published, or null when it may be. */
function releaseBlocker(manifest: {
  version: string;
  dependencies: Record<string, string>;
}): string | null {
  const webPrerelease = manifest.version.includes('-') && !/-hotfix\.\d+$/.test(manifest.version);
  for (const dep of ['@grafeo-db/wasm', '@grafeo-db/wasm-lite']) {
    const pin = manifest.dependencies[dep];
    const match = EXACT.exec(pin ?? '');
    if (match?.[2] && !webPrerelease) {
      return `${dep} is pinned to the engine pre-release ${pin}; ${manifest.version} ships only on a final engine release`;
    }
  }
  return null;
}

describe('lockstep wasm dependencies', () => {
  const wasmDeps = ['@grafeo-db/wasm', '@grafeo-db/wasm-lite'];
  // A web-only hotfix (0.5.40-hotfix.1) still ships on its core release.
  const coreVersion = pkg.version.split('-')[0];

  it.each(wasmDeps)('%s is pinned exactly to the core version of this release, or a pre-release of it', (dep) => {
    const pin = pkg.dependencies[dep];
    const match = EXACT.exec(pin);
    expect(match, `${dep}: "${pin}" is not an exact version`).not.toBeNull();
    expect(match![1]).toBe(coreVersion);
  });

  it('both wasm packages pin the same engine build', () => {
    expect(pkg.dependencies['@grafeo-db/wasm-lite']).toBe(pkg.dependencies['@grafeo-db/wasm']);
  });

  it.each(wasmDeps)('%s has the same pin in package-lock.json', (dep) => {
    expect(lock.packages[''].dependencies[dep]).toBe(pkg.dependencies[dep]);
    expect(lock.packages[`node_modules/${dep}`].version).toBe(pkg.dependencies[dep]);
  });

  it.each(wasmDeps)('%s is installed at the pinned version', (dep) => {
    expect(readJson(`../node_modules/${dep}/package.json`).version).toBe(pkg.dependencies[dep]);
  });

  it('package-lock.json carries the package version', () => {
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
  });
});

describe('release on a pre-release engine', () => {
  const deps = (pin: string) => ({ '@grafeo-db/wasm': pin, '@grafeo-db/wasm-lite': pin });

  it('blocks a stable version on a pre-release engine', () => {
    expect(releaseBlocker({ version: '0.6.0', dependencies: deps('0.6.0-beta.1') })).toMatch(
      /pinned to the engine pre-release 0\.6\.0-beta\.1/,
    );
    expect(releaseBlocker({ version: '0.6.0-hotfix.1', dependencies: deps('0.6.0-rc.1') })).not.toBeNull();
  });

  it('allows a final engine, and a web pre-release on a pre-release engine', () => {
    expect(releaseBlocker({ version: '0.6.0', dependencies: deps('0.6.0') })).toBeNull();
    expect(releaseBlocker({ version: '0.6.0-beta.1', dependencies: deps('0.6.0-beta.1') })).toBeNull();
  });

  // While a version is prepared on an engine pre-release this only reports; with
  // GRAFEO_WEB_RELEASE=1 (the Publish workflow) it refuses the release.
  it('this package.json may be published (strict with GRAFEO_WEB_RELEASE=1)', () => {
    const blocker = releaseBlocker(pkg);
    if (process.env.GRAFEO_WEB_RELEASE === '1') {
      expect(blocker).toBeNull();
    } else if (blocker) {
      console.info(`[lockstep] not publishable yet: ${blocker}`);
    }
  });
});
