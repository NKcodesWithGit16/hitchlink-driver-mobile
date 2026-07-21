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

// Days from "today" until an ISO date (negative = past).
export function daysUntil(iso, today = new Date('2026-06-05T00:00:00')) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return null;
  return Math.round((d - today) / 86400000);
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

// Minutes → "6h 12m"
export function hm(mins) {
  if (mins == null || isNaN(mins)) return '—';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
