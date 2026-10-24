/**
 * The worker installs its message handler before the engine has loaded, and
 * answers messages that arrive in the meantime, in order, once it has.
 *
 * Under Vite the engine's `.wasm` import becomes a top-level await. With a
 * static import of the engine, worker.ts did not run, and so installed no
 * handler, until the WASM was compiled: the `init` that `GrafeoDB.create()`
 * posts right after `new Worker()` was lost and `create()` never resolved.
 * Here the engine import is held open by a gate to the same effect.
 */
import { describe, expect, it, vi } from 'vitest';

import type { WorkerRequest, WorkerResponse } from './types';

// The engine's init (the `default` export of a --target web build) is where
// the test holds the load open, or fails it. vi.mock is hoisted above the
// imports, so its state is too.
const engine = vi.hoisted(() => {
  let releaseModule: () => void = () => {};
  const moduleGate = new Promise<void>((resolve) => {
    releaseModule = resolve;
  });
  return {
    inits: 0,
    fail: false,
    gate: Promise.resolve() as Promise<void>,
    // Holds the engine module's evaluation open, like Vite's top-level await.
    moduleGate,
    releaseModule: () => releaseModule(),
  };
});

vi.mock('@grafeo-db/wasm', async () => {
  await engine.moduleGate;
  const mock = await import('./__mocks__/wasm');
  return {
    ...mock,
    default: async () => {
      engine.inits += 1;
      await engine.gate;
      if (engine.fail) {
        throw new Error('network error while fetching grafeo_wasm_bg.wasm');
      }
    },
  };
});

const responses: WorkerResponse[] = [];
vi.stubGlobal('postMessage', (message: WorkerResponse) => {
  responses.push(message);
});

function post(request: WorkerRequest): void {
  const handler = (self as unknown as { onmessage: ((e: MessageEvent) => void) | null }).onmessage;
  handler!({ data: request } as MessageEvent<WorkerRequest>);
}

describe('worker before the engine is ready', () => {
  it('evaluates and installs its handler while the engine module is still loading', async () => {
    // With a static import of the engine this import would not resolve.
    await import('./worker');
    expect(typeof (self as unknown as { onmessage: unknown }).onmessage).toBe('function');
    expect(engine.inits).toBe(0);
    engine.releaseModule();
  });

  it('answers with an error when the engine fails to load', async () => {
    engine.fail = true;
    post({ id: 1, method: 'version', args: [] });
    await vi.waitFor(() => expect(responses).toHaveLength(1));
    expect(responses[0]).toMatchObject({
      id: 1,
      error: 'Failed to load the Grafeo engine: network error while fetching grafeo_wasm_bg.wasm',
    });
    expect(engine.inits).toBe(1);
  });

  it('queues messages that arrive while the engine loads and answers them in order', async () => {
    responses.length = 0;
    engine.fail = false;
    let release: () => void = () => {};
    engine.gate = new Promise((resolve) => {
      release = resolve;
    });

    post({ id: 2, method: 'init', args: [undefined] });
    post({ id: 3, method: 'execute', args: ["INSERT (:Person {name: 'Alix'})"] });
    post({ id: 4, method: 'nodeCount', args: [] });

    // The failed load is retried by the next message.
    await vi.waitFor(() => expect(engine.inits).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(responses).toEqual([]);

    release();
    await vi.waitFor(() => expect(responses).toHaveLength(3));
    expect(responses.map((r) => r.id)).toEqual([2, 3, 4]);
    expect(responses.every((r) => r.error === undefined)).toBe(true);
    expect(responses[0].result).toBe(true);
    expect(responses[2].result).toBe(1);
    // Loaded once, not once per message.
    expect(engine.inits).toBe(2);
  });

  it('runs messages one at a time, in arrival order', async () => {
    responses.length = 0;
    // `init` with persistence awaits IndexedDB; the messages behind it wait for it.
    post({ id: 5, method: 'init', args: [{ persist: 'worker-queue-order' }] });
    post({ id: 6, method: 'execute', args: ["INSERT (:Person {name: 'Gus'})"] });
    post({ id: 7, method: 'nodeCount', args: [] });
    post({ id: 8, method: 'clear', args: [] });
    post({ id: 9, method: 'close', args: [] });

    await vi.waitFor(() => expect(responses).toHaveLength(5));
    expect(responses.map((r) => r.id)).toEqual([5, 6, 7, 8, 9]);
    expect(responses.every((r) => r.error === undefined)).toBe(true);
    expect(responses[2].result).toBe(1);
  });
});
