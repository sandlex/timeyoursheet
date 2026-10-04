'use strict';

// Durations are kept in whole seconds internally.
// Text form: optional sign, then "XhYm", "Xh", "Ym" or "0", e.g. "+2h15m", "-45m", "90m".
// Both ASCII "-" and the Unicode minus "−" are accepted as a sign.

const DURATION_RE = /^([+\-−])?(?:(\d+)h)?(?:(\d+)m)?$/;

/**
 * Parse a duration token.
 * @returns {{seconds: number, signed: boolean} | null}
 */
function parseDuration(token) {
  if (typeof token !== 'string') return null;
  const t = token.trim();
  if (t === '0' || t === '+0' || t === '-0' || t === '−0') {
    return { seconds: 0, signed: t !== '0' };
  }
  const m = DURATION_RE.exec(t);
  if (!m || (m[2] === undefined && m[3] === undefined)) return null;
  const minutes = Number(m[2] || 0) * 60 + Number(m[3] || 0);
  const sign = m[1] === '-' || m[1] === '−' ? -1 : 1;
  return { seconds: sign * minutes * 60, signed: m[1] !== undefined };
}

/**
 * Format seconds as "+2h15m" / "-45m" / "0m". Rounds to the nearest minute.
 * @param {number} seconds
 * @param {{sign?: boolean}} [opts] sign: prefix positive values with "+" (default true)
 */
function formatDuration(seconds, opts = {}) {
  const withSign = opts.sign !== false;
  const totalMin = Math.round(Math.abs(seconds) / 60);
  if (totalMin === 0) return '0m';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const body = h ? `${h}h` + (m ? `${String(m).padStart(2, '0')}m` : '') : `${m}m`;
  if (seconds < 0) return `-${body}`;
  return withSign ? `+${body}` : body;
}

/** "HH:MM[:SS]" -> seconds since midnight, or null. */
function parseClock(text) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(text).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(m[3] || 0);
  if (h > 23 || min > 59 || s > 59) return null;
  return h * 3600 + min * 60 + s;
}

/** seconds since midnight -> "HH:MM" or "HH:MM:SS" */
function formatClock(seconds, withSeconds = false) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return withSeconds ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}`;
}

/** "09:00-17:00" -> [start, end] seconds, or null. Empty string -> null. */
function parseRange(text) {
  if (!text) return null;
  const parts = String(text).split('-');
  if (parts.length !== 2) return null;
  const a = parseClock(parts[0]);
  const b = parseClock(parts[1]);
  if (a === null || b === null || b <= a) return null;
  return [a, b];
}

module.exports = { parseDuration, formatDuration, parseClock, formatClock, parseRange };
