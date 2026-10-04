'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNote } = require('../src/lib/parse');

const NOTE = `# Scratch

some text before any day
10:00 out

#### 2026-10-02 Friday
balance -45m
09:12 standup notes
14:54:09 out
15:32:04 in
adjust -30m unfocused afternoon
\`\`\`
16:00 out
balance +5h
\`\`\`

#### 2026-10-01
11:10:51 out
14:40:08 in
`;

test('parses headers, events, balance, adjust', () => {
  const { days } = parseNote(NOTE);
  assert.deepEqual([...days.keys()], ['2026-10-02', '2026-10-01']);

  const d = days.get('2026-10-02');
  assert.equal(d.headerLine, 5);
  assert.deepEqual(d.balances, [{ seconds: -45 * 60, line: 6 }]);
  assert.deepEqual(d.events.map((e) => [e.t, e.type]), [
    [14 * 3600 + 54 * 60 + 9, 'out'],
    [15 * 3600 + 32 * 60 + 4, 'in'],
  ]);
  assert.deepEqual(d.adjusts, [{ seconds: -1800, note: 'unfocused afternoon', line: 10 }]);
});

test('ignores lines inside code fences', () => {
  const { days } = parseNote(NOTE);
  const d = days.get('2026-10-02');
  assert.equal(d.events.length, 2);
  assert.equal(d.balances.length, 1);
});

test('event before any header is reported, not counted', () => {
  const { diagnostics } = parseNote(NOTE);
  assert.ok(diagnostics.some((x) => x.line === 3 && /not under a date header/.test(x.message)));
});

test('prose that merely starts with a time or keyword is not an event', () => {
  const { days, diagnostics } = parseNote('#### 2026-10-02\n10:00 in the meeting\n14:00 standup\nbalance sheet review\nadjusting things\n');
  const d = days.get('2026-10-02');
  assert.equal(d.events.length, 0);
  assert.equal(d.balances.length, 0);
  assert.equal(diagnostics.length, 0);
});

test('balance and adjust require an explicit sign', () => {
  const { days, diagnostics } = parseNote('#### 2026-10-02\nbalance 45m\nadjust 30m\nbalance 0\n');
  const d = days.get('2026-10-02');
  assert.deepEqual(d.balances, [{ seconds: 0, line: 3 }]);
  assert.equal(d.adjusts.length, 0);
  assert.equal(diagnostics.length, 2);
});

test('malformed balance is reported', () => {
  const { diagnostics } = parseNote('#### 2026-10-02\nbalance -45x\nbalance -45m extra\n');
  assert.equal(diagnostics.length, 2);
});

test('any heading level, CRLF line endings', () => {
  const { days, headingPrefix } = parseNote('## 2026-10-02\r\n10:00 out\r\n');
  assert.equal(headingPrefix, '##');
  assert.equal(days.get('2026-10-02').events.length, 1);
});

test('invalid date header is reported', () => {
  const { days, diagnostics } = parseNote('#### 2026-02-30\n10:00 out\n');
  assert.equal(days.size, 0);
  assert.equal(diagnostics.length, 2); // bad date + orphan event
});

test('duplicate date headers are merged', () => {
  const { days } = parseNote('#### 2026-10-02\n10:00 out\n#### 2026-10-02\n11:00 in\n');
  assert.equal(days.get('2026-10-02').events.length, 2);
});
