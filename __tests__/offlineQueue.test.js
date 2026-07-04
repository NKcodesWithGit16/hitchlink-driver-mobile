import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueue, queueCount, flush } from '../src/lib/offlineQueue';

beforeEach(() => AsyncStorage.clear());

describe('offlineQueue', () => {
  test('enqueue persists items and reports the count', async () => {
    expect(await queueCount()).toBe(0);
    await enqueue({ loadId: 'L1', status: 'AtPickup' });
    expect(await enqueue({ loadId: 'L1', status: 'EnRouteToDropoff' })).toBe(2);
    expect(await queueCount()).toBe(2);
  });

  test('flush replays in order and empties the queue on success', async () => {
    await enqueue({ n: 1 });
    await enqueue({ n: 2 });
    const seen = [];
    const done = await flush(async (item) => { seen.push(item.n); });
    expect(done).toBe(2);
    expect(seen).toEqual([1, 2]);
    expect(await queueCount()).toBe(0);
  });

  test('failed items stay queued for the next flush', async () => {
    await enqueue({ n: 1 });
    await enqueue({ n: 2 });
    await enqueue({ n: 3 });
    const done = await flush(async (item) => {
      if (item.n === 2) throw new Error('still offline');
    });
    expect(done).toBe(2);
    expect(await queueCount()).toBe(1); // only #2 survives
    // Next flush (now succeeding) drains the survivor.
    expect(await flush(async () => {})).toBe(1);
    expect(await queueCount()).toBe(0);
  });

  test('flush on an empty queue is a no-op', async () => {
    const process = jest.fn();
    expect(await flush(process)).toBe(0);
    expect(process).not.toHaveBeenCalled();
  });
});
