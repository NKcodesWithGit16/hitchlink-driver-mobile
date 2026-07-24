// Turns a flat message list into the rows the thread actually renders:
// messages interleaved with day separators.
//
// The screen used to render exactly one hardcoded "Today" separator at the top
// of the entire thread, no matter how old the messages under it were — a
// conversation spanning a week claimed every message in it happened today.
//
// This also produces the flat, keyed array a virtualized list needs, which is
// why grouping metadata (prevFrom/nextFrom, used for avatar placement and
// bubble spacing) is resolved here instead of by index-peeking during render.
//
// Pure — no React — so it runs under Jest.

/** Local-midnight timestamp for a date, used as the day bucket key. */
function dayKey(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Resolve a message's date. Optimistic local messages (id 'local-…') carry no
 * raw `ts` yet — they were created just now, so they belong to today.
 */
function messageDate(m) {
  if (m?.ts) {
    const d = new Date(m.ts);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

/**
 * @param {Array} items messages, oldest-first
 * @param {(dayKey: number, date: Date) => string} labelFor renders a separator
 *   label (caller owns i18n + "Today"/"Yesterday" wording)
 * @returns {Array} rows of { type: 'sep' | 'msg', key, ... }
 */
export function buildChatRows(items, labelFor) {
  const list = Array.isArray(items) ? items : [];
  const rows = [];
  let lastDay = null;

  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!m) continue;

    const date = messageDate(m);
    const key = dayKey(date);
    if (key !== lastDay) {
      rows.push({ type: 'sep', key: `sep-${key}`, label: labelFor(key, date) });
      lastDay = key;
    }

    // Grouping is per-day: the last message of one day and the first of the
    // next are never visually grouped, even when they're from the same sender,
    // because a separator now sits between them.
    const prev = list[i - 1];
    const next = list[i + 1];
    const prevSameDay = prev && dayKey(messageDate(prev)) === key;
    const nextSameDay = next && dayKey(messageDate(next)) === key;

    rows.push({
      type: 'msg',
      key: String(m.id),
      msg: m,
      prevFrom: prevSameDay ? prev.from : null,
      nextFrom: nextSameDay ? next.from : null,
    });
  }

  return rows;
}

/**
 * Day-separator label. Today/Yesterday get words; anything older gets a date.
 * Callers pass translated strings so this stays language-agnostic.
 */
export function dayLabel(key, date, { today, yesterday, months }) {
  const now = new Date();
  const todayKey = dayKey(now);
  const oneDay = 86400000;

  if (key === todayKey) return today;
  if (key === todayKey - oneDay) return yesterday;

  const m = Array.isArray(months) ? months[date.getMonth()] : date.getMonth() + 1;
  // Include the year only once the conversation crosses into another one —
  // "Mar 3" reads better than "Mar 3, 2026" for anything this year.
  return date.getFullYear() === now.getFullYear()
    ? `${m} ${date.getDate()}`
    : `${m} ${date.getDate()}, ${date.getFullYear()}`;
}
