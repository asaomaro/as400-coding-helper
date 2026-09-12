// vscode API のスタブ。ユニットテストは拡張機能ホストを起こさずに動かす。
// 実物が要るもの（WebView・装飾の描画）は integration 側で見る。
const Module = require("node:module");

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
  // 実物は (start, end) と (startLine, startChar, endLine, endChar) の
  // 2 つの形を取る。引数の個数で分ける（既存の 2 引数呼び出しの挙動は変えない）。
  constructor(...args) {
    if (args.length === 4) {
      this.start = new Position(args[0], args[1]);
      this.end = new Position(args[2], args[3]);
      return;
    }
    this.start = args[0];
    this.end = args[1];
  }
}

function containsRange(outer, inner) {
  const startsInside =
    inner.start.line > outer.start.line ||
    (inner.start.line === outer.start.line &&
      inner.start.character >= outer.start.character);
  const endsInside =
    inner.end.line < outer.end.line ||
    (inner.end.line === outer.end.line &&
      inner.end.character <= outer.end.character);
  return startsInside && endsInside;
}

class DocumentSymbol {
  constructor(name, detail, kind, range, selectionRange) {
    // 実物（extHostTypes）と同じ検証をする。これが無いと「空の name で
    // 実機だけ例外」という欠陥がテストで緑のまま通る（実際に通っていた）。
    if (!name) {
      throw new Error("name must not be falsy");
    }
    // 実機は selectionRange が range に含まれることも検査し、破ると
    // `Invalid document symbol` で throw する。アウトラインが丸ごと出なくなるので
    // ここでも同じ検査をする（ラウンド 1・2 で最も揺れた不変条件）。
    if (range && selectionRange && !containsRange(range, selectionRange)) {
      throw new Error("selectionRange must be contained in range");
    }
    this.name = name;
    this.detail = detail;
    this.kind = kind;
    this.range = range;
    this.selectionRange = selectionRange;
    // 実物と同じく、呼び出し側が push できるよう初期化しておく。
    this.children = [];
  }
}

/** vscode.SymbolKind の実際の数値。テストが値を assert できるよう実物に合わせる。 */
const SymbolKind = {
  File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5,
  Property: 6, Field: 7, Constructor: 8, Enum: 9, Interface: 10,
  Function: 11, Variable: 12, Constant: 13, String: 14, Number: 15,
  Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20,
  EnumMember: 21, Struct: 22, Event: 23, Operator: 24, TypeParameter: 25
};
class Diagnostic {
  constructor(range, message, severity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

/**
 * `Uri` の最小実装。**`path` と `with()` を持たせる**——新規作成が
 * 「拡張子が種別に合わなければ足す」を `uri.with({ path: … })` で行うため、
 * 無いと拡張子を足す経路が試せない（本物の `Uri` も `with` は差分マージ）。
 */
function makeUri(fsPath) {
  return {
    fsPath,
    path: fsPath,
    scheme: "file",
    toString: () => fsPath,
    with(parts) {
      return makeUri(parts.path ?? fsPath);
    }
  };
}

// 設定を差し替えられるようにする（既定は「未設定」＝実装側の既定値が効く）。
// テストから `vscode.__setConfig({ "rpgClSupport": { "lint.enable": false } })`。
let configValues = {};

const vscode = {
  Position,
  Range,
  DocumentSymbol,
  SymbolKind,
  Diagnostic,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  __setConfig(values) { configValues = values ?? {}; },
  Uri: {
    file: fsPath => makeUri(fsPath),
    joinPath: (base, ...parts) => makeUri([base.fsPath, ...parts].join("/"))
  },
  EventEmitter: class {
    constructor() { this.event = () => ({ dispose() {} }); }
    fire() {}
    dispose() {}
  },
  workspace: {
    getConfiguration: section => ({
      get: (key, defaultValue) => configValues[section]?.[key] ?? defaultValue
    }),
    workspaceFolders: undefined,
    __workspaceFolder: undefined,
    __relativePath: undefined,
    __appliedEdits: [],
    __applyEditResult: true,
    __textDocumentChangeListeners: [],
    __configurationChangeListeners: [],
    getWorkspaceFolder: () => vscode.workspace.__workspaceFolder,
    asRelativePath: uri => vscode.workspace.__relativePath ?? uri.fsPath,
    onDidChangeTextDocument(listener) {
      vscode.workspace.__textDocumentChangeListeners.push(listener);
      return { dispose() {} };
    },
    onDidChangeConfiguration(listener) {
      vscode.workspace.__configurationChangeListeners.push(listener);
      return { dispose() {} };
    },
    __fireTextDocumentChange(event) {
      vscode.workspace.__textDocumentChangeListeners.forEach(listener => listener(event));
    },
    __fireConfigurationChange(event) {
      vscode.workspace.__configurationChangeListeners.forEach(listener => listener(event));
    },
    onDidCloseTextDocument: () => ({ dispose() {} }),
    onDidOpenTextDocument: () => ({ dispose() {} }),
    applyEdit: edit => {
      vscode.workspace.__appliedEdits.push(edit);
      return Promise.resolve(vscode.workspace.__applyEditResult);
    },
    /**
     * ファイルシステム。**書いた内容を覚えるだけ**（実際には書かない）。
     * テストから `vscode.workspace.fs.__written` で確かめる。
     * `vscode.workspace.fs.__failWrite = true` で失敗させられる。
     */
    fs: {
      __written: [],
      __failWrite: false,
      /** 既に在ることにするパス（`stat` が成功する）。 */
      __existing: [],
      writeFile(uri, content) {
        if (vscode.workspace.fs.__failWrite) {
          return Promise.reject(new Error("EACCES"));
        }
        vscode.workspace.fs.__written.push({ uri, content });
        return Promise.resolve();
      },
      /** **本物と同じく、無ければ reject する。** 「在るか」はこれでしか分からない。 */
      stat(uri) {
        return vscode.workspace.fs.__existing.includes(uri.fsPath)
          ? Promise.resolve({ type: 1, size: 0 })
          : Promise.reject(new Error("ENOENT"));
      }
    }
  },
  window: {
    activeTextEditor: undefined,
    visibleTextEditors: [],
    messages: [],
    errors: [],
    decorationTypes: [],
    __inputBoxResult: undefined,
    __inputBoxOptions: undefined,
    __showTextDocumentCalls: [],
    __activeTextEditorChangeListeners: [],
    /**
     * 保存ダイアログ。**テストが答えを決める**——
     * `vscode.window.__saveDialogResult` に Uri を入れると採用、
     * `undefined`（既定）なら取り消し。呼ばれた引数は `__saveDialogOptions` に残る。
     */
    __saveDialogResult: undefined,
    __saveDialogOptions: undefined,
    showSaveDialog(options) {
      vscode.window.__saveDialogOptions = options;
      return Promise.resolve(vscode.window.__saveDialogResult);
    },
    showErrorMessage(message) {
      vscode.window.errors.push(message);
      return Promise.resolve(undefined);
    },
    showInputBox(options) {
      vscode.window.__inputBoxOptions = options;
      return Promise.resolve(vscode.window.__inputBoxResult);
    },
    createTextEditorDecorationType(options) {
      const decoration = { options, dispose() {} };
      vscode.window.decorationTypes.push(decoration);
      return decoration;
    },
    /**
     * 確認の答え。**テストが決める**——押すボタンの文字列を入れると
     * それを選んだことになる。既定（undefined）は「閉じた／取り消した」。
     */
    __warningAnswer: undefined,
    createWebviewPanel(viewType, title) {
      const panel = {
        viewType,
        title,
        webview: {
          html: "",
          cspSource: "vscode-resource:",
          onDidReceiveMessage(handler) {
            panel.webview.__handler = handler;
            return { dispose() {} };
          },
          postMessage() {}
        },
        onDidDispose(handler) {
          panel.__onDispose = handler;
          return { dispose() {} };
        },
        dispose() {
          panel.__disposed = true;
          panel.__onDispose?.();
        }
      };
      vscode.window.__lastPanel = panel;
      return panel;
    },
    // カスタムエディタの登録。配線が到達しているかを見るために記録だけする。
    registerCustomEditorProvider(viewType, provider, options) {
      vscode.window.__customEditors = vscode.window.__customEditors ?? [];
      vscode.window.__customEditors.push({ viewType, provider, options });
      return { dispose() {} };
    },
    showInformationMessage(message) {
      vscode.window.messages.push(message);
      return Promise.resolve(undefined);
    },
    // **答えを返せるようにする。** 確認（モーダル）を出す経路は、選んだ結果で
    // 振る舞いが変わるので、`undefined` 固定だと「取り消した」側しか試せない。
    showWarningMessage(message) {
      vscode.window.messages.push(message);
      return Promise.resolve(vscode.window.__warningAnswer);
    },
    onDidChangeTextEditorSelection: () => ({ dispose() {} }),
    onDidChangeActiveTextEditor(listener) {
      vscode.window.__activeTextEditorChangeListeners.push(listener);
      return { dispose() {} };
    },
    __fireActiveTextEditorChange(editor) {
      vscode.window.activeTextEditor = editor;
      vscode.window.__activeTextEditorChangeListeners.forEach(listener => listener(editor));
    },
    showTextDocument(document, options) {
      vscode.window.__showTextDocumentCalls.push({ document, options });
      return Promise.resolve({
        selection: undefined,
        revealRange() {}
      });
    }
  },
  // 登録の呼び出しを記録する。「定義を足しただけで消費経路に繋がっていない」
  // 種類の欠陥をテストから捕まえるため（実際に F4 のキーバインドで踏んでいる）。
  languages: {
    registered: [],
    registerDocumentSymbolProvider(selector, provider) {
      vscode.languages.registered.push({ kind: "documentSymbol", selector, provider });
      return { dispose() {} };
    },
    registerCompletionItemProvider(selector, provider, ...triggers) {
      vscode.languages.registered.push({
        kind: "completionItem",
        selector,
        provider,
        triggers
      });
      return { dispose() {} };
    },
    registerHoverProvider(selector, provider) {
      vscode.languages.registered.push({ kind: "hover", selector, provider });
      return { dispose() {} };
    },
    // 診断の配線（イベント→refresh→lint core）を通すため、set したものを
    // get で読み戻せるようにしておく（no-op スタブだと配線を確かめられない）。
    createDiagnosticCollection: name => {
      const store = new Map();
      return {
        name,
        set: (uri, diagnostics) => store.set(uri.fsPath, diagnostics),
        get: uri => store.get(uri.fsPath),
        delete: uri => store.delete(uri.fsPath),
        clear: () => store.clear(),
        dispose() {}
      };
    }
  },
  commands: {
    // 配線（コマンド登録 → プレビューを開く）を通すための最小の実装。
    registered: new Map(),
    registerCommand(id, handler) {
      vscode.commands.registered.set(id, handler);
      return { dispose() {} };
    },
    executeCommand(id, ...args) {
      const handler = vscode.commands.registered.get(id);
      return handler ? handler(...args) : undefined;
    }
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  EndOfLine: { LF: 1, CRLF: 2 },
  ViewColumn: { One: 1, Beside: -2 },
  Selection: class { constructor(anchor, active) { this.anchor = anchor; this.active = active; } },
  WorkspaceEdit: class {
    constructor() { this.edits = []; }
    replace(uri, range, text) { this.edits.push({ uri, range, text }); }
  },
  ConfigurationTarget: { Global: 1 },
  FileType: { File: 1, Directory: 2 }
};

const load = Module._load;
Module._load = function (request, ...rest) {
  return request === "vscode" ? vscode : load.call(this, request, ...rest);
};
