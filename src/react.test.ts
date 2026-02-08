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
