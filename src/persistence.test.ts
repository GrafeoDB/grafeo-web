import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersistenceManager } from './persistence';

// happy-dom provides IndexedDB
describe('PersistenceManager', () => {
  let pm: PersistenceManager;

  beforeEach(() => {
    pm = new PersistenceManager('test-key');
  });

  afterEach(async () => {
    await pm.clear();
  });

  describe('load()', () => {
    it('returns null when no snapshot exists', async () => {
      const result = await pm.load();
      expect(result).toBeNull();
    });
  });

  describe('save() / load()', () => {
    it('persists and retrieves a snapshot', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      await pm.save(data);

      const loaded = await pm.load();
      expect(loaded).toBeInstanceOf(Uint8Array);
      expect(Array.from(loaded!)).toEqual([1, 2, 3, 4, 5]);
    });

    it('overwrites existing snapshots', async () => {
      await pm.save(new Uint8Array([1, 2, 3]));
      await pm.save(new Uint8Array([4, 5, 6]));

      const loaded = await pm.load();
      expect(Array.from(loaded!)).toEqual([4, 5, 6]);
    });
  });

  describe('clear()', () => {
    it('removes the snapshot', async () => {
      await pm.save(new Uint8Array([1, 2, 3]));
      await pm.clear();

      const loaded = await pm.load();
      expect(loaded).toBeNull();
    });
  });

  describe('scheduleSave()', () => {
    it('debounces saves', async () => {
      vi.useFakeTimers();

      const getSnapshot = vi.fn(() => new Uint8Array([1, 2, 3]));

      pm.scheduleSave(getSnapshot);
      pm.scheduleSave(getSnapshot);
      pm.scheduleSave(getSnapshot);

      // Snapshot function should not have been called yet
      expect(getSnapshot).not.toHaveBeenCalled();

      // Advance timers past debounce interval
      await vi.advanceTimersByTimeAsync(1100);

      // Should have been called exactly once (debounced)
      expect(getSnapshot).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('cancel()', () => {
    it('clears the pending timer without disposing', async () => {
      vi.useFakeTimers();

      const getSnapshot = vi.fn(() => new Uint8Array([1, 2, 3]));

      pm.scheduleSave(getSnapshot);
      pm.cancel();

      // Advance timers past debounce interval; no save should have fired.
      await vi.advanceTimersByTimeAsync(1100);
      expect(getSnapshot).not.toHaveBeenCalled();

      // After cancel, scheduleSave should still work normally (not disposed).
      pm.scheduleSave(getSnapshot);
      await vi.advanceTimersByTimeAsync(1100);
      expect(getSnapshot).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('flush()', () => {
    it('saves immediately when dirty', async () => {
      const data = new Uint8Array([7, 8, 9]);
      const getSnapshot = vi.fn(() => data);

      pm.scheduleSave(getSnapshot);
      // Flush before debounce fires
      await pm.flush(getSnapshot);

      const loaded = await pm.load();
      expect(Array.from(loaded!)).toEqual([7, 8, 9]);
      expect(getSnapshot).toHaveBeenCalledTimes(1);
    });

    it('does nothing when not dirty', async () => {
      const getSnapshot = vi.fn(() => new Uint8Array([1]));
      await pm.flush(getSnapshot);
      expect(getSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('storageStats()', () => {
    it('returns storage estimate', async () => {
      const stats = await pm.storageStats();
      expect(stats).toHaveProperty('bytesUsed');
      expect(stats).toHaveProperty('quota');
    });
  });

  describe('disposed guard', () => {
    it('does not save after flush()', async () => {
      const getSnapshot = () => new Uint8Array([1, 2, 3]);
      await pm.flush(getSnapshot);

      // After flush, scheduleSave should be a no-op
      const saveSpy = vi.spyOn(pm, 'save');
      pm.scheduleSave(() => new Uint8Array([4, 5, 6]));

      // Wait for debounce
      await new Promise((r) => setTimeout(r, 1200));
      expect(saveSpy).not.toHaveBeenCalled();
      saveSpy.mockRestore();
    });
  });

  describe('onError callback', () => {
    it('calls custom error handler on save failure', async () => {
      const errors: Error[] = [];
      const pm2 = new PersistenceManager('error-test', 50, (err) => errors.push(err));

      // Schedule a save with a callback that throws
      pm2.scheduleSave(() => { throw new Error('snapshot failed'); });

      // Wait for debounce to fire
      await new Promise((r) => setTimeout(r, 200));
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('snapshot failed');
      await pm2.clear();
    });
  });

  describe('isolation between keys', () => {
    it('different keys store different snapshots', async () => {
      const pm2 = new PersistenceManager('other-key');

      await pm.save(new Uint8Array([1, 1, 1]));
      await pm2.save(new Uint8Array([2, 2, 2]));

      const loaded1 = await pm.load();
      const loaded2 = await pm2.load();

      expect(Array.from(loaded1!)).toEqual([1, 1, 1]);
      expect(Array.from(loaded2!)).toEqual([2, 2, 2]);

      await pm2.clear();
    });
  });
});
