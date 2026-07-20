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
    file: fsPath => ({ fsPath, scheme: "file", toString: () => fsPath }),
    joinPath: (base, ...parts) => ({
      fsPath: [base.fsPath, ...parts].join("/"),
      toString: () => [base.fsPath, ...parts].join("/")
    })
  },
  EventEmitter: class {
    constructor() { this.event = () => ({ dispose() {} }); }
    fire() {}
    dispose() {}
  },
  workspace: {
    getConfiguration: section => ({
      get: key => configValues[section]?.[key]
    }),
    workspaceFolders: undefined,
    getWorkspaceFolder: () => undefined
  },
  window: { activeTextEditor: undefined, visibleTextEditors: [] },
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
  commands: {},
  StatusBarAlignment: { Left: 1, Right: 2 },
  ConfigurationTarget: { Global: 1 },
  FileType: { File: 1, Directory: 2 }
};

const load = Module._load;
Module._load = function (request, ...rest) {
  return request === "vscode" ? vscode : load.call(this, request, ...rest);
};
