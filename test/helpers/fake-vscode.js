'use strict';

// A tiny in-process stand-in for the `vscode` module: just enough of the API
// used by src/extension.js to drive it from node:test without launching VS Code.
// Documents are backed by real files; positions are plain character offsets.

const fs = require('fs');
const path = require('path');
const Module = require('module');

function createFakeVscode() {
  const state = {
    config: {},
    commands: new Map(),
    statusItems: [],
    diagnostics: new Map(),
    lensProviders: [],
    docs: [],
    messages: [],
    changeListeners: [],
    configListeners: [],
    renameListeners: [],
    quickPick: null, // (items) => item
    openDialog: null, // () => [uri]
    configTargets: [],
    activeTextEditor: null,
  };

  class EventEmitter {
    constructor() {
      this.listeners = [];
      this.event = (fn) => {
        this.listeners.push(fn);
        return { dispose() {} };
      };
    }
    fire(v) {
      for (const l of this.listeners) l(v);
    }
    dispose() {}
  }

  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }
  class Range {
    constructor(a, b, c, d) {
      this.start = typeof a === 'object' ? a : new Position(a, b);
      this.end = typeof a === 'object' ? b : new Position(c, d);
    }
  }
  class Selection extends Range {}

  const Uri = {
    file: (p) => ({ scheme: 'file', fsPath: path.normalize(p), toString: () => `file://${p}` }),
  };

  function makeDoc(fsPath) {
    const doc = {
      uri: Uri.file(fsPath),
      text: fs.readFileSync(fsPath, 'utf8'),
      isDirty: false,
      getText() {
        return this.text;
      },
      get lineCount() {
        return this.text.split(/\r?\n/).length;
      },
      positionAt(offset) {
        return { offset };
      },
      async save() {
        fs.writeFileSync(fsPath, this.text);
        this.isDirty = false;
        return true;
      },
    };
    return doc;
  }

  class WorkspaceEdit {
    constructor() {
      this.ops = [];
    }
    insert(uri, pos, text) {
      this.ops.push({ uri, offset: pos.offset, text });
    }
  }

  const vscode = {
    EventEmitter,
    Position,
    Range,
    Selection,
    Uri,
    WorkspaceEdit,
    MarkdownString: class {
      constructor(value) {
        this.value = value;
      }
    },
    Diagnostic: class {
      constructor(range, message, severity) {
        Object.assign(this, { range, message, severity });
      }
    },
    CodeLens: class {
      constructor(range, command) {
        Object.assign(this, { range, command });
      }
    },
    RelativePattern: class {
      constructor(base, pattern) {
        Object.assign(this, { base, pattern });
      }
    },
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1 },
    TextEditorRevealType: { InCenterIfOutsideViewport: 2 },

    workspace: {
      workspaceFolders: undefined,
      get textDocuments() {
        return state.docs;
      },
      getConfiguration() {
        return {
          get: (key, def) => (key in state.config ? state.config[key] : def),
          inspect: (key) => ({ key, globalValue: state.config[key], workspaceValue: undefined }),
          update: async (key, value, target) => {
            state.config[key] = value;
            state.configTargets.push(target);
            for (const l of state.configListeners) l({ affectsConfiguration: () => true });
          },
        };
      },
      async openTextDocument(uri) {
        let doc = state.docs.find((d) => d.uri.fsPath === uri.fsPath);
        if (!doc) {
          doc = makeDoc(uri.fsPath); // throws ENOENT like the real thing would fail
          state.docs.push(doc);
        }
        return doc;
      },
      async applyEdit(edit) {
        for (const op of edit.ops.sort((a, b) => b.offset - a.offset)) {
          const doc = await vscode.workspace.openTextDocument(op.uri);
          doc.text = doc.text.slice(0, op.offset) + op.text + doc.text.slice(op.offset);
          doc.isDirty = true;
          for (const l of state.changeListeners) l({ document: doc });
        }
        return true;
      },
      onDidChangeTextDocument(fn) {
        state.changeListeners.push(fn);
        return { dispose() {} };
      },
      onDidRenameFiles(fn) {
        state.renameListeners.push(fn);
        return { dispose() {} };
      },
      onDidChangeConfiguration(fn) {
        state.configListeners.push(fn);
        return { dispose() {} };
      },
      createFileSystemWatcher() {
        const noop = () => ({ dispose() {} });
        return { onDidChange: noop, onDidCreate: noop, onDidDelete: noop, dispose() {} };
      },
    },

    window: {
      get activeTextEditor() {
        return state.activeTextEditor;
      },
      createStatusBarItem() {
        const item = { text: '', tooltip: '', command: undefined, show() {}, dispose() {} };
        state.statusItems.push(item);
        return item;
      },
      async showWarningMessage(msg, ...buttons) {
        state.messages.push(['warning', msg]);
        return state.warningAnswer ? state.warningAnswer(msg, buttons) : undefined;
      },
      async showInformationMessage(msg) {
        state.messages.push(['info', msg]);
        return undefined;
      },
      async showErrorMessage(msg) {
        state.messages.push(['error', msg]);
        return undefined;
      },
      setStatusBarMessage(msg) {
        state.messages.push(['status', msg]);
        return { dispose() {} };
      },
      async showQuickPick(items) {
        state.messages.push(['quickPick', items.map((i) => i.label)]);
        return state.quickPick ? state.quickPick(items) : undefined;
      },
      async showOpenDialog(opts) {
        state.messages.push(['openDialog', opts]);
        return state.openDialog ? state.openDialog(opts) : undefined;
      },
      async showTextDocument(doc) {
        state.activeTextEditor = { document: doc, selection: null, revealRange() {} };
        return state.activeTextEditor;
      },
    },

    commands: {
      registerCommand(id, fn) {
        state.commands.set(id, fn);
        return { dispose() {} };
      },
      executeCommand(id, ...args) {
        return state.commands.get(id)(...args);
      },
    },

    languages: {
      createDiagnosticCollection() {
        return {
          clear: () => state.diagnostics.clear(),
          set: (uri, diags) => state.diagnostics.set(uri.fsPath, diags),
          dispose() {},
        };
      },
      registerCodeLensProvider(selector, provider) {
        state.lensProviders.push(provider);
        return { dispose() {} };
      },
    },
  };

  return { vscode, state };
}

/** Load src/extension.js with `require('vscode')` resolved to a fresh fake. */
function loadExtension() {
  const { vscode, state } = createFakeVscode();
  const extPath = require.resolve('../../src/extension');
  delete require.cache[extPath];
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'vscode') return vscode;
    return origLoad.call(this, request, ...rest);
  };
  try {
    const ext = require(extPath);
    return { ext, vscode, state };
  } finally {
    Module._load = origLoad;
  }
}

module.exports = { createFakeVscode, loadExtension };
