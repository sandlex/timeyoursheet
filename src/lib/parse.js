'use strict';

const { parseDuration, parseClock } = require('./duration');

// Recognised lines (everything else in the note is ignored):
//
//   #### 2026-10-04 [anything]      date header, any heading level
//   14:54:09 out                    event: "in" or "out", seconds optional
//   balance -45m                    balance at the START of this day (explicit sign required)
//   adjust -30m [reason]            manual correction for this day (explicit sign required)
//
// Lines inside fenced code blocks (``` or ~~~) are skipped.

const HEADER_RE = /^(#{1,6})\s+(\d{4}-\d{2}-\d{2})(?!\d)/;
const EVENT_RE = /^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s+(in|out)\s*$/;
const BALANCE_RE = /^\s*balance\s+([+\-−]?\d\S*)\s*(.*)$/;
const ADJUST_RE = /^\s*adjust\s+([+\-−]?\d\S*)\s*(.*)$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

function isValidDate(s) {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function splitLines(text) {
  return String(text).split(/\r?\n/);
}

/**
 * Parse the note.
 * @returns {{
 *   days: Map<string, {date: string, headerLine: number, events: Array<{t: number, type: 'in'|'out', line: number}>,
 *                      adjusts: Array<{seconds: number, note: string, line: number}>,
 *                      balances: Array<{seconds: number, line: number}>}>,
 *   diagnostics: Array<{line: number, message: string}>,
 *   headingPrefix: string | null,
 * }}
 */
function parseNote(text) {
  const lines = splitLines(text);
  const days = new Map();
  const diagnostics = [];
  let current = null;
  let fence = null; // the fence marker char currently open, or null
  let headingPrefix = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const f = FENCE_RE.exec(line);
    if (f) {
      const ch = f[1][0];
      if (fence === null) fence = ch;
      else if (fence === ch) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const h = HEADER_RE.exec(line);
    if (h) {
      if (!isValidDate(h[2])) {
        diagnostics.push({ line: i, message: `Not a valid date: ${h[2]}` });
        continue;
      }
      if (headingPrefix === null) headingPrefix = h[1];
      current = days.get(h[2]);
      if (!current) {
        current = { date: h[2], headerLine: i, events: [], adjusts: [], balances: [] };
        days.set(h[2], current);
      }
      continue;
    }

    const e = EVENT_RE.exec(line);
    if (e) {
      const t = parseClock(e[1]);
      if (t === null) {
        diagnostics.push({ line: i, message: `Not a valid time: ${e[1]}` });
      } else if (!current) {
        diagnostics.push({ line: i, message: 'Event is not under a date header, ignored' });
      } else {
        current.events.push({ t, type: e[2], line: i });
      }
      continue;
    }

    const b = BALANCE_RE.exec(line);
    if (b) {
      const d = parseDuration(b[1]);
      if (!d || b[2]) {
        diagnostics.push({ line: i, message: 'Expected "balance <duration>", e.g. "balance -45m" or "balance +2h15m"' });
      } else if (!d.signed && d.seconds !== 0) {
        diagnostics.push({ line: i, message: 'Balance needs an explicit sign: "-" for debt, "+" for advance' });
      } else if (!current) {
        diagnostics.push({ line: i, message: 'Balance is not under a date header, ignored' });
      } else {
        current.balances.push({ seconds: d.seconds, line: i });
      }
      continue;
    }

    const a = ADJUST_RE.exec(line);
    if (a) {
      const d = parseDuration(a[1]);
      if (!d) {
        diagnostics.push({ line: i, message: 'Expected "adjust <duration> [reason]", e.g. "adjust -30m unfocused"' });
      } else if (!d.signed) {
        diagnostics.push({ line: i, message: 'Adjust needs an explicit sign, e.g. "adjust -30m" or "adjust +1h"' });
      } else if (!current) {
        diagnostics.push({ line: i, message: 'Adjust is not under a date header, ignored' });
      } else {
        current.adjusts.push({ seconds: d.seconds, note: a[2], line: i });
      }
      continue;
    }
  }

  return { days, diagnostics, headingPrefix };
}

module.exports = { parseNote, splitLines, isValidDate, HEADER_RE, FENCE_RE };
