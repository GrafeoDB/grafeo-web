import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, nextTick, ref, type Ref } from 'vue';

vi.mock('@grafeo-db/wasm', () => import('./__mocks__/wasm'));

const { useGrafeo, useQuery } = await import('./vue');
const { GrafeoDB } = await import('./index');
type GrafeoDBInstance = Awaited<ReturnType<typeof GrafeoDB.create>>;

/**
 * Helper to run a composable inside a real Vue component setup context.
 * Returns the composable result and an unmount function.
 */
function withSetup<T>(composable: () => T): { result: T; unmount: () => void } {
  let result!: T;
  const app = createApp(
    defineComponent({
      setup() {
        result = composable();
        return () => null;
      },
    }),
  );
  const root = document.createElement('div');
  app.mount(root);
  return { result, unmount: () => app.unmount() };
}

describe('useGrafeo (Vue)', () => {
  it('initial state: loading=true, db=null, error=null', () => {
    const { result, unmount } = withSetup(() => useGrafeo());

    expect(result.loading.value).toBe(true);
    expect(result.db.value).toBe(null);
    expect(result.error.value).toBe(null);

    unmount();
  });

  it('resolves to loading=false with db instance', async () => {
    const { result, unmount } = withSetup(() => useGrafeo());

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false);
    });

    expect(result.db.value).not.toBe(null);
    expect(result.db.value).toHaveProperty('execute');

    unmount();
  });

  it('unmount triggers close', async () => {
    const { result, unmount } = withSetup(() => useGrafeo());

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false);
    });

    const instance = result.db.value!;
    const closeSpy = vi.spyOn(instance, 'close');

    unmount();

    expect(closeSpy).toHaveBeenCalled();
  });

  it('handles creation errors', async () => {
    const createSpy = vi
      .spyOn(GrafeoDB, 'create')
      .mockRejectedValueOnce(new Error('init failed'));

    const { result, unmount } = withSetup(() => useGrafeo());

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false);
    });

    expect(result.error.value).toBeInstanceOf(Error);
    expect(result.error.value!.message).toBe('init failed');
    expect(result.db.value).toBe(null);

    unmount();
    createSpy.mockRestore();
  });
});

describe('useQuery (Vue)', () => {
  let db: GrafeoDBInstance;
  let dbRef: Ref<GrafeoDBInstance | null>;

  afterEach(async () => {
    await db?.close();
  });

  it('executes query when db is available', async () => {
    db = await GrafeoDB.create();
    await db.execute("INSERT (:Person {name: 'Alice'})");
    dbRef = ref(db) as Ref<GrafeoDBInstance | null>;

    const { result, unmount } = withSetup(() =>
      useQuery(dbRef, 'MATCH (p:Person) RETURN p.name'),
    );

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false);
    });

    expect(result.data.value).toHaveLength(1);
    expect((result.data.value as Record<string, unknown>[])[0]['p.name']).toBe(
      'Alice',
    );
    expect(result.error.value).toBe(null);

    unmount();
  });

  it('stays loading when db is null', async () => {
    dbRef = ref(null) as Ref<GrafeoDBInstance | null>;

    const { result, unmount } = withSetup(() =>
      useQuery(dbRef, 'MATCH (n) RETURN n'),
    );

    // Should remain loading since db is null
    await nextTick();
    expect(result.loading.value).toBe(true);
    expect(result.data.value).toBe(null);

    unmount();
  });

  it('refetch triggers re-execution', async () => {
    db = await GrafeoDB.create();
    dbRef = ref(db) as Ref<GrafeoDBInstance | null>;

    const executeSpy = vi.spyOn(db, 'execute');

    const { result, unmount } = withSetup(() =>
      useQuery(dbRef, 'MATCH (p:Person) RETURN p.name'),
    );

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false);
    });

    const callCount = executeSpy.mock.calls.length;
    result.refetch();

    await vi.waitFor(() => {
      expect(executeSpy.mock.calls.length).toBeGreaterThan(callCount);
    });

    unmount();
  });
});
