'use strict';
// Sample note used for the README screenshots. Fictional week, newest day on top.
// `variant` picks how far Friday has progressed.
function sampleNote(variant) {
  const friday = {
    out: ['- [x] review PR #482', '- [ ] release notes for 2.4', '', '14:54:09 out'],
    evening: ['- [x] review PR #482', '- [x] release notes for 2.4', '', '14:54:09 out', '15:32:04 in', '18:05:12 out'],
  }[variant];
  return [
    '#### 2026-10-02',
    ...friday,
    '',
    '#### 2026-10-01',
    'deploy window moved to the evening',
    '20:18:40 in',
    '22:34:05 out',
    '',
    '#### 2026-09-30',
    '08:12:40 in',
    '```js',
    'const total = items.reduce((s, i) => s + i.price, 0);',
    '```',
    '12:10:02 out',
    '13:41:55 in',
    '',
    '#### 2026-09-29',
    'dentist in the morning',
    '11:05:18 in',
    'adjust -30m slow afternoon',
    '',
    '#### 2026-09-28',
    'balance -1h30m',
    '16:20:31 out',
    '',
  ].join('\n');
}
module.exports = { sampleNote };
