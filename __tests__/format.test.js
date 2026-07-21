import { money, num, rpm, fmtDate, daysUntil, expiryStatus, hm, toDistance, distNum, toRatePerDistance, distRpm } from '../src/lib/format';

describe('money', () => {
  test('rounds to whole dollars with thousands separators by default', () => {
    expect(money(1249.6)).toBe('$1,250');
    expect(money(0)).toBe('$0');
  });
  test('cents mode keeps two decimals', () => {
    expect(money(1249.5, { cents: true })).toBe('$1,249.50');
  });
  test('null/NaN render as $0, never NaN', () => {
    expect(money(null)).toBe('$0');
    expect(money(undefined)).toBe('$0');
    expect(money('not a number')).toBe('$0');
  });
});

describe('num / rpm', () => {
  test('num rounds and formats', () => {
    expect(num(12345.4)).toBe('12,345');
    expect(num(null)).toBe('0');
  });
  test('rpm keeps two decimals and dashes out bad input', () => {
    expect(rpm(2.5)).toBe('2.50');
    expect(rpm(null)).toBe('—');
    expect(rpm(NaN)).toBe('—');
  });
});

describe('dates', () => {
  test('fmtDate renders ISO dates and passes garbage through', () => {
    expect(fmtDate('2026-07-04')).toBe('Jul 4, 2026');
    expect(fmtDate('not-a-date')).toBe('not-a-date');
  });

  test('daysUntil counts from the provided today', () => {
    const today = new Date('2026-06-05T00:00:00');
    expect(daysUntil('2026-06-05', today)).toBe(0);
    expect(daysUntil('2026-06-15', today)).toBe(10);
    expect(daysUntil('2026-06-01', today)).toBe(-4);
    expect(daysUntil('garbage', today)).toBeNull();
  });

  test('expiryStatus tiers: expired < 0 ≤ expiring ≤ 30 < valid', () => {
    // These lean on the module's fixed demo "today" (2026-06-05).
    expect(expiryStatus('2026-06-01').key).toBe('expired');
    expect(expiryStatus('2026-06-20')).toMatchObject({ key: 'expiring', labelKey: 'documents.statusExpiringDays', labelParams: { days: 15 }, tone: 'caution' });
    expect(expiryStatus('2027-01-01').key).toBe('valid');
    expect(expiryStatus('garbage').key).toBe('valid'); // unparseable ⇒ don't cry wolf
  });
});

describe('toDistance / distNum', () => {
  test('mi passes miles through unchanged', () => {
    expect(toDistance(100, 'mi')).toBe(100);
    expect(distNum(925, 'mi')).toBe('925');
  });
  test('km converts using the mile constant', () => {
    expect(toDistance(100, 'km')).toBeCloseTo(160.934, 3);
    expect(distNum(925, 'km')).toBe('1,489'); // 925 * 1.60934 = 1488.6395
  });
  test('preserves sign for negative deltas', () => {
    expect(Math.round(toDistance(-42, 'km'))).toBe(-68);
  });
  test('null/NaN render as 0, never NaN', () => {
    expect(distNum(null, 'km')).toBe('0');
    expect(distNum(undefined, 'mi')).toBe('0');
  });
});

describe('toRatePerDistance / distRpm', () => {
  test('mi passes the rate through unchanged', () => {
    expect(toRatePerDistance(2.25, 'mi')).toBe(2.25);
    expect(distRpm(2.25, 'mi')).toBe('2.25');
  });
  test('km divides — a mile is longer, so pay per unit is lower', () => {
    expect(distRpm(2.25, 'km')).toBe('1.40'); // 2.25 / 1.60934 = 1.3981…
  });
  test('null/NaN dash out, like rpm()', () => {
    expect(distRpm(null, 'km')).toBe('—');
    expect(distRpm(NaN, 'mi')).toBe('—');
  });
});

describe('hm', () => {
  test('formats minutes into h/m compounds', () => {
    expect(hm(372)).toBe('6h 12m');
    expect(hm(120)).toBe('2h');
    expect(hm(45)).toBe('45m');
    expect(hm(null)).toBe('—');
  });
});
