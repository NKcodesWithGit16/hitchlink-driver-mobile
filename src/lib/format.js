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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// Days from "today" until an ISO date (negative = past).
export function daysUntil(iso, today = new Date('2026-06-05T00:00:00')) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return null;
  return Math.round((d - today) / 86400000);
}

// Document validity state derived from its expiry date.
export function expiryStatus(iso) {
  const days = daysUntil(iso);
  if (days == null) return { key: 'valid', label: 'Valid', tone: 'go', days };
  if (days < 0) return { key: 'expired', label: 'Expired', tone: 'danger', days };
  if (days <= 30) return { key: 'expiring', label: `${days}d left`, tone: 'caution', days };
  return { key: 'valid', label: 'Valid', tone: 'go', days };
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
