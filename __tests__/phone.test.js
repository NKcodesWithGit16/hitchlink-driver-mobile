import {
  DEFAULT_COUNTRY, digitCount, formatNational, isValidPhone, splitE164, toE164,
} from '../src/lib/phone';

describe('formatNational', () => {
  it('formats per country, not per a single hardcoded shape', () => {
    expect(formatNational('US', '2024561111')).toBe('(202) 456-1111');
    expect(formatNational('GE', '555123456')).toBe('555 12 34 56');
  });

  it('strips anything that is not a digit before formatting', () => {
    // Pasting a number off a website brings its punctuation with it, and the
    // formatter must not try to build on top of somebody else's brackets.
    expect(formatNational('US', '(202) 456-1111')).toBe('(202) 456-1111');
    expect(formatNational('US', '202.456.1111')).toBe('(202) 456-1111');
  });

  it('is empty for empty input rather than returning punctuation', () => {
    expect(formatNational('US', '')).toBe('');
    expect(formatNational('US', null)).toBe('');
    expect(formatNational('US', 'abc')).toBe('');
  });
});

describe('toE164', () => {
  it('produces the wire format', () => {
    expect(toE164('US', '(202) 456-1111')).toBe('+12024561111');
    expect(toE164('GE', '555 12 34 56')).toBe('+995555123456');
  });

  it('drops a national trunk prefix instead of gluing it after the dial code', () => {
    // The bug this replaced: +995 0555… is not a number anyone can reach.
    expect(toE164('GB', '07911123456')).toBe('+447911123456');
  });

  it('is empty for no input', () => {
    expect(toE164('US', '')).toBe('');
    expect(toE164('US', undefined)).toBe('');
  });
});

describe('isValidPhone', () => {
  it('accepts real numbers for their own country', () => {
    expect(isValidPhone('US', '2024561111')).toBe(true);
    expect(isValidPhone('GE', '555123456')).toBe(true);
    expect(isValidPhone('GB', '7911123456')).toBe(true);
  });

  it('rejects a number that is right for another country', () => {
    // 10 digits is a US number and not a Georgian one — the whole reason the
    // old /^[0-9]{10}$/ rule had to go.
    expect(isValidPhone('GE', '2024561111')).toBe(false);
  });

  it('rejects short and empty input', () => {
    expect(isValidPhone('US', '123')).toBe(false);
    expect(isValidPhone('US', '')).toBe(false);
  });

  it('rejects the US 555-01xx fictional range', () => {
    // Documented so nobody "fixes" the validator after testing with 555.
    expect(isValidPhone('US', '5551234567')).toBe(false);
  });
});

describe('splitE164', () => {
  it('reads E.164 back into a country and a national number', () => {
    expect(splitE164('+12024561111')).toEqual({ country: 'US', national: '(202) 456-1111' });
    expect(splitE164('+995555123456')).toEqual({ country: 'GE', national: '555 12 34 56' });
  });

  it('reads the older no-plus form the invite modal used to write', () => {
    expect(splitE164('995555123456')).toEqual({ country: 'GE', national: '555 12 34 56' });
  });

  it('treats a bare national number as the default country', () => {
    // Genuinely ambiguous — nothing in it says which country. Showing it under
    // the default beats dropping the number.
    expect(splitE164('2024561111')).toEqual({
      country: DEFAULT_COUNTRY,
      national: '(202) 456-1111',
    });
  });

  it('survives an empty or missing value', () => {
    expect(splitE164('')).toEqual({ country: DEFAULT_COUNTRY, national: '' });
    expect(splitE164(null)).toEqual({ country: DEFAULT_COUNTRY, national: '' });
  });

  it('honours an explicit fallback country for ambiguous input', () => {
    expect(splitE164('555123456', 'GE').country).toBe('GE');
  });
});

describe('digitCount', () => {
  it('counts digits, not formatting', () => {
    expect(digitCount('(202) 456-1111')).toBe(10);
    expect(digitCount('')).toBe(0);
    expect(digitCount(null)).toBe(0);
  });
});
