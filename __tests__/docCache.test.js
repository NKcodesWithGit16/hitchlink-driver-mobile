// The policy half of lib/docCache — what gets kept on the phone, when it goes
// stale, what gets dropped to stay under budget, and what order the list shows
// in. The storage half needs a filesystem, so both of docCache's own imports
// are stubbed here; these functions are pure and don't touch either.
jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }));
jest.mock('../src/api/main', () => ({
  fetchDocuments: jest.fn(), fetchDocumentContent: jest.fn(), fetchDocumentThumbnail: jest.fn(),
}));

import {
  shouldAutoCache, isStale, evictionPlan, sortDocuments, isCredential,
  AUTO_CACHE_SIZE_CAP,
} from '../src/lib/docCache';

const MB = 1024 * 1024;
const doc = (over = {}) => ({
  id: 'd1', type: 'Other', hasContent: true, sizeBytes: MB,
  lastModifiedAt: '2026-07-01T00:00:00Z', createdAt: '2026-07-01T00:00:00Z',
  expires: null, ...over,
});

// Relative to the real current date, since expiryStatus/daysUntil compare
// against today. Same approach as the other date-sensitive suites.
const inDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('shouldAutoCache', () => {
  test('credentials are kept whatever their size', () => {
    for (const type of ['License', 'MedicalCard', 'Insurance', 'Registration', 'Inspection']) {
      expect(shouldAutoCache(doc({ type, sizeBytes: 90 * MB }))).toBe(true);
    }
  });

  test('other documents are kept only when small', () => {
    expect(shouldAutoCache(doc({ sizeBytes: 2 * MB }))).toBe(true);
    expect(shouldAutoCache(doc({ sizeBytes: AUTO_CACHE_SIZE_CAP + 1 }))).toBe(false);
  });

  test('an unknown size is not treated as under the cap', () => {
    expect(shouldAutoCache(doc({ sizeBytes: null }))).toBe(false);
    expect(shouldAutoCache(doc({ sizeBytes: 0 }))).toBe(false);
  });

  test('a url-only document has nothing to download', () => {
    // /content would 404 — these live at an external link, not in the database.
    expect(shouldAutoCache(doc({ hasContent: false }))).toBe(false);
    expect(shouldAutoCache(doc({ type: 'License', hasContent: false }))).toBe(false);
  });

  test('junk in, false out', () => {
    expect(shouldAutoCache(null)).toBe(false);
    expect(shouldAutoCache({})).toBe(false);
  });
});

describe('isStale', () => {
  test('nothing cached is stale', () => {
    expect(isStale(doc(), undefined)).toBe(true);
    expect(isStale(doc(), {})).toBe(true);
  });

  test('matching lastModifiedAt is fresh, a different one is stale', () => {
    const entry = { path: 'file:///x', lastModifiedAt: '2026-07-01T00:00:00Z' };
    expect(isStale(doc(), entry)).toBe(false);
    expect(isStale(doc({ lastModifiedAt: '2026-07-09T00:00:00Z' }), entry)).toBe(true);
  });

  test('a document with no lastModifiedAt keeps what is on disk', () => {
    // Re-downloading every document on every visit would be worse than showing
    // one that may be a revision behind.
    const entry = { path: 'file:///x', lastModifiedAt: null };
    expect(isStale(doc({ lastModifiedAt: null }), entry)).toBe(false);
  });
});

describe('evictionPlan', () => {
  const entry = (over = {}) => ({ path: 'file:///x', sizeBytes: 10 * MB, cachedAt: 1, openedAt: 1, ...over });

  test('drops documents that are no longer in the list', () => {
    const manifest = { d1: entry(), gone: entry() };
    expect(evictionPlan(manifest, [doc({ id: 'd1' })], 500 * MB)).toEqual(['gone']);
  });

  test('keeps everything when under budget', () => {
    const manifest = { d1: entry(), d2: entry() };
    const docs = [doc({ id: 'd1' }), doc({ id: 'd2' })];
    expect(evictionPlan(manifest, docs, 500 * MB)).toEqual([]);
  });

  test('drops least-recently-opened first when over budget', () => {
    const manifest = {
      d1: entry({ openedAt: 300 }),
      d2: entry({ openedAt: 100 }),
      d3: entry({ openedAt: 200 }),
    };
    const docs = [doc({ id: 'd1' }), doc({ id: 'd2' }), doc({ id: 'd3' })];
    // 30 MB cached, 15 MB of room — the two oldest have to go.
    expect(evictionPlan(manifest, docs, 15 * MB)).toEqual(['d2', 'd3']);
  });

  test('never evicts a credential to free space', () => {
    const manifest = { cdl: entry({ openedAt: 1 }), other: entry({ openedAt: 999 }) };
    const docs = [doc({ id: 'cdl', type: 'License' }), doc({ id: 'other' })];
    // The CDL is the oldest by access, and is exactly what must survive.
    expect(evictionPlan(manifest, docs, 5 * MB)).toEqual(['other']);
  });
});

describe('sortDocuments', () => {
  test('expired first, then expiring soonest, then valid', () => {
    const list = [
      doc({ id: 'valid',    expires: inDays(300) }),
      doc({ id: 'expiring', expires: inDays(20) }),
      doc({ id: 'expired',  expires: inDays(-5) }),
      doc({ id: 'sooner',   expires: inDays(3) }),
    ];
    expect(sortDocuments(list).map(d => d.id)).toEqual(['expired', 'sooner', 'expiring', 'valid']);
  });

  test('credentials lead the valid documents, in inspection order', () => {
    const list = [
      doc({ id: 'other',   type: 'Other' }),
      doc({ id: 'ins',     type: 'Insurance' }),
      doc({ id: 'cdl',     type: 'License' }),
      doc({ id: 'medical', type: 'MedicalCard' }),
    ];
    expect(sortDocuments(list).map(d => d.id)).toEqual(['cdl', 'medical', 'ins', 'other']);
  });

  test('ties break on newest uploaded', () => {
    const list = [
      doc({ id: 'old', createdAt: '2026-01-01T00:00:00Z' }),
      doc({ id: 'new', createdAt: '2026-07-01T00:00:00Z' }),
    ];
    expect(sortDocuments(list).map(d => d.id)).toEqual(['new', 'old']);
  });

  test('does not mutate its input', () => {
    const list = [doc({ id: 'a', type: 'Other' }), doc({ id: 'b', type: 'License' })];
    sortDocuments(list);
    expect(list.map(d => d.id)).toEqual(['a', 'b']);
  });

  test('survives empty and missing input', () => {
    expect(sortDocuments([])).toEqual([]);
    expect(sortDocuments(undefined)).toEqual([]);
  });
});

test('isCredential covers exactly the DOT-required set', () => {
  expect(isCredential({ type: 'License' })).toBe(true);
  expect(isCredential({ type: 'Other' })).toBe(false);
  expect(isCredential(null)).toBe(false);
});
