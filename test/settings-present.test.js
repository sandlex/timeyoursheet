'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSettings } = require('../src/lib/settings');
const { statusText, lensTitle, tooltipMarkdown } = require('../src/lib/present');
const { parseNote } = require('../src/lib/parse');
const { computeBalance } = require('../src/lib/compute');

test('resolveSettings defaults', () => {
  const { settings, errors } = resolveSettings({});
  assert.deepEqual(settings, { workHours: [9 * 3600, 17 * 3600], lunch: [12 * 3600, 13 * 3600], workDays: [1, 2, 3, 4, 5] });
  assert.deepEqual(errors, []);
});

test('resolveSettings falls back on invalid values', () => {
  const { settings, errors } = resolveSettings({ workHours: 'nine to five', lunch: 'x', workDays: [0, 8] });
  assert.deepEqual(settings.workHours, [9 * 3600, 17 * 3600]);
  assert.deepEqual(settings.lunch, [12 * 3600, 13 * 3600]);
  assert.deepEqual(settings.workDays, [1, 2, 3, 4, 5]);
  assert.equal(errors.length, 3);
});

const { settings } = resolveSettings({});

test('statusText: no balance', () => {
  assert.match(statusText({ ok: false }, 0), /balance/);
});

test('statusText: plain, out, unbanked', () => {
  const note = '#### 2026-08-24\nbalance -45m\n';
  const plain = computeBalance(parseNote(note), settings, { date: '2026-08-24', t: 10 * 3600 });
  assert.equal(statusText(plain, 10 * 3600), '$(clock) -45m');

  const out = computeBalance(parseNote(note + '14:54 out\n'), settings, { date: '2026-08-24', t: 15 * 3600 + 17 * 60 });
  assert.equal(statusText(out, 15 * 3600 + 17 * 60), '$(debug-pause) out 23m · -1h08m');

  const done = computeBalance(parseNote(note + '18:00 out\n'), settings, { date: '2026-08-24', t: 22 * 3600 });
  assert.equal(statusText(done, 22 * 3600), '$(clock) +15m');

  const late = computeBalance(parseNote(note + '17:30 out\n20:00 in\n'), settings, { date: '2026-08-24', t: 21 * 3600 });
  assert.equal(statusText(late, 21 * 3600), '$(clock) in · -15m (+1h unbanked)');
});

test('lensTitle', () => {
  assert.equal(lensTitle({ net: -1800, adjust: 0, running: -5400 }), 'day -30m  ·  balance -1h30m');
  assert.equal(lensTitle({ net: 3600, adjust: -1800, running: 0 }), 'day +1h  ·  adjust -30m  ·  balance 0m');
});

test('tooltipMarkdown has a table of recent days, newest first', () => {
  const note = '#### 2026-08-25\n18:00 out\n#### 2026-08-24\nbalance -45m\n';
  const r = computeBalance(parseNote(note), settings, { date: '2026-08-25', t: 19 * 3600 });
  const md = tooltipMarkdown(r, 19 * 3600);
  assert.match(md, /\*\*Balance: \+15m\*\*/);
  const rows = md.split('\n').filter((l) => l.startsWith('| 2026'));
  assert.deepEqual(rows.map((l) => l.slice(2, 12)), ['2026-08-25', '2026-08-24']);
});
