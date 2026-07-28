import { buildChatRows, dayLabel } from '../src/lib/chatRows';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COPY = { today: 'Today', yesterday: 'Yesterday', months: MONTHS };

// Local-midnight-anchored ISO, so tests don't drift across timezones.
const at = (offsetDays, hour = 12) => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offsetDays, hour).toISOString();
};

const msg = (id, from, ts) => ({ id, from, ts });
const label = (key, date) => dayLabel(key, date, COPY);

describe('buildChatRows', () => {
  test('empty input produces no rows', () => {
    expect(buildChatRows([], label)).toEqual([]);
    expect(buildChatRows(null, label)).toEqual([]);
  });

  test('one separator per distinct day, not one for the whole thread', () => {
    const rows = buildChatRows([
      msg('a', 'dispatcher', at(-2)),
      msg('b', 'driver', at(-1)),
      msg('c', 'driver', at(0)),
    ], label);
    const seps = rows.filter((r) => r.type === 'sep');
    expect(seps).toHaveLength(3);
    expect(seps.map((s) => s.label)).toEqual([expect.any(String), 'Yesterday', 'Today']);
  });

  test('messages on the same day share a single separator', () => {
    const rows = buildChatRows([
      msg('a', 'driver', at(0, 9)),
      msg('b', 'driver', at(0, 10)),
      msg('c', 'driver', at(0, 11)),
    ], label);
    expect(rows.filter((r) => r.type === 'sep')).toHaveLength(1);
    expect(rows.filter((r) => r.type === 'msg')).toHaveLength(3);
  });

  test('carries grouping neighbours for avatar/spacing decisions', () => {
    const rows = buildChatRows([
      msg('a', 'dispatcher', at(0, 9)),
      msg('b', 'dispatcher', at(0, 10)),
      msg('c', 'driver', at(0, 11)),
    ], label).filter((r) => r.type === 'msg');

    expect(rows[0]).toMatchObject({ prevFrom: null, nextFrom: 'dispatcher' });
    expect(rows[1]).toMatchObject({ prevFrom: 'dispatcher', nextFrom: 'driver' });
    expect(rows[2]).toMatchObject({ prevFrom: 'dispatcher', nextFrom: null });
  });

  test('grouping does not span a day boundary', () => {
    // Same sender either side of midnight must not be grouped — a separator
    // now sits between them, so the second needs its own avatar.
    const rows = buildChatRows([
      msg('a', 'dispatcher', at(-1, 23)),
      msg('b', 'dispatcher', at(0, 1)),
    ], label).filter((r) => r.type === 'msg');

    expect(rows[0].nextFrom).toBeNull();
    expect(rows[1].prevFrom).toBeNull();
  });

  test('optimistic local messages with no ts fall into today', () => {
    const rows = buildChatRows([{ id: 'local-123', from: 'driver' }], label);
    expect(rows[0]).toMatchObject({ type: 'sep', label: 'Today' });
    expect(rows[1]).toMatchObject({ type: 'msg', key: 'local-123' });
  });

  test('unparseable ts degrades to today rather than throwing', () => {
    const rows = buildChatRows([{ id: 'x', from: 'driver', ts: 'not-a-date' }], label);
    expect(rows[0].label).toBe('Today');
  });

  test('row keys are stable and unique', () => {
    const rows = buildChatRows([
      msg('a', 'driver', at(-1)),
      msg('b', 'driver', at(0)),
    ], label);
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('dayLabel', () => {
  const keyOf = (offsetDays) => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offsetDays).getTime();
  };

  test('today and yesterday are words, not dates', () => {
    expect(dayLabel(keyOf(0), new Date(keyOf(0)), COPY)).toBe('Today');
    expect(dayLabel(keyOf(-1), new Date(keyOf(-1)), COPY)).toBe('Yesterday');
  });

  test('older dates in this year omit the year', () => {
    const d = new Date(new Date().getFullYear(), 2, 3); // Mar 3
    expect(dayLabel(d.getTime(), d, COPY)).toBe('Mar 3');
  });

  test('dates in another year include it', () => {
    const d = new Date(new Date().getFullYear() - 1, 2, 3);
    expect(dayLabel(d.getTime(), d, COPY)).toBe(`Mar 3, ${d.getFullYear()}`);
  });
});
