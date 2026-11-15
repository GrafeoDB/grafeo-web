import type { EngineOptions } from './types';

/**
 * The engine settings in `options`, as the WASM `Database` constructor and
 * `importSnapshot` take them: only the keys that are set, or `undefined` when
 * none is, so a database without settings opens exactly as before.
 */
export function engineOptionsOf(options?: EngineOptions): EngineOptions | undefined {
  if (!options) return undefined;
  const picked: EngineOptions = {};
  if (options.memoryLimit !== undefined) picked.memoryLimit = options.memoryLimit;
  if (options.pathSearchBudget !== undefined) picked.pathSearchBudget = options.pathSearchBudget;
  if (options.historyRetention !== undefined) picked.historyRetention = options.historyRetention;
  return Object.keys(picked).length > 0 ? picked : undefined;
}
