'use strict';

// Smoke test of the VS Code glue against a fake `vscode` module.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadExtension } = require('./helpers/fake-vscode');

function setup(noteText, now) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tys-'));
  const file = path.join(dir, 'note.md');
  fs.writeFileSync(file, noteText);
  const { ext, vscode, state } = loadExtension();
  state.config.file = file;
  let clock = now;
  ext._setClock(() => clock);
  const context = { subscriptions: [] };
  const api = ext.activate(context);
  const dispose = () => context.subscriptions.forEach((s) => s.dispose());
  return {
    file,
    vscode,
    state,
    app: api.app,
    status: state.statusItems[0],
    setNow: (n) => {
      clock = n;
    },
    dispose,
    read: () => fs.readFileSync(file, 'utf8'),
  };
}

const T = (h, m = 0, s = 0) => h * 3600 + m * 60 + s;

test('registers all commands', () => {
  const env = setup('', { date: '2026-10-05', t: T(10) });
  try {
    for (const id of ['in', 'out', 'toggle', 'openNote', 'useCurrentFile', 'chooseNote']) {
      assert.ok(env.state.commands.has(`timeyoursheet.${id}`), id);
    }
  } finally {
    env.dispose();
  }
});

test('status bar asks for a balance line when there is none', () => {
  const env = setup('#### 2026-10-05\nnotes\n', { date: '2026-10-05', t: T(10) });
  try {
    assert.match(env.status.text, /balance/);
  } finally {
    env.dispose();
  }
});

test('toggle logs out then in under today, status follows, file is saved', async () => {
  const note = '#### 2026-10-05\nbalance -45m\nsome note\n\n#### 2026-10-02\nold stuff\n';
  const env = setup(note, { date: '2026-10-05', t: T(14, 54, 9) });
  try {
    assert.equal(env.status.text, '$(clock) -45m');

    await env.state.commands.get('timeyoursheet.toggle')();
    assert.equal(
      env.read(),
      '#### 2026-10-05\nbalance -45m\nsome note\n14:54:09 out\n\n#### 2026-10-02\nold stuff\n',
    );

    env.setNow({ date: '2026-10-05', t: T(15, 17, 9) });
    env.app.refresh();
    assert.equal(env.status.text, '$(debug-pause) out 23m · -1h08m');

    await env.state.commands.get('timeyoursheet.toggle')();
    assert.match(env.read(), /14:54:09 out\n15:17:09 in\n/);
    assert.equal(env.status.text, '$(clock) -1h08m');
  } finally {
    env.dispose();
  }
});

test('explicit "out" twice is refused with a message', async () => {
  const env = setup('#### 2026-10-05\nbalance 0\n14:00:00 out\n', { date: '2026-10-05', t: T(14, 30) });
  try {
    await env.state.commands.get('timeyoursheet.out')();
    assert.equal(env.read(), '#### 2026-10-05\nbalance 0\n14:00:00 out\n');
    assert.ok(env.state.messages.some(([k, m]) => k === 'info' && /already out since 14:00/.test(m)));
  } finally {
    env.dispose();
  }
});

test('first log of a new day creates the header on top', async () => {
  const env = setup('#### 2026-10-02\nbalance -1h\n', { date: '2026-10-05', t: T(8, 5) });
  try {
    await env.state.commands.get('timeyoursheet.in')();
    assert.equal(env.read(), '#### 2026-10-05\n08:05:00 in\n\n#### 2026-10-02\nbalance -1h\n');
    // early start projected to end of day: +55m
    assert.equal(env.status.text, '$(clock) -5m');
  } finally {
    env.dispose();
  }
});

test('diagnostics and code lenses', () => {
  const note = '#### 2026-10-05\nbalance 45m\n#### 2026-10-02\nbalance -1h\n12:10 out\n13:30 in\n';
  const env = setup(note, { date: '2026-10-05', t: T(10) });
  try {
    const diags = env.state.diagnostics.get(env.file);
    assert.equal(diags.length, 1);
    assert.match(diags[0].message, /explicit sign/);
    assert.equal(diags[0].range.start.line, 1);

    const doc = { uri: env.vscode.Uri.file(env.file), lineCount: 6 };
    const lenses = env.state.lensProviders[0].provideCodeLenses(doc);
    assert.deepEqual(
      lenses.map((l) => [l.range.start.line, l.command.title]),
      [
        [2, 'day -30m  ·  balance -1h30m'],
        [0, 'day 0m  ·  balance -1h30m'],
      ],
    );
  } finally {
    env.dispose();
  }
});

test('unsaved edits in the open note are counted and not saved behind the user\'s back', async () => {
  const env = setup('#### 2026-10-05\nbalance 0\n', { date: '2026-10-05', t: T(15) });
  try {
    const doc = await env.vscode.workspace.openTextDocument(env.vscode.Uri.file(env.file));
    doc.text += 'adjust -30m\n';
    doc.isDirty = true;
    env.app.refresh();
    assert.equal(env.status.text, '$(clock) -30m');

    await env.state.commands.get('timeyoursheet.out')();
    assert.equal(env.read(), '#### 2026-10-05\nbalance 0\n'); // disk untouched
    assert.match(doc.getText(), /adjust -30m\n15:00:00 out/);
  } finally {
    env.dispose();
  }
});

test('no note configured: status bar offers to pick one', () => {
  const { ext, state } = loadExtension();
  ext._setClock(() => ({ date: '2026-10-05', t: T(10) }));
  const context = { subscriptions: [] };
  ext.activate(context);
  try {
    assert.match(state.statusItems[0].text, /pick a note/);
    assert.equal(state.statusItems[0].command, 'timeyoursheet.chooseNote');
  } finally {
    context.subscriptions.forEach((s) => s.dispose());
  }
});

test('renaming the note inside VS Code follows it', async () => {
  const env = setup('#### 2026-10-05\nbalance -1h\n', { date: '2026-10-05', t: T(10) });
  try {
    const renamed = path.join(path.dirname(env.file), 'work-log.md');
    fs.renameSync(env.file, renamed);
    env.app.refresh();
    assert.match(env.status.text, /note not found/);
    assert.equal(env.status.command, 'timeyoursheet.chooseNote');

    for (const l of env.state.renameListeners) {
      l({ files: [{ oldUri: env.vscode.Uri.file(env.file), newUri: env.vscode.Uri.file(renamed) }] });
    }
    await new Promise((r) => setImmediate(r));
    assert.equal(env.state.config.file, renamed);
    assert.equal(env.status.text, '$(clock) -1h');
    assert.equal(env.status.command, 'timeyoursheet.openNote');
  } finally {
    env.dispose();
  }
});

test('renaming some other file is ignored', () => {
  const env = setup('#### 2026-10-05\nbalance -1h\n', { date: '2026-10-05', t: T(10) });
  try {
    for (const l of env.state.renameListeners) {
      l({ files: [{ oldUri: env.vscode.Uri.file('/tmp/other.md'), newUri: env.vscode.Uri.file('/tmp/x.md') }] });
    }
    assert.equal(env.state.config.file, env.file);
  } finally {
    env.dispose();
  }
});

test('choose note: browse picks a file and the status recovers', async () => {
  const env = setup('', { date: '2026-10-05', t: T(10) });
  try {
    const other = path.join(path.dirname(env.file), 'renamed.md');
    fs.writeFileSync(other, '#### 2026-10-05\nbalance +30m\n');
    env.state.config.file = path.join(path.dirname(env.file), 'gone.md');
    env.app.refresh();
    assert.match(env.status.text, /note not found/);

    env.state.openDialog = () => [env.vscode.Uri.file(other)];
    await env.state.commands.get('timeyoursheet.chooseNote')();
    assert.equal(env.state.config.file, other);
    assert.equal(env.status.text, '$(clock) +30m');
  } finally {
    env.dispose();
  }
});

test('choose note: offers the file open in the editor', async () => {
  const env = setup('', { date: '2026-10-05', t: T(10) });
  try {
    const other = path.join(path.dirname(env.file), 'current.md');
    fs.writeFileSync(other, '#### 2026-10-05\nbalance -2h\n');
    await env.vscode.window.showTextDocument(await env.vscode.workspace.openTextDocument(env.vscode.Uri.file(other)));
    env.state.quickPick = (items) => items[0];
    await env.state.commands.get('timeyoursheet.chooseNote')();
    const qp = env.state.messages.find(([k]) => k === 'quickPick');
    assert.deepEqual(qp[1], ['$(file) Use current.md', '$(folder-opened) Browse…']);
    assert.equal(env.state.config.file, other);
    assert.equal(env.status.text, '$(clock) -2h');
  } finally {
    env.dispose();
  }
});

test('logging with a missing note asks instead of creating a new file', async () => {
  const env = setup('#### 2026-10-05\nbalance 0\n', { date: '2026-10-05', t: T(10) });
  try {
    fs.renameSync(env.file, env.file + '.bak');
    await env.state.commands.get('timeyoursheet.toggle')();
    assert.equal(fs.existsSync(env.file), false);
    assert.ok(env.state.messages.some(([k, m]) => k === 'warning' && /note not found \(note\.md\)/.test(m)));
  } finally {
    env.dispose();
  }
});
