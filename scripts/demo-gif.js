'use strict';

// Renders images/demo.gif: one scripted day (plus a week-later view), frame by
// frame, with a caption bar explaining each step. All status bar, CodeLens and
// tooltip text comes from the extension's real code via screenshots.js.
//
//   npm i --no-save playwright-core @vscode/codicons @fontsource/jetbrains-mono
//   node scripts/demo-gif.js [path/to/chromium]      # needs ffmpeg on PATH
//
// Output: images/demo.gif

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright-core');
const { render, palette, quickPick, esc } = require('./screenshots');

const OUT = path.join(__dirname, '..', 'images', 'demo.gif');
const T = (h, m = 0, s = 0) => h * 3600 + m * 60 + s;
const MON = '2026-10-05';
const FRI = '2026-10-09';

// Ordinary note-taking that goes into Monday's section: none of it affects the balance.
const NOTES = [
  '',
  'standup: API freeze moved to Thursday',
  '- [x] review PR #482',
  '- [ ] update release notes',
  '```js',
  'const total = items.reduce((s, i) => s + i.price, 0);',
  '```',
];

/** Monday's section: header, balance, optionally the first `notes` lines of NOTES, then events. */
const monday = (notes, ...events) =>
  ['#### 2026-10-05', 'balance -45m', ...NOTES.slice(0, notes), ...events].join('\n') + '\n';
const lastLine = (note) => note.replace(/\n$/, '').split('\n').length - 1;
const full = (...events) => monday(NOTES.length, ...events);

const week = [
  '#### 2026-10-09',
  '- [x] review PR #482',
  '16:20:31 out',
  '',
  '#### 2026-10-08',
  'deploy window moved to the evening',
  '20:18:40 in',
  '22:34:05 out',
  '',
  '#### 2026-10-07',
  '08:12:40 in',
  '12:10:02 out',
  '13:41:55 in',
  '',
  '#### 2026-10-06',
  'dentist in the morning',
  '11:05:18 in',
  'adjust -30m slow afternoon',
  '',
  '#### 2026-10-05',
  'balance -45m',
  ...NOTES,
  '14:54:09 out',
  '15:32:04 in',
  '18:05:12 out',
  '',
].join('\n');

const STEPS = 8;

const NOTES_TEXT = 'It\'s still just your notes file: meeting notes, to-dos, pasted code. Only the in/out lines count, so the balance stays put.';

// Each frame: editor state + caption. `ms` is how long the frame stays on screen.
const FRAMES = [
  { step: 1, ms: 2600, clock: 'Mon 09:02', note: '', cursorLine: 0, statusOverride: '$(clock) Time Your Sheet: pick a note', focus: true,
    text: 'Open the Markdown note you already keep notes in.' },
  { step: 1, ms: 2600, clock: 'Mon 09:02', note: '', cursorLine: 0, statusOverride: '$(clock) Time Your Sheet: pick a note',
    overlay: palette({ query: 'use current', commands: ['Use Current File as Note'], groups: {} }),
    text: 'Point the extension at it: <b>Use Current File as Note</b>.' },
  ...['#', '####', '#### 2026', '#### 2026-10-05', '#### 2026-10-05\nbal', '#### 2026-10-05\nbalance', '#### 2026-10-05\nbalance -45m'].map((note, i, all) => ({
    step: 2, ms: i === all.length - 1 ? 2600 : 220, focus: i === all.length - 1, clock: 'Mon 09:03', note, cursorLine: note.split('\n').length - 1,
    text: 'Add today\'s date and your current balance. That\'s the whole setup.',
  })),
  { step: 3, ms: 3000, clock: 'Mon 09:05', note: monday(0), cursorLine: 1, focus: true,
    text: 'A normal day needs no lines: during work hours you\'re assumed to be working.' },
  // The note fills up the way it normally would: a line, a to-do list, a pasted snippet.
  ...[2, 3, 4, NOTES.length].map((n, i, all) => ({
    step: 4, ms: i === all.length - 1 ? 4200 : 650, clock: i < 2 ? 'Mon 10:14' : 'Mon 11:20', note: monday(n), cursorLine: lastLine(monday(n)),
    focus: i === all.length - 1, text: NOTES_TEXT,
  })),
  { step: 5, ms: 3000, clock: 'Mon 14:54', note: full(), cursorLine: lastLine(full()), t: T(14, 54, 9),
    overlay: palette(),
    text: 'Stepping out? Run <b>Toggle In/Out</b> from the Command Palette (⇧⌘P) or a shortcut.' },
  { step: 5, ms: 2600, clock: 'Mon 14:54', note: full('14:54:09 out'), cursorLine: lastLine(full('14:54:09 out')), t: T(14, 54, 9), focus: true,
    statusMessage: 'Time Your Sheet: 14:54:09 out',
    text: 'The time is added under today\'s notes, and you\'re out.' },
  ...[T(14, 58, 9), T(15, 6, 9), T(15, 17, 9)].map((t, i) => ({
    step: 5, ms: i === 2 ? 2200 : 750, clock: `Mon ${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`,
    note: full('14:54:09 out'), cursorLine: lastLine(full('14:54:09 out')), t, focus: true,
    text: 'While you\'re out during work hours, the debt grows live.',
  })),
  { step: 6, ms: 2800, clock: 'Mon 15:32', note: full('14:54:09 out', '15:32:04 in'), cursorLine: lastLine(full('14:54:09 out', '15:32:04 in')), t: T(15, 32, 4), focus: true,
    statusMessage: 'Time Your Sheet: 15:32:04 in',
    text: 'Back at your desk: toggle again. The 38 minutes went on the debt.' },
  { step: 7, ms: 3400, clock: 'Mon 18:05', note: full('14:54:09 out', '15:32:04 in'), cursorLine: lastLine(full('14:54:09 out', '15:32:04 in')), t: T(18, 5, 12),
    overlay: quickPick({
      placeholder: 'After work hours: done for the day, or starting an evening session?',
      items: [['$(debug-pause) Out', 'stayed late, done now: counts from the end of work hours'], ['$(play) In', 'back for an evening session']],
    }),
    text: 'After hours, Toggle asks: did you stay late, or are you starting an evening session?' },
  { step: 7, ms: 3000, clock: 'Mon 18:05', note: full('14:54:09 out', '15:32:04 in', '18:05:12 out'), cursorLine: lastLine(full('14:54:09 out', '15:32:04 in', '18:05:12 out')),
    t: T(18, 5, 12), focus: true, statusMessage: 'Time Your Sheet: 18:05:12 out',
    text: 'Staying late earned 1h05m back. The line above the date sums up the day.' },
  { step: 8, ms: 4600, clock: 'Fri 17:40', date: FRI, note: week, cursorLine: 2, t: T(17, 40), hoverStatus: true,
    text: 'A week later: hover the status bar for your history.' },
];

const CSS = `
body { padding: 18px 18px 16px; background: #f3ecd8; }
.win { width: 760px; height: 430px; box-shadow: 0 0 0 0.5px rgba(0,0,0,.25), 0 8px 24px rgba(60,50,20,.18); }
.cap { width: 760px; margin-top: 12px; display: flex; align-items: center; gap: 14px; background: #073642; color: #eee8d5;
  border-radius: 10px; padding: 0 14px; font-size: 14px; line-height: 1.35; height: 62px; }
.cap .n { flex: none; font-size: 12px; font-weight: 700; letter-spacing: .04em; background: #268bd2; color: #fff; border-radius: 999px; padding: 3px 9px; }
.cap .t { flex: 1; } .cap b { color: #fff; }
.cap .clk { flex: none; font-family: JBM, monospace; font-size: 12.5px; color: #93a1a1; display: flex; align-items: center; gap: 6px; }
`;

function frameHtml(f) {
  const caption = `<div class="cap"><span class="n">${f.step} / ${STEPS}</span><span class="t">${f.text}</span>`
    + `<span class="clk"><i class="codicon codicon-clock"></i>${esc(f.clock)}</span></div>`;
  return render({
    note: f.note,
    t: f.t ?? T(...f.clock.split(' ')[1].split(':').map(Number)),
    date: f.date || MON,
    cursorLine: f.cursorLine,
    hoverStatus: f.hoverStatus,
    statusMessage: f.statusMessage,
    statusOverride: f.statusOverride,
    statusFocus: f.focus,
    overlay: f.overlay,
    caption,
    css: CSS,
  });
}

async function main() {
  const executablePath = process.argv[2] || process.env.CHROMIUM || undefined;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tys-gif-'));
  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1.35 });
  const list = [];
  for (const [i, f] of FRAMES.entries()) {
    const html = path.join(tmp, `f${i}.html`);
    const png = path.join(tmp, `f${String(i).padStart(3, '0')}.png`);
    fs.writeFileSync(html, frameHtml(f));
    await page.goto(`file://${html}`);
    await page.evaluate(() => document.fonts.ready);
    const box = await page.evaluate(() => {
      const r = document.body.getBoundingClientRect();
      return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height) };
    });
    await page.screenshot({ path: png, clip: box });
    list.push(`file '${png}'\nduration ${(f.ms / 1000).toFixed(3)}`);
  }
  await browser.close();
  // The concat demuxer ignores the last duration unless the last file is repeated.
  list.push(`file '${path.join(tmp, `f${String(FRAMES.length - 1).padStart(3, '0')}.png`)}'`);
  const listFile = path.join(tmp, 'list.txt');
  fs.writeFileSync(listFile, list.join('\n') + '\n');

  const pal = path.join(tmp, 'palette.png');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', 'palettegen=max_colors=256:stats_mode=full', pal]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-i', pal,
    '-lavfi', 'paletteuse=dither=none', '-fps_mode', 'vfr', '-loop', '0', OUT]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('wrote', path.relative(process.cwd(), OUT), `(${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
