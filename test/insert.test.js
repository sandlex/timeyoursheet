'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planInsert, applyInsert, nextToggle } = require('../src/lib/insert');

const ins = (doc, opts) => applyInsert(doc, planInsert(doc, opts));

test('appends to the end of an existing section, after the last non-blank line', () => {
  const doc = '#### 2026-10-04\n14:00 out\nsome note\n\n\n#### 2026-10-03\n10:00 out\n';
  assert.equal(
    ins(doc, { date: '2026-10-04', line: '14:30:00 in' }),
    '#### 2026-10-04\n14:00 out\nsome note\n14:30:00 in\n\n\n#### 2026-10-03\n10:00 out\n',
  );
});

test('appends to the last section in the file without a trailing newline', () => {
  const doc = '#### 2026-10-04\n14:00 out';
  assert.equal(ins(doc, { date: '2026-10-04', line: '15:00 in' }), '#### 2026-10-04\n14:00 out\n15:00 in');
});

test('header-only section', () => {
  const doc = '#### 2026-10-04\n\n#### 2026-10-03\n';
  assert.equal(ins(doc, { date: '2026-10-04', line: '15:00 in' }), '#### 2026-10-04\n15:00 in\n\n#### 2026-10-03\n');
});

test('new day goes on top, reusing the existing heading level', () => {
  const doc = 'pinned stuff\n\n### 2026-10-03\n10:00 out\n';
  assert.equal(
    ins(doc, { date: '2026-10-04', line: '08:00 in' }),
    'pinned stuff\n\n### 2026-10-04\n08:00 in\n\n### 2026-10-03\n10:00 out\n',
  );
});

test('new day at the bottom when newDaysOnTop is false', () => {
  const doc = '#### 2026-10-03\n10:00 out\n';
  assert.equal(
    ins(doc, { date: '2026-10-04', line: '08:00 in', newDaysOnTop: false }),
    '#### 2026-10-03\n10:00 out\n\n#### 2026-10-04\n08:00 in\n',
  );
});

test('empty file and file without any date header', () => {
  assert.equal(ins('', { date: '2026-10-04', line: '08:00 in' }), '#### 2026-10-04\n08:00 in\n');
  assert.equal(
    ins('just notes', { date: '2026-10-04', line: '08:00 in', headingPrefix: '##' }),
    'just notes\n\n## 2026-10-04\n08:00 in\n',
  );
});

test('date headers inside code fences are not used', () => {
  const doc = '```\n#### 2026-10-04\n```\n#### 2026-10-03\n';
  assert.equal(
    ins(doc, { date: '2026-10-04', line: '08:00 in' }),
    '```\n#### 2026-10-04\n```\n#### 2026-10-04\n08:00 in\n\n#### 2026-10-03\n',
  );
});

test('CRLF files stay CRLF', () => {
  const doc = '#### 2026-10-04\r\n14:00 out\r\n\r\n#### 2026-10-03\r\n';
  assert.equal(
    ins(doc, { date: '2026-10-04', line: '15:00 in' }),
    '#### 2026-10-04\r\n14:00 out\r\n15:00 in\r\n\r\n#### 2026-10-03\r\n',
  );
});

test('nextToggle', () => {
  assert.equal(nextToggle(null), 'in');
  assert.equal(nextToggle({ state: 'in' }), 'out');
  assert.equal(nextToggle({ state: 'out' }), 'in');
  assert.equal(nextToggle({ state: 'off' }), 'in');
});
