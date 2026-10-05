'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseNote } = require('./lib/parse');
const { computeBalance } = require('./lib/compute');
const { resolveSettings } = require('./lib/settings');
const { planInsert, nextToggle } = require('./lib/insert');
const { formatClock } = require('./lib/duration');
const { statusText, tooltipMarkdown, lensTitle } = require('./lib/present');

const SECTION = 'timeyoursheet';
const REFRESH_MS = 30 * 1000;

/** Local date + seconds since midnight. Overridable for tests. */
let clock = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    t: d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(),
  };
};

function config() {
  return vscode.workspace.getConfiguration(SECTION);
}

/** Absolute path of the note, or null if not configured. */
function notePath() {
  let p = (config().get('file') || '').trim();
  if (!p) return null;
  if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1));
  if (!path.isAbsolute(p)) {
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!folder) return null;
    p = path.join(folder.uri.fsPath, p);
  }
  return path.normalize(p);
}

function samePath(a, b) {
  return path.normalize(a) === path.normalize(b);
}

function openDocumentFor(p) {
  return vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && samePath(d.uri.fsPath, p));
}

/** Current text of the note: the open (possibly unsaved) editor buffer wins over the file on disk. */
function readNote(p) {
  const doc = openDocumentFor(p);
  if (doc) return doc.getText();
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

class TimeYourSheet {
  constructor(context) {
    this.context = context;
    this.result = null;
    this.parsed = null;
    this.path = null;
    this.debounce = null;
    this.watcher = null;
    this.lastSettingsErrors = '';

    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.status.command = `${SECTION}.openNote`;
    this.diagnostics = vscode.languages.createDiagnosticCollection(SECTION);
    this.lensEmitter = new vscode.EventEmitter();

    context.subscriptions.push(
      this.status,
      this.diagnostics,
      this.lensEmitter,
      vscode.commands.registerCommand(`${SECTION}.in`, () => this.log('in')),
      vscode.commands.registerCommand(`${SECTION}.out`, () => this.log('out')),
      vscode.commands.registerCommand(`${SECTION}.toggle`, () => this.log(null)),
      vscode.commands.registerCommand(`${SECTION}.openNote`, () => this.openNote()),
      vscode.commands.registerCommand(`${SECTION}.useCurrentFile`, () => this.useCurrentFile()),
      vscode.commands.registerCommand(`${SECTION}.chooseNote`, () => this.chooseNote()),
      vscode.languages.registerCodeLensProvider({ scheme: 'file' }, {
        onDidChangeCodeLenses: this.lensEmitter.event,
        provideCodeLenses: (doc) => this.codeLenses(doc),
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.path && e.document.uri.scheme === 'file' && samePath(e.document.uri.fsPath, this.path)) {
          this.scheduleRefresh();
        }
      }),
      // Follow the note when it's renamed or moved inside VS Code.
      vscode.workspace.onDidRenameFiles((e) => {
        const p = notePath();
        if (!p) return;
        const hit = e.files.find((f) => f.oldUri.scheme === 'file' && samePath(f.oldUri.fsPath, p));
        if (hit) this.setNotePath(hit.newUri.fsPath, true);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(SECTION)) {
          this.watch();
          this.refresh();
        }
      }),
      { dispose: () => this.watcher && this.watcher.dispose() },
    );

    const timer = setInterval(() => this.refresh(), REFRESH_MS);
    context.subscriptions.push({
      dispose: () => {
        clearInterval(timer);
        if (this.debounce) clearTimeout(this.debounce);
      },
    });

    this.watch();
    this.refresh();
    this.status.show();
  }

  /** Watch the note on disk so edits made outside VS Code are picked up. */
  watch() {
    if (this.watcher) this.watcher.dispose();
    this.watcher = null;
    const p = notePath();
    if (!p) return;
    const pattern = new vscode.RelativePattern(vscode.Uri.file(path.dirname(p)), path.basename(p));
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidChange(() => this.refresh());
    this.watcher.onDidCreate(() => this.refresh());
    this.watcher.onDidDelete(() => this.refresh());
  }

  scheduleRefresh() {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.refresh();
    }, 300);
  }

  settings() {
    const c = config();
    const { settings, errors } = resolveSettings({
      workHours: c.get('workHours'),
      lunch: c.get('lunch'),
      workDays: c.get('workDays'),
    });
    if (errors.length && errors.join() !== this.lastSettingsErrors) {
      vscode.window.showWarningMessage(`Time Your Sheet: ${errors.join('; ')}`);
    }
    this.lastSettingsErrors = errors.join();
    return settings;
  }

  refresh() {
    const now = clock();
    this.path = notePath();
    this.diagnostics.clear();

    if (!this.path) {
      this.result = null;
      this.parsed = null;
      this.status.text = '$(clock) Time Your Sheet: pick a note';
      this.status.tooltip = 'Click to choose the note that holds your log.';
      this.status.command = `${SECTION}.chooseNote`;
      this.lensEmitter.fire();
      return;
    }
    this.status.command = `${SECTION}.openNote`;

    const text = readNote(this.path);
    if (text === null) {
      this.result = null;
      this.parsed = null;
      this.status.text = '$(warning) Time Your Sheet: note not found';
      this.status.tooltip = `Not found: ${this.path}\n\nClick to choose the note again.`;
      this.status.command = `${SECTION}.chooseNote`;
      this.lensEmitter.fire();
      return;
    }

    this.parsed = parseNote(text);
    this.result = computeBalance(this.parsed, this.settings(), now);

    this.status.text = statusText(this.result, now.t);
    const md = new vscode.MarkdownString(tooltipMarkdown(this.result, now.t));
    this.status.tooltip = md;

    const diags = [...this.parsed.diagnostics, ...this.result.diagnostics].map((d) => {
      const range = new vscode.Range(d.line, 0, d.line, Number.MAX_SAFE_INTEGER);
      const diag = new vscode.Diagnostic(range, d.message, vscode.DiagnosticSeverity.Warning);
      diag.source = 'Time Your Sheet';
      return diag;
    });
    this.diagnostics.set(vscode.Uri.file(this.path), diags);
    this.lensEmitter.fire();
  }

  codeLenses(doc) {
    if (!config().get('codeLens', true)) return [];
    if (!this.path || doc.uri.scheme !== 'file' || !samePath(doc.uri.fsPath, this.path)) return [];
    if (!this.result || !this.result.ok) return [];
    return this.result.days
      .filter((d) => d.headerLine !== null && d.headerLine < doc.lineCount)
      .map((d) => new vscode.CodeLens(new vscode.Range(d.headerLine, 0, d.headerLine, 0), {
        title: lensTitle(d),
        command: '',
      }));
  }

  /** Log "in"/"out" under today's header. type null = toggle. */
  async log(type) {
    this.refresh();
    if (!this.path || !fs.existsSync(this.path)) {
      // Never create a fresh note at a stale path (e.g. after a rename): ask instead.
      const msg = this.path
        ? `Time Your Sheet: note not found (${path.basename(this.path)}).`
        : 'Time Your Sheet: no note configured.';
      const pick = await vscode.window.showWarningMessage(msg, 'Choose Note…');
      if (pick) await this.chooseNote();
      if (!this.path || !fs.existsSync(this.path)) return;
    }

    const now = clock();
    const current = this.result && this.result.today ? this.result.today.current : null;
    if (type === null) type = nextToggle(current);
    else if (current && current.explicit && current.state === type) {
      vscode.window.showInformationMessage(`Time Your Sheet: already ${type} since ${formatClock(current.since)}.`);
      return;
    }

    const line = `${formatClock(now.t, true)} ${type}`;
    const uri = vscode.Uri.file(this.path);
    const doc = await vscode.workspace.openTextDocument(uri);
    const wasDirty = doc.isDirty;
    const plan = planInsert(doc.getText(), {
      date: now.date,
      line,
      headingPrefix: config().get('headingPrefix') || '####',
      newDaysOnTop: config().get('newDaysOnTop', true),
    });
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, doc.positionAt(plan.offset), plan.text);
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      vscode.window.showErrorMessage('Time Your Sheet: could not write to the note.');
      return;
    }
    // Don't save the user's own unsaved edits behind their back.
    if (!wasDirty) await doc.save();
    vscode.window.setStatusBarMessage(`Time Your Sheet: ${line}`, 3000);
    this.refresh();
  }

  async openNote() {
    if (!this.path || !fs.existsSync(this.path)) return this.chooseNote();
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(this.path));
    const editor = await vscode.window.showTextDocument(doc);
    const today = this.result && this.result.today;
    if (today && today.headerLine !== null && today.headerLine !== undefined) {
      const pos = new vscode.Position(today.headerLine, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }

  /** Save the note path where the current value lives (workspace or user settings). */
  async setNotePath(p, followedRename = false) {
    const info = config().inspect('file');
    const target = info && info.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await config().update('file', p, target);
    this.watch();
    this.refresh();
    const verb = followedRename ? 'now following' : 'using';
    vscode.window.showInformationMessage(`Time Your Sheet: ${verb} ${path.basename(p)}.`);
  }

  async useCurrentFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      vscode.window.showWarningMessage('Time Your Sheet: open your note first, then run this command again.');
      return;
    }
    await this.setNotePath(editor.document.uri.fsPath);
  }

  /** Pick the note: the file in the active editor, or browse for one. */
  async chooseNote() {
    const items = [];
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === 'file' && !(this.path && samePath(editor.document.uri.fsPath, this.path))) {
      items.push({ label: `$(file) Use ${path.basename(editor.document.uri.fsPath)}`, description: 'the file open in the editor', action: 'current' });
    }
    items.push({ label: '$(folder-opened) Browse…', description: 'choose the note file', action: 'browse' });

    const pick = items.length === 1 ? items[0] : await vscode.window.showQuickPick(items, { placeHolder: 'Which file holds your in/out log?' });
    if (!pick) return;
    if (pick.action === 'current') return this.useCurrentFile();

    const dir = this.path ? path.dirname(this.path) : null;
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Use as Note',
      defaultUri: dir && fs.existsSync(dir) ? vscode.Uri.file(dir) : undefined,
      filters: { Markdown: ['md', 'markdown', 'txt'], 'All files': ['*'] },
    });
    if (uris && uris[0]) await this.setNotePath(uris[0].fsPath);
  }
}

function activate(context) {
  const app = new TimeYourSheet(context);
  return { app }; // exposed for tests
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  _setClock: (fn) => {
    clock = fn;
  },
};
