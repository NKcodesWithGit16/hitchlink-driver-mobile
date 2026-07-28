import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getHidden, getHiddenIds, getHiddenState, hideLoad, unhideLoad, clearHidden,
  filterHidden, hydrateHidden, isRestorable, daysLeft, compact, RESTORE_WINDOW_MS,
} from '../src/lib/hiddenLoads';

const D = 'driver-1';
const load = (id, extra = {}) => ({ id, origin: 'Dallas, TX', destination: 'Memphis, TN', rate: 2400, miles: 452, ...extra });

// Backdate a stored entry to simulate one hidden `ms` ago — there's no other
// way to reach the 3-week boundary without waiting three weeks.
const backdate = async (id, ms) => {
  const raw = JSON.parse(await AsyncStorage.getItem(`hl_hidden_loads_${D}`));
  const next = raw.map((e) => (e.id === id ? { ...e, hiddenAt: Date.now() - ms } : e));
  await AsyncStorage.setItem(`hl_hidden_loads_${D}`, JSON.stringify(next));
};
const DAY = 86400000;

beforeEach(() => AsyncStorage.clear());

describe('hiddenLoads storage', () => {
  test('hiding a load persists it and reports its id', async () => {
    expect((await getHiddenIds(D)).size).toBe(0);
    await hideLoad(D, load('L1'));
    const ids = await getHiddenIds(D);
    expect(ids.has('L1')).toBe(true);
    expect(ids.size).toBe(1);
  });

  test('the stored entry snapshots the load so it renders offline', async () => {
    await hideLoad(D, load('L1', { completedAt: '2026-07-02T10:00:00Z' }));
    const [e] = await getHidden(D);
    expect(e).toMatchObject({ id: 'L1', origin: 'Dallas, TX', destination: 'Memphis, TN', rate: 2400 });
    expect(typeof e.hiddenAt).toBe('number');
  });

  test('hiding the same load twice does not duplicate it', async () => {
    await hideLoad(D, load('L1'));
    await hideLoad(D, load('L1'));
    expect((await getHidden(D)).length).toBe(1);
  });

  test('unhide removes only that load', async () => {
    await hideLoad(D, load('L1'));
    await hideLoad(D, load('L2'));
    await unhideLoad(D, 'L1');
    const ids = await getHiddenIds(D);
    expect(ids.has('L1')).toBe(false);
    expect(ids.has('L2')).toBe(true);
  });

  test('numeric mock ids and string API ids are the same key', async () => {
    await hideLoad(D, load(7));
    expect((await getHiddenIds(D)).has('7')).toBe(true);
    await unhideLoad(D, 7);
    expect((await getHiddenIds(D)).size).toBe(0);
  });

  test('one driver never sees another driver hidden list', async () => {
    await hideLoad(D, load('L1'));
    expect((await getHiddenIds('driver-2')).size).toBe(0);
  });

  test('restore all empties the list', async () => {
    await hideLoad(D, load('L1'));
    await hideLoad(D, load('L2'));
    await clearHidden(D);
    expect(await getHidden(D)).toEqual([]);
  });

  test('getHiddenState reports the filter set and the restorable count together', async () => {
    await hideLoad(D, load('L1'));
    await hideLoad(D, load('L2'));
    await backdate('L1', RESTORE_WINDOW_MS + DAY);
    const { ids, restorable } = await getHiddenState(D);
    expect(ids).toEqual(new Set(['L1', 'L2']));
    expect(restorable).toBe(1);
  });
});

describe('the 3-week restore window', () => {
  test('a load hidden inside the window is still restorable', async () => {
    await hideLoad(D, load('L1'));
    await backdate('L1', 20 * DAY);
    expect((await getHidden(D)).map((e) => e.id)).toEqual(['L1']);
    expect(await unhideLoad(D, 'L1')).toBe(true);
    expect((await getHiddenIds(D)).size).toBe(0);
  });

  test('past the window it drops off the restore list but stays hidden forever', async () => {
    await hideLoad(D, load('L1'));
    await backdate('L1', RESTORE_WINDOW_MS + 1000);
    expect(await getHidden(D)).toEqual([]);                 // not offered for restore
    expect((await getHiddenIds(D)).has('L1')).toBe(true);   // still filtered out of history
  });

  test('an expired removal cannot be undone, even by a direct call', async () => {
    await hideLoad(D, load('L1'));
    await backdate('L1', RESTORE_WINDOW_MS + 1000);
    expect(await unhideLoad(D, 'L1')).toBe(false);
    expect((await getHiddenIds(D)).has('L1')).toBe(true);
  });

  test('expiry wipes the load snapshot from the device, keeping a bare tombstone', async () => {
    await hideLoad(D, load('L1', { completedAt: '2026-06-01T00:00:00Z' }));
    await backdate('L1', RESTORE_WINDOW_MS + 1000);
    await getHiddenIds(D); // any read compacts
    const [stored] = JSON.parse(await AsyncStorage.getItem(`hl_hidden_loads_${D}`));
    expect(Object.keys(stored).sort()).toEqual(['hiddenAt', 'id']);
  });

  test('restore all leaves expired tombstones in place', async () => {
    await hideLoad(D, load('L1'));
    await hideLoad(D, load('L2'));
    await backdate('L1', RESTORE_WINDOW_MS + DAY);
    await clearHidden(D);
    const ids = await getHiddenIds(D);
    expect(ids.has('L1')).toBe(true);   // permanent — stays gone from history
    expect(ids.has('L2')).toBe(false);  // restored
  });

  test('an entry with no timestamp fails closed rather than resurfacing', () => {
    expect(isRestorable({ id: 'L1' })).toBe(false);
  });

  test('daysLeft counts down whole days and floors at 0', () => {
    const now = Date.now();
    expect(daysLeft({ hiddenAt: now }, now)).toBe(21);
    expect(daysLeft({ hiddenAt: now - 20 * DAY }, now)).toBe(1);
    expect(daysLeft({ hiddenAt: now - 40 * DAY }, now)).toBe(0);
  });

  test('compact returns the same array when nothing has expired', () => {
    const list = [{ id: 'L1', hiddenAt: Date.now(), origin: 'Dallas, TX' }];
    expect(compact(list)).toBe(list);
  });

  test('a corrupt payload degrades to an empty list, not a throw', async () => {
    await AsyncStorage.setItem(`hl_hidden_loads_${D}`, 'not json');
    expect(await getHidden(D)).toEqual([]);
  });
});

describe('filterHidden', () => {
  const history = [load('L1'), load('L2'), load('L3')];

  test('drops hidden loads and keeps order', () => {
    const out = filterHidden(history, new Set(['L2']));
    expect(out.map((l) => l.id)).toEqual(['L1', 'L3']);
  });

  test('returns the list untouched when nothing is hidden', () => {
    expect(filterHidden(history, new Set())).toBe(history);
  });

  test('survives a missing history', () => {
    expect(filterHidden(null, new Set(['L1']))).toEqual([]);
  });

  test('matches ids across number/string forms', () => {
    expect(filterHidden([load(7), load(8)], new Set(['7'])).map((l) => l.id)).toEqual([8]);
  });
});

describe('hydrateHidden', () => {
  test('live history wins over the stored snapshot', () => {
    const entries = [{ id: 'L1', hiddenAt: 5, rate: 100, origin: 'stale' }];
    const out = hydrateHidden(entries, [load('L1', { rate: 2400, origin: 'Dallas, TX' })]);
    expect(out[0]).toMatchObject({ id: 'L1', hiddenAt: 5, rate: 2400, origin: 'Dallas, TX' });
  });

  test('falls back to the snapshot when history does not carry the load', () => {
    const entries = [{ id: 'L9', hiddenAt: 5, origin: 'Reno, NV', destination: 'Boise, ID' }];
    const out = hydrateHidden(entries, []);
    expect(out[0]).toMatchObject({ id: 'L9', origin: 'Reno, NV', destination: 'Boise, ID' });
  });
});
