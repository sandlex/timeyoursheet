'use strict';

const { HEADER_RE, FENCE_RE } = require('./parse');

/**
 * Work out where to insert a line into today's section of the note.
 * Pure: returns an insertion {offset, text}; the caller applies it.
 *
 * - If a section for `date` exists, the line goes right after its last non-blank line.
 * - Otherwise a new section is created: before the first date header when
 *   newDaysOnTop is true (newest-first notes), else at the end of the file.
 *
 * @param {string} doc full note text
 * @param {{date: string, line: string, headingPrefix?: string, newDaysOnTop?: boolean}} opts
 * @returns {{offset: number, text: string}}
 */
function planInsert(doc, opts) {
  const eol = doc.includes('\r\n') ? '\r\n' : '\n';
  const lines = doc.split(/\r?\n/);

  // Offsets of the start of each line.
  const starts = [];
  let pos = 0;
  for (const l of lines) {
    starts.push(pos);
    pos += l.length;
    const next = doc.slice(pos, pos + 2);
    pos += next.startsWith('\r\n') ? 2 : next.startsWith('\n') ? 1 : 0;
  }

  // Date headers outside code fences.
  const headers = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const f = FENCE_RE.exec(lines[i]);
    if (f) {
      const ch = f[1][0];
      if (fence === null) fence = ch;
      else if (fence === ch) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = HEADER_RE.exec(lines[i]);
    if (h) headers.push({ line: i, prefix: h[1], date: h[2] });
  }

  const endOfLine = (i) => starts[i] + lines[i].length;

  const idx = headers.findIndex((h) => h.date === opts.date);
  if (idx !== -1) {
    const h = headers[idx];
    const end = idx + 1 < headers.length ? headers[idx + 1].line : lines.length;
    let last = h.line;
    for (let i = h.line + 1; i < end; i++) {
      if (lines[i].trim() !== '') last = i;
    }
    return { offset: endOfLine(last), text: eol + opts.line };
  }

  const prefix = (headers[0] && headers[0].prefix) || opts.headingPrefix || '####';
  const section = `${prefix} ${opts.date}${eol}${opts.line}`;
  const newDaysOnTop = opts.newDaysOnTop !== false;

  if (newDaysOnTop && headers.length) {
    return { offset: starts[headers[0].line], text: section + eol + eol };
  }

  // Append at the end of the file, separated by a blank line.
  const trimmed = doc.replace(/\s+$/, '');
  if (trimmed === '') return { offset: 0, text: section + eol };
  const trailing = doc.slice(trimmed.length);
  const neededBreaks = Math.max(0, 2 - (trailing.split(/\r?\n/).length - 1));
  return { offset: doc.length, text: eol.repeat(neededBreaks) + section + eol };
}

/** Apply a planned insertion to a string (used by tests and the file fallback). */
function applyInsert(doc, plan) {
  return doc.slice(0, plan.offset) + plan.text + doc.slice(plan.offset);
}

/**
 * What the toggle command should log next, given today's computed state.
 * @param {{state: 'in'|'out'|'off'} | null} current
 */
function nextToggle(current) {
  if (!current) return 'in';
  return current.state === 'in' ? 'out' : 'in';
}

module.exports = { planInsert, applyInsert, nextToggle };
