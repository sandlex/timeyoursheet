'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNote } = require('../src/lib/parse');
const { computeBalance, computeDay } = require('../src/lib/compute');
const { resolveSettings } = require('../src/lib/settings');

const { settings } = resolveSettings({});
const H = 3600;
const M = 60;
const t = (hh, mm = 0, ss = 0) => hh * H + mm * M + ss;

// 2026-08-24 is a Monday, 2026-08-29 a Saturday.
function day(date, lines) {
  return parseNote(`#### ${date}\n${lines.join('\n')}\n`).days.get(date);
}
const past = { isToday: false, now: 0 };

test('workday with no events is exactly neutral', () => {
  const r = computeDay(day('2026-08-24', []), settings, past);
  assert.equal(r.worked, 7 * H);
  assert.equal(r.expected, 7 * H);
  assert.equal(r.net, 0);
});

test('the 2026-08-24 example from the old note: out/in/out/in(evening)/out', () => {
  const r = computeDay(
    day('2026-08-24', ['14:54:09 out', '15:32:04 in', '16:23:45 out', '20:20:20 in', '21:24:52 out']),
    settings,
    past,
  );
  // debt 37:55 + 36:15, advance 1:04:32 -> -9:38
  assert.equal(r.net, -(9 * M + 38));
});

test('out during lunch costs nothing; overrunning lunch costs the overrun', () => {
  assert.equal(computeDay(day('2026-08-24', ['12:05 out', '12:55 in']), settings, past).net, 0);
  assert.equal(computeDay(day('2026-08-24', ['12:10 out', '13:30 in']), settings, past).net, -30 * M);
});

test('working through lunch earns nothing', () => {
  // in early, out late, never left: lunch still excluded
  const r = computeDay(day('2026-08-24', ['08:00 in', '18:00 out']), settings, past);
  assert.equal(r.net, 2 * H);
});

test('early start: first event "in" before work hours', () => {
  assert.equal(computeDay(day('2026-08-24', ['08:15 in']), settings, past).net, 45 * M);
});

test('late start: first event "in" during work hours', () => {
  assert.equal(computeDay(day('2026-08-24', ['09:40 in']), settings, past).net, -40 * M);
});

test('working late: single "out" after hours', () => {
  assert.equal(computeDay(day('2026-08-24', ['18:30 out']), settings, past).net, 90 * M);
});

test('leaving early with no return', () => {
  assert.equal(computeDay(day('2026-08-24', ['15:00 out']), settings, past).net, -2 * H);
});

test('trailing "in" after hours without "out" earns nothing on a past day', () => {
  const r = computeDay(day('2026-08-24', ['17:30 out', '20:00 in']), settings, past);
  assert.equal(r.net, 30 * M);
});

test('adjust is added to the day', () => {
  const r = computeDay(day('2026-08-24', ['adjust -30m slow day', 'adjust +1h']), settings, past);
  assert.equal(r.net, 30 * M);
});

test('weekend: only explicit pairs count, all as advance, no lunch exclusion', () => {
  const r = computeDay(day('2026-08-29', ['11:30 in', '13:30 out']), settings, past);
  assert.equal(r.workday, false);
  assert.equal(r.expected, 0);
  assert.equal(r.net, 2 * H);
  assert.equal(computeDay(day('2026-08-29', []), settings, past).net, 0);
  assert.equal(computeDay(day('2026-08-29', ['10:00 in']), settings, past).net, 0);
});

test('repeated state is ignored and reported', () => {
  const r = computeDay(day('2026-08-24', ['14:00 out', '14:30 out', '15:00 in']), settings, past);
  assert.equal(r.net, -H);
  assert.equal(r.diagnostics.length, 1);
  assert.match(r.diagnostics[0].message, /Already out/);
});

test('events are sorted by time even if written out of order', () => {
  const r = computeDay(day('2026-08-24', ['15:00 in', '14:00 out']), settings, past);
  assert.equal(r.net, -H);
});

test('lunch can be disabled', () => {
  const s = resolveSettings({ lunch: '' }).settings;
  const r = computeDay(day('2026-08-24', ['12:00 out', '13:00 in']), s, past);
  assert.equal(r.expected, 8 * H);
  assert.equal(r.net, -H);
});

// ---- today (live) ----

test('today, currently out: debt grows until now, rest of day assumed worked', () => {
  const r = computeDay(day('2026-08-24', ['14:54 out']), settings, { isToday: true, now: t(15, 4) });
  assert.equal(r.net, -10 * M);
  assert.deepEqual(r.current, { state: 'out', since: t(14, 54), explicit: true, accruing: true });
});

test('today, out after hours: no further debt accrues', () => {
  const r = computeDay(day('2026-08-24', ['16:00 out']), settings, { isToday: true, now: t(19) });
  assert.equal(r.net, -H);
  assert.equal(r.current.accruing, false);
});

test('today, early morning before any event: neutral, state off', () => {
  const r = computeDay(day('2026-08-24', []), settings, { isToday: true, now: t(7) });
  assert.equal(r.net, 0);
  assert.deepEqual(r.current, { state: 'off', since: null, explicit: false });
});

test('today, during work hours with no events: implicitly in', () => {
  const r = computeDay(day('2026-08-24', []), settings, { isToday: true, now: t(10) });
  assert.equal(r.net, 0);
  assert.deepEqual(r.current, { state: 'in', since: t(9), explicit: false });
});

test('today, in after hours: pending time is reported but not counted', () => {
  const r = computeDay(day('2026-08-24', ['17:30 out', '20:00 in']), settings, { isToday: true, now: t(21) });
  assert.equal(r.net, 30 * M);
  assert.equal(r.pending, H);
});

test('today, in since early morning, still before end of day: projected', () => {
  const r = computeDay(day('2026-08-24', ['08:00 in']), settings, { isToday: true, now: t(10) });
  assert.equal(r.net, H);
  assert.equal(r.pending, 0);
});

// ---- whole-note balance ----

const NOTE = `#### 2026-08-26
14:00 out
15:00 in

#### 2026-08-25
adjust -30m
18:00 out

#### 2026-08-24
balance -45m
14:54:09 out
15:32:04 in

#### 2026-08-21
balance +10h
12:00 out
`;

test('balance starts at the latest balance line and accumulates', () => {
  const r = computeBalance(parseNote(NOTE), settings, { date: '2026-08-26', t: t(16) });
  assert.equal(r.ok, true);
  assert.equal(r.startDate, '2026-08-24');
  assert.deepEqual(
    r.days.map((d) => [d.date, d.net]),
    [
      ['2026-08-24', -(37 * M + 55)],
      ['2026-08-25', 30 * M],
      ['2026-08-26', -H],
    ],
  );
  assert.equal(r.total, -45 * M - (37 * M + 55) + 30 * M - H);
  assert.equal(r.days[2].running, r.total);
});

test('days after "today" are ignored', () => {
  const r = computeBalance(parseNote(NOTE), settings, { date: '2026-08-24', t: t(18) });
  assert.equal(r.days.length, 1);
  assert.equal(r.total, -45 * M - (37 * M + 55));
});

test('no balance line -> not ok', () => {
  const r = computeBalance(parseNote('#### 2026-08-24\n10:00 out\n'), settings, { date: '2026-08-24', t: t(12) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-balance');
});

test('balance line in the future is ignored', () => {
  const note = '#### 2026-08-25\nbalance +1h\n#### 2026-08-24\nbalance -1h\n';
  const r = computeBalance(parseNote(note), settings, { date: '2026-08-24', t: t(12) });
  assert.equal(r.total, -H);
});

test('two balance lines on the same day: last wins, first is reported', () => {
  const note = '#### 2026-08-24\nbalance +1h\nbalance -2h\n';
  const r = computeBalance(parseNote(note), settings, { date: '2026-08-24', t: t(12) });
  assert.equal(r.total, -2 * H);
  assert.equal(r.diagnostics.length, 1);
});

test('today without a section still produces a today entry', () => {
  const r = computeBalance(parseNote('#### 2026-08-24\nbalance -1h\n'), settings, { date: '2026-08-25', t: t(10) });
  assert.equal(r.total, -H);
  assert.equal(r.today.date, '2026-08-25');
  assert.equal(r.today.current.state, 'in');
});

test('today, normal day with no lines, evening: nothing unbanked', () => {
  const r = computeDay(day('2026-08-24', []), settings, { isToday: true, now: t(19) });
  assert.equal(r.net, 0);
  assert.equal(r.pending, 0);
  const afterOut = computeDay(day('2026-08-24', ['16:30 out']), settings, { isToday: true, now: t(19) });
  assert.equal(afterOut.pending, 0);
});

test('left early, came back in the evening: out stops costing at 17:00, evening work offsets it', () => {
  const lines = ['11:45 in', '16:30 out'];
  assert.equal(computeDay(day('2026-08-24', lines), settings, past).net, -(3 * H + 15 * M));
  const evening = computeDay(day('2026-08-24', [...lines, '20:00 in', '21:00 out']), settings, past);
  assert.equal(evening.net, -(2 * H + 15 * M));
});

test('the next work day with no lines leaves the balance unchanged', () => {
  const note = '#### 2026-08-24\nbalance -2h15m\n11:45:00 in\n16:30:00 out\n';
  for (const now of [t(10), t(18)]) {
    const r = computeBalance(parseNote(note), settings, { date: '2026-08-25', t: now });
    assert.equal(r.total, -(5 * H + 30 * M));
    assert.equal(r.today.pending, 0);
  }
});
