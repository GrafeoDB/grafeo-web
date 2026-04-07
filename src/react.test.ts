import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act, type FC } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Suppress "not configured to support act()" warnings
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@grafeo-db/wasm', () => import('./__mocks__/wasm'));

const { useGrafeo, useQuery } = await import('./react');
const { GrafeoDB } = await import('./index');
type GrafeoDBInstance = Awaited<ReturnType<typeof GrafeoDB.create>>;

/**
 * Minimal renderHook helper — renders a component that calls the hook
 * and exposes the latest result via a ref object. Uses React.act() to
 * ensure synchronous initial render.
 */
function renderHook<T>(hookFn: () => T): {
  result: { current: T };
  unmount: () => void;
} {
  const resultRef = { current: null as T };
  let root: Root;
  const container = document.createElement('div');
  document.body.appendChild(container);

  const TestComponent: FC = () => {
    resultRef.current = hookFn();
    return null;
  };

  act(() => {
    root = createRoot(container);
    root.render(React.createElement(TestComponent));
  });

  return {
    result: resultRef as { current: T },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
}

describe('useGrafeo (React)', () => {
  it('initial state: loading=true, db=null', () => {
    const { result, unmount } = renderHook(() => useGrafeo());

    // Synchronous initial render
    expect(result.current.loading).toBe(true);
    expect(result.current.db).toBe(null);
    expect(result.current.error).toBe(null);

    unmount();
  });

  it('resolves to loading=false with db instance', async () => {
    const { result, unmount } = renderHook(() => useGrafeo());

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.db).not.toBe(null);
    expect(result.current.db).toHaveProperty('execute');

    unmount();
  });

  it('cleanup on unmount closes the db', async () => {
    const { result, unmount } = renderHook(() => useGrafeo());

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const instance = result.current.db!;
    const closeSpy = vi.spyOn(instance, 'close');

    unmount();

    expect(closeSpy).toHaveBeenCalled();
  });

  it('handles creation errors', async () => {
    const createSpy = vi
      .spyOn(GrafeoDB, 'create')
      .mockRejectedValueOnce(new Error('WASM init failed'));

    const { result, unmount } = renderHook(() => useGrafeo());

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe('WASM init failed');
    expect(result.current.db).toBe(null);

    unmount();
    createSpy.mockRestore();
  });
});

describe('T6: useGrafeo mount/unmount/remount (React)', () => {
  it('remount creates a fresh db, not stale state', async () => {
    // First mount
    const { result: result1, unmount: unmount1 } = renderHook(() => useGrafeo());

    await vi.waitFor(() => {
      expect(result1.current.loading).toBe(false);
    });

    const firstDb = result1.current.db!;
    expect(firstDb).toHaveProperty('execute');
    expect(firstDb.isOpen).toBe(true);

    // Insert data in first instance
    await firstDb.execute("INSERT (:Person {name: 'Alice'})");

    // Unmount (triggers close)
    unmount1();

    // Second mount (remount)
    const { result: result2, unmount: unmount2 } = renderHook(() => useGrafeo());

    await vi.waitFor(() => {
      expect(result2.current.loading).toBe(false);
    });

    const secondDb = result2.current.db!;
    expect(secondDb).toHaveProperty('execute');
    expect(secondDb.isOpen).toBe(true);

    // The new db should be a fresh instance (no stale state from the first)
    expect(secondDb).not.toBe(firstDb);

    // Fresh database should have no data
    const results = await secondDb.execute('MATCH (p:Person) RETURN p.name');
    expect(results).toEqual([]);

    unmount2();
  });

  it('unmount closes db, no lingering references', async () => {
    const { result, unmount } = renderHook(() => useGrafeo());

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const instance = result.current.db!;
    expect(instance.isOpen).toBe(true);

    unmount();

    // After unmount, the instance should be closed
    expect(instance.isOpen).toBe(false);
  });

  it('rapid mount/unmount/remount does not throw', async () => {
    // Mount
    const { unmount: u1 } = renderHook(() => useGrafeo());
    // Immediately unmount before init finishes
    u1();

    // Remount
    const { result: r2, unmount: u2 } = renderHook(() => useGrafeo());

    await vi.waitFor(() => {
      expect(r2.current.loading).toBe(false);
    });

    expect(r2.current.db).not.toBe(null);
    expect(r2.current.error).toBe(null);

    u2();
  });
});

describe('useQuery (React)', () => {
  let db: GrafeoDBInstance;

  afterEach(async () => {
    await db?.close();
  });

  it('executes query when db is provided', async () => {
    db = await GrafeoDB.create();
    await db.execute("INSERT (:Person {name: 'Alice'})");

    const { result, unmount } = renderHook(() =>
      useQuery(db, 'MATCH (p:Person) RETURN p.name'),
    );

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toHaveLength(1);
    expect(
      (result.current.data as Record<string, unknown>[])[0]['p.name'],
    ).toBe('Alice');

    unmount();
  });

  it('stays loading when db is null', async () => {
    const { result, unmount } = renderHook(() =>
      useQuery(null, 'MATCH (n) RETURN n'),
    );

    // Should stay loading since db is null
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe(null);

    unmount();
  });
});
