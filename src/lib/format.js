// Small formatting helpers. Today is treated as 2026-06-05 for demo dates.

export function money(n, { cents = false } = {}) {
  if (n == null || isNaN(n)) return '$0';
  const v = cents ? Number(n).toFixed(2) : Math.round(Number(n));
  return '$' + Number(v).toLocaleString('en-US', cents ? { minimumFractionDigits: 2 } : {});
}

export function num(n) {
  if (n == null || isNaN(n)) return '0';
  return Math.round(Number(n)).toLocaleString('en-US');
}

export function rpm(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(2);
}

const KM_PER_MILE = 1.60934;

// Every stored distance (load.miles, the GPS odometer buckets, loadStats
// output) is true miles — this is the one place that converts for display.
export function toDistance(miles, unit) {
  const n = Number(miles);
  if (!isFinite(n)) return 0;
  return unit === 'km' ? n * KM_PER_MILE : n;
}

export function distNum(miles, unit) {
  if (miles == null || isNaN(miles)) return num(miles);
  return num(toDistance(miles, unit));
}

// Rate-per-mile figures ($/mi) convert the opposite direction from a plain
// distance: a mile is the LONGER unit, so the same dollar spreads over fewer
// km — divide, don't multiply. rpm() callers always store true $/mile;
// this is the one place that converts one for display.
export function toRatePerDistance(ratePerMile, unit) {
  const n = Number(ratePerMile);
  if (!isFinite(n)) return 0;
  return unit === 'km' ? n / KM_PER_MILE : n;
}

export function distRpm(ratePerMile, unit) {
  if (ratePerMile == null || isNaN(ratePerMile)) return rpm(ratePerMile);
  return rpm(toRatePerDistance(ratePerMile, unit));
}

// Signed whole number for a delta chip, e.g. +11 / −4 / 0. Uses a real minus
// glyph (−) so it lines up with tabular figures instead of a skinny hyphen.
export function signedNum(n) {
  if (n == null || isNaN(n)) return '—';
  const v = Math.round(Number(n));
  if (v === 0) return '0';
  return (v > 0 ? '+' : '−') + Math.abs(v).toLocaleString('en-US');
}

// English fallback — callers that care about localization pass the current
// language's months (e.g. t('common.monthsShort')) as the second argument.
const DEFAULT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso, months = DEFAULT_MONTHS) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// Days from "today" until an ISO date (negative = past). `today` defaults to
// the real current date — it is injectable ONLY so tests can pin it. It used
// to default to a fixed demo date (2026-06-05), which silently leaked into
// live mode: expiryStatus() below feeds the Documents screen's valid /
// expiring / expired classification, so a real CDL or medical card that had
// already lapsed still rendered as "Valid". Compare against midnight local so
// a document expiring today reads as 0 days left, not a fractional negative.
export function daysUntil(iso, today = startOfToday()) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return null;
  return Math.round((d - today) / 86400000);
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Document validity state derived from its expiry date. Returns a labelKey
// (+ labelParams for the interpolated "expiring" case) instead of a literal
// string so callers translate it via t(labelKey, labelParams).
export function expiryStatus(iso) {
  const days = daysUntil(iso);
  if (days == null) return { key: 'valid', labelKey: 'documents.statusValid', labelParams: null, tone: 'go', days };
  if (days < 0) return { key: 'expired', labelKey: 'documents.statusExpired', labelParams: null, tone: 'danger', days };
  if (days <= 30) return { key: 'expiring', labelKey: 'documents.statusExpiringDays', labelParams: { days }, tone: 'caution', days };
  return { key: 'valid', labelKey: 'documents.statusValid', labelParams: null, tone: 'go', days };
}

// Minutes-ago → compact relative label for notification timestamps.
// "now" · "5m" · "3h" · "Yesterday" · "4d" — the m/h/d unit letters stay as
// plain numerals+Latin-letter units (same treatment as the app's other
// compact abbreviations); only the two full words are translated.
export function relativeMinutes(mins, t) {
  if (mins == null || isNaN(mins)) return '';
  if (mins < 1) return t ? t('common.now') : 'now';
  if (mins < 60) return `${Math.round(mins)}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  if (mins < 2880) return t ? t('common.yesterday') : 'Yesterday';
  return `${Math.floor(mins / 1440)}d`;
}

// Bytes → "2.4 MB". Returns null (not "0 B") when the size is unknown, so a
// caller can drop the whole badge rather than print a size that isn't true —
// SizeBytes is nullable on the documents payload.
export function fileSize(bytes) {
  const n = Number(bytes);
  if (!isFinite(n) || n <= 0) return null;
  if (n < 1024) return `${Math.round(n)} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

// Minutes → "6h 12m"
export function hm(mins) {
  if (mins == null || isNaN(mins)) return '—';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
