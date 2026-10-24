/**
 * Engine builds with a known defect the wrapper must step around.
 *
 * `compact()` in these builds reads the system clock (`std::time::Instant`),
 * which wasm32 does not have: the call panics, and the panic leaves the WASM
 * `Database` unusable (every later call fails with "recursive use of an
 * object"). Refusing the call keeps the database, and its unsaved writes,
 * alive. The integration tests check that each listed build still panics, so
 * a fixed build fails them until it is taken off this list.
 */
export const COMPACT_PANICS_IN: ReadonlySet<string> = new Set(['0.6.0-beta.1']);

/** Throws a clear error instead of calling a `compact()` that would panic. */
export function assertCompactWorks(engineVersion: string): void {
  if (COMPACT_PANICS_IN.has(engineVersion)) {
    throw new Error(
      `compact() is not available with Grafeo ${engineVersion}: the engine panics on it in WebAssembly, which would leave this database unusable. Your data is unchanged.`,
    );
  }
}
