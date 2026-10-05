'use strict';

// Renders the README screenshots: a VS Code-like window (Solarized Light) whose
// status bar, CodeLens and tooltip text come from the extension's real code.
//
//   npm i --no-save playwright-core @vscode/codicons @fontsource/jetbrains-mono
//   node scripts/screenshots.js [path/to/chromium]
//
// Output: images/*.png

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const { parseNote } = require('../src/lib/parse');
const { computeBalance } = require('../src/lib/compute');
const { resolveSettings } = require('../src/lib/settings');
const { statusText, lensTitle, tooltipMarkdown } = require('../src/lib/present');
const { sampleNote } = require('./sample-note');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'images');
const NM = path.join(ROOT, 'node_modules');
const TODAY = '2026-10-02';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const icon = (name, extra = '') => `<i class="codicon codicon-${name} ${extra}"></i>`;
const withIcons = (text) => esc(text).replace(/\$\(([a-z-]+)\)/g, (_, n) => icon(n));

/** Tiny Markdown renderer for the tooltip: paragraphs, **bold**, `code`, tables. */
function md(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  return text.split('\n\n').map((block) => {
    if (!block.startsWith('|')) return `<p>${inline(block)}</p>`;
    const rows = block.split('\n').filter((r) => !/^\|[-:|]+\|$/.test(r));
    const cells = (r) => r.slice(1, -1).split('|').map((c) => c.trim());
    const [head, ...body] = rows;
    return `<table><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr>${body
      .map((r) => `<tr>${cells(r).map((c, i) => `<td class="${i ? 'num' : ''}">${inline(c)}</td>`).join('')}</tr>`)
      .join('')}</table>`;
  }).join('');
}

/** Syntax-colour one Markdown line roughly like the Solarized Light theme. */
function colorLine(line, inFence) {
  if (/^\s*(```|~~~)/.test(line)) return `<span class="fence">${esc(line)}</span>`;
  if (inFence) return `<span class="code">${esc(line)}</span>`;
  if (/^#{1,6}\s/.test(line)) return `<span class="h">${esc(line)}</span>`;
  const task = /^(\s*)(-)\s(\[[ x]\])\s(.*)$/.exec(line);
  if (task) {
    const done = task[3] === '[x]';
    return `${task[1]}<span class="dash">-</span> <span class="${done ? 'done' : 'todo'}">${esc(task[3])}</span> <span class="item">${esc(task[4])}</span>`;
  }
  return esc(line);
}

function render({ note, t, cursorLine, hoverStatus, statusMessage, overlay }) {
  const parsed = parseNote(note);
  const result = computeBalance(parsed, resolveSettings({}).settings, { date: TODAY, t });
  const lenses = new Map(result.days.map((d) => [d.headerLine, lensTitle(d)]));

  let inFence = false;
  const rows = note.replace(/\n$/, '').split('\n').map((line, i) => {
    const fence = /^\s*(```|~~~)/.test(line);
    const html = colorLine(line, inFence && !fence);
    if (fence) inFence = !inFence;
    const lens = lenses.has(i) ? `<div class="lens"><span class="gut"></span><span>${esc(lenses.get(i))}</span></div>` : '';
    const cur = i === cursorLine;
    const caret = cur ? '<span class="caret"></span>' : '';
    return `${lens}<div class="row${cur ? ' cur' : ''}"><span class="gut">${i + 1}</span><span class="txt">${html || '&#8203;'}${caret}</span></div>`;
  }).join('');

  const tooltip = hoverStatus
    ? `<div class="hover">${md(tooltipMarkdown(result, t))}</div>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: codicon; src: url("file://${NM}/@vscode/codicons/dist/codicon.ttf"); }
@font-face { font-family: JBM; font-weight: 400; src: url("file://${NM}/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2"); }
@font-face { font-family: JBM; font-weight: 700; src: url("file://${NM}/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2"); }
${fs.readFileSync(path.join(NM, '@vscode/codicons/dist/codicon.css'), 'utf8').replace(/@font-face\s*{[^}]*}/, '')}
* { box-sizing: border-box; }
html, body { margin: 0; background: transparent; }
body { padding: 28px; font-family: Inter, -apple-system, sans-serif; font-size: 13px; color: #586e75; }
.win { width: 1100px; height: 800px; border-radius: 11px; overflow: hidden; position: relative;
  background: #fdf6e3; box-shadow: 0 0 0 0.5px rgba(0,0,0,.25), 0 18px 50px rgba(60,50,20,.28);
  display: grid; grid-template-rows: 38px 1fr 24px; }
.title { background: #eee8d5; display: flex; align-items: center; padding: 0 12px; gap: 14px; border-bottom: 1px solid #ddd6c1; }
.lights { display: flex; gap: 8px; } .lights span { width: 12px; height: 12px; border-radius: 50%; }
.title .nav { color: #93a1a1; display: flex; gap: 10px; margin-left: 56px; }
.search { flex: 0 0 430px; margin: 0 auto; height: 24px; border: 1px solid #d3cbb7; border-radius: 6px; background: #f5efdc;
  display: flex; align-items: center; justify-content: center; gap: 6px; color: #839496; font-size: 12.5px; }
.title .lay { display: flex; gap: 12px; color: #73817f; }
.main { display: grid; grid-template-columns: 48px 1fr; min-height: 0; }
.act { background: #eee8d5; border-right: 1px solid #ddd6c1; display: flex; flex-direction: column; align-items: center; padding-top: 10px; gap: 22px; color: #8a8175; }
.act .codicon { font-size: 24px; } .act .on { color: #586e75; } .act .bottom { margin-top: auto; margin-bottom: 14px; }
.ed { display: grid; grid-template-rows: 35px 22px 1fr; min-width: 0; min-height: 0; }
.tabs { background: #e8e1cc; display: flex; align-items: stretch; border-bottom: 1px solid #ddd6c1; }
.tab { background: #fdf6e3; padding: 0 12px 0 14px; display: flex; align-items: center; gap: 8px; color: #586e75; border-right: 1px solid #ddd6c1; font-size: 13px; }
.tab .codicon-markdown { color: #268bd2; } .tab .codicon-close { font-size: 14px; color: #839496; margin-left: 10px; }
.tabs .acts { margin-left: auto; display: flex; gap: 14px; align-items: center; padding-right: 14px; color: #73817f; }
.crumbs { display: flex; align-items: center; gap: 4px; padding-left: 18px; color: #839496; font-size: 12.5px; }
.crumbs .codicon { font-size: 13px; }
.lines { font-variant-ligatures: none; font-family: JBM, monospace; font-size: 13.5px; overflow: hidden; padding-top: 4px; position: relative; }
.row { display: flex; height: 21px; line-height: 21px; white-space: pre; }
.row.cur { background: #eee8d5; }
.gut { width: 62px; padding-right: 22px; text-align: right; color: #93a1a1; flex: none; }
.row.cur .gut { color: #586e75; }
.lens { display: flex; height: 19px; line-height: 19px; font-family: Inter, sans-serif; font-size: 11.5px; color: #93a1a1; white-space: pre; }
.h { color: #268bd2; font-weight: 700; } .dash { color: #cb4b16; } .done { color: #859900; } .todo { color: #b58900; } .item { color: #b58900; }
.fence { color: #93a1a1; } .code { color: #2aa198; }
.caret { display: inline-block; width: 2px; height: 17px; background: #657b83; vertical-align: -3px; margin-left: 1px; }
.status { background: #eee8d5; border-top: 1px solid #ddd6c1; display: flex; align-items: center; font-size: 12px; color: #586e75; }
.status .it { display: flex; align-items: center; gap: 4px; padding: 0 8px; height: 100%; }
.status .codicon { font-size: 14px; }
.status .remote { background: #d9d2bf; padding: 0 10px; }
.status .ours { padding: 0 9px; }
.status .ours.hl { background: #d9d2bf; }
.status .msg { color: #657b83; }
.status .right { margin-left: auto; display: flex; height: 100%; }
.hover { position: absolute; left: 58px; bottom: 30px; background: #eee8d5; border: 1px solid #c9c1a9; border-radius: 4px;
  box-shadow: 0 4px 16px rgba(60,50,20,.22); padding: 4px 12px; font-size: 13px; color: #586e75; min-width: 330px; }
.hover p { margin: 7px 0; } .hover code { font-family: JBM, monospace; font-size: 12px; }
.hover table { border-collapse: collapse; margin: 4px 0 2px; font-variant-numeric: tabular-nums; }
.hover th { text-align: left; font-weight: 600; padding: 2px 14px 4px 0; } .hover th:not(:first-child) { text-align: right; }
.hover td { padding: 2px 14px 2px 0; } .hover td.num { text-align: right; } .hover td:last-child, .hover th:last-child { padding-right: 0; }
.hover::after { content: ""; position: absolute; left: 34px; bottom: -6px; width: 10px; height: 10px; background: #eee8d5;
  border-right: 1px solid #c9c1a9; border-bottom: 1px solid #c9c1a9; transform: rotate(45deg); }
.hover::after { left: 14px; }
.palette { position: absolute; top: 44px; left: 50%; transform: translateX(-50%); width: 600px; background: #eee8d5;
  border: 1px solid #c9c1a9; border-radius: 8px; box-shadow: 0 8px 28px rgba(60,50,20,.28); padding: 6px; font-size: 13px; }
.palette .in { background: #fdf6e3; border: 1px solid #268bd2; border-radius: 4px; height: 28px; display: flex; align-items: center; padding: 0 8px; color: #586e75; }
.palette .in .caret { height: 16px; vertical-align: -2px; }
.palette .pi { display: flex; align-items: center; height: 24px; padding: 0 8px; border-radius: 4px; margin-top: 2px; }
.palette .pi.sel { background: #268bd2; color: #fdf6e3; }
.palette .pi mark { background: none; color: #268bd2; font-weight: 700; }
.palette .pi.sel mark { color: #fff; }
.palette .keys { margin-left: auto; display: flex; gap: 3px; }
.palette kbd { font-family: Inter, sans-serif; font-size: 11px; border: 1px solid #c9c1a9; border-bottom-width: 2px; border-radius: 3px; padding: 0 4px; background: #f5efdc; color: #586e75; }
.palette .group { margin-left: auto; color: #d9ecf8; font-size: 12px; }
</style></head><body><div class="win">
<div class="title">
  <div class="lights"><span style="background:#ff5f57"></span><span style="background:#febc2e"></span><span style="background:#28c840"></span></div>
  <div class="nav">${icon('arrow-left')}${icon('arrow-right')}</div>
  <div class="search">${icon('search')} notes</div>
  <div class="lay">${icon('layout-sidebar-left')}${icon('layout-panel')}${icon('layout-sidebar-right')}</div>
</div>
<div class="main">
  <div class="act">${icon('files', 'on')}${icon('search')}${icon('source-control')}${icon('debug-alt')}${icon('extensions')}<span class="bottom">${icon('account')}</span></div>
  <div class="ed">
    <div class="tabs"><div class="tab">${icon('markdown')} time-sheet.md ${icon('close')}</div>
      <div class="acts">${icon('open-preview')}${icon('split-horizontal')}${icon('ellipsis')}</div></div>
    <div class="crumbs">notes ${icon('chevron-right')} ${icon('markdown')} time-sheet.md ${icon('chevron-right')} #### ${TODAY}</div>
    <div class="lines">${rows}</div>
  </div>
</div>
<div class="status">
  <span class="it remote">${icon('remote')}</span>
  <span class="it ours${hoverStatus ? ' hl' : ''}">${withIcons(statusText(result, t))}</span>
  <span class="it">${icon('error')} 0 ${icon('warning')} 0</span>
  ${statusMessage ? `<span class="it msg">${esc(statusMessage)}</span>` : ''}
  <span class="right"><span class="it">Ln ${cursorLine + 1}, Col ${note.split('\n')[cursorLine].length + 1}</span><span class="it">LF</span><span class="it">{ } Markdown</span><span class="it">${icon('bell')}</span></span>
</div>
${tooltip}${overlay || ''}
</div></body></html>`;
}

function palette() {
  const cmds = ['Toggle In/Out', 'Log In', 'Log Out', 'Open Note', 'Choose Note…', 'Use Current File as Note'];
  const items = cmds.map((name, i) => `<div class="pi${i === 0 ? ' sel' : ''}"><span><mark>Time Your Sheet</mark>: ${esc(name)}</span>${
    i === 0 ? '<span class="group">recently used</span>' : ''}</div>`).join('');
  return `<div class="palette"><div class="in">&gt;Time Your Sheet<span class="caret"></span></div>${items}</div>`;
}

const SHOTS = [
  {
    file: 'balance.png',
    note: sampleNote('evening'),
    t: 19 * 3600 + 10 * 60,
    cursorLine: 6,
    hoverStatus: true,
  },
  {
    file: 'out.png',
    note: sampleNote('out'),
    t: 15 * 3600 + 17 * 60 + 9,
    cursorLine: 4,
    statusMessage: 'Time Your Sheet: 14:54:09 out',
  },
  {
    file: 'commands.png',
    note: sampleNote('out'),
    t: 15 * 3600 + 17 * 60 + 9,
    cursorLine: 4,
    overlay: palette(),
  },
];

async function main() {
  const executablePath = process.argv[2] || process.env.CHROMIUM || undefined;
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({ viewport: { width: 1156, height: 856 }, deviceScaleFactor: 2 });
  for (const shot of SHOTS) {
    const html = path.join(OUT, `.tmp-${shot.file}.html`);
    fs.writeFileSync(html, render(shot));
    await page.goto(`file://${html}`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, shot.file), omitBackground: true });
    fs.unlinkSync(html);
    console.log('wrote', path.join('images', shot.file));
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
