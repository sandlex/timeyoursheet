'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDuration, formatDuration, parseClock, formatClock, parseRange } = require('../src/lib/duration');

test('parseDuration: hours, minutes, both', () => {
  assert.deepEqual(parseDuration('45m'), { seconds: 45 * 60, signed: false });
  assert.deepEqual(parseDuration('+2h'), { seconds: 7200, signed: true });
  assert.deepEqual(parseDuration('-2h15m'), { seconds: -(2 * 3600 + 15 * 60), signed: true });
  assert.deepEqual(parseDuration('90m'), { seconds: 5400, signed: false });
});

test('parseDuration: unicode minus', () => {
  assert.deepEqual(parseDuration('−30m'), { seconds: -1800, signed: true });
});

test('parseDuration: zero', () => {
  assert.deepEqual(parseDuration('0'), { seconds: 0, signed: false });
  assert.deepEqual(parseDuration('0m'), { seconds: 0, signed: false });
  assert.deepEqual(parseDuration('+0'), { seconds: 0, signed: true });
});

test('parseDuration: rejects garbage', () => {
  for (const bad of ['', '-', 'h', '1x', '1m2h', '1.5h', '1h 30m', 'abc', '+', '5']) {
    assert.equal(parseDuration(bad), null, bad);
  }
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(29), '0m');
  assert.equal(formatDuration(45 * 60), '+45m');
  assert.equal(formatDuration(-45 * 60), '-45m');
  assert.equal(formatDuration(2 * 3600 + 15 * 60), '+2h15m');
  assert.equal(formatDuration(-3 * 3600), '-3h');
  assert.equal(formatDuration(3 * 3600 + 5 * 60), '+3h05m');
  assert.equal(formatDuration(3600, { sign: false }), '1h');
  assert.equal(formatDuration(-578), '-10m'); // 9m38s rounds to 10m
});

test('parseClock / formatClock', () => {
  assert.equal(parseClock('14:54:09'), 14 * 3600 + 54 * 60 + 9);
  assert.equal(parseClock('9:05'), 9 * 3600 + 5 * 60);
  assert.equal(parseClock('24:00'), null);
  assert.equal(parseClock('12:60'), null);
  assert.equal(formatClock(14 * 3600 + 54 * 60 + 9, true), '14:54:09');
  assert.equal(formatClock(9 * 3600 + 5 * 60), '09:05');
});

test('parseRange', () => {
  assert.deepEqual(parseRange('09:00-17:00'), [9 * 3600, 17 * 3600]);
  assert.deepEqual(parseRange(' 9:00 - 17:30 '), [9 * 3600, 17.5 * 3600]);
  assert.equal(parseRange('17:00-09:00'), null);
  assert.equal(parseRange(''), null);
  assert.equal(parseRange('9-17'), null);
});
