import { parseInviteUrl, extractToken } from '../src/lib/inviteLink';

// The two delivery forms an invite can arrive as. If either stops resolving,
// tapping an invite link silently does nothing — no error, no screen.
describe('parseInviteUrl', () => {
  it('resolves a Universal/App Link', () => {
    expect(parseInviteUrl('https://app.gethitchlink.com/driver-register?token=ABC123'))
      .toBe('ABC123');
  });

  it('resolves the custom scheme', () => {
    expect(parseInviteUrl('hitchlinkdriver://driver-register?token=ABC123'))
      .toBe('ABC123');
  });

  it('tolerates a trailing slash on either form', () => {
    expect(parseInviteUrl('https://app.gethitchlink.com/driver-register/?token=X')).toBe('X');
    expect(parseInviteUrl('hitchlinkdriver://driver-register/?token=X')).toBe('X');
  });

  it('keeps a base64url token intact', () => {
    // Tokens are 32 random bytes base64url-encoded, so - and _ both occur and
    // must survive the round trip unescaped.
    const token = 'aB-cD_eF12345678901234567890123456789012';
    expect(parseInviteUrl(`https://app.gethitchlink.com/driver-register?token=${token}`))
      .toBe(token);
  });

  it('survives extra query params in any order', () => {
    expect(parseInviteUrl('https://app.gethitchlink.com/driver-register?utm=email&token=T9'))
      .toBe('T9');
  });

  it('ignores a link with no token', () => {
    expect(parseInviteUrl('https://app.gethitchlink.com/driver-register')).toBeNull();
  });

  it('ignores other routes on the same host', () => {
    // The Android filter is scoped to /driver-register precisely so the app
    // never offers to open the dispatcher web app's own pages.
    expect(parseInviteUrl('https://app.gethitchlink.com/login?token=ABC')).toBeNull();
    expect(parseInviteUrl('https://app.gethitchlink.com/driver-register-other?token=A')).toBeNull();
  });

  it('ignores junk', () => {
    expect(parseInviteUrl('')).toBeNull();
    expect(parseInviteUrl(null)).toBeNull();
    expect(parseInviteUrl(undefined)).toBeNull();
    expect(parseInviteUrl('not a url at all')).toBeNull();
  });
});

describe('extractToken', () => {
  it('pulls the token out of a pasted link', () => {
    expect(extractToken('  https://app.gethitchlink.com/driver-register?token=PASTED '))
      .toBe('PASTED');
  });

  it('passes a bare typed code straight through', () => {
    // The server decides whether a code is real; this only has to not mangle it.
    expect(extractToken('K7MNPQR2')).toBe('K7MNPQR2');
  });

  it('passes through an unrecognised string rather than dropping it', () => {
    expect(extractToken('https://example.com/somewhere')).toBe('https://example.com/somewhere');
  });

  it('returns empty for nothing typed', () => {
    expect(extractToken('   ')).toBe('');
    expect(extractToken(null)).toBe('');
  });
});

// ── Password reset links ────────────────────────────────────────────────────
// Same shape as an invite, different path. The router picks between them from
// one URL, so the discrimination is worth pinning down.
describe('parseDeepLink', () => {
  const { parseDeepLink } = require('../src/lib/inviteLink');

  test('reads a reset link over https', () => {
    expect(parseDeepLink('https://staging.gethitchlink.com/driver-reset?token=abc123')).toEqual({
      kind: 'reset',
      pathname: '/(auth)/driver-reset',
      token: 'abc123',
    });
  });

  test('reads a reset link over the custom scheme', () => {
    expect(parseDeepLink('hitchlinkdriver://driver-reset?token=abc123')?.kind).toBe('reset');
  });

  test('still reads an invite link', () => {
    const link = parseDeepLink('https://app.gethitchlink.com/driver-register?token=xyz');
    expect(link).toEqual({
      kind: 'invite',
      pathname: '/(auth)/driver-register',
      token: 'xyz',
    });
  });

  test('an unknown path is not a deep link', () => {
    expect(parseDeepLink('https://app.gethitchlink.com/loadboard?token=abc')).toBeNull();
  });

  test('a reset link with no token is not a deep link', () => {
    expect(parseDeepLink('https://app.gethitchlink.com/driver-reset')).toBeNull();
  });

  // parseInviteUrl feeds the invite router; a reset link must not be mistaken
  // for an invite or the driver lands on a registration form for an account
  // they already have.
  test('parseInviteUrl rejects a reset link', () => {
    expect(parseInviteUrl('https://app.gethitchlink.com/driver-reset?token=abc')).toBeNull();
  });
});
