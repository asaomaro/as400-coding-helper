// vscode API のスタブ。ユニットテストは拡張機能ホストを起こさずに動かす。
// 実物が要るもの（WebView・装飾の描画）は integration 側で見る。
const Module = require("node:module");

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
  constructor(start, end) { this.start = start; this.end = end; }
}

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
  languages: {},
  commands: {},
  StatusBarAlignment: { Left: 1, Right: 2 },
  ConfigurationTarget: { Global: 1 },
  FileType: { File: 1, Directory: 2 }
};

const load = Module._load;
Module._load = function (request, ...rest) {
  return request === "vscode" ? vscode : load.call(this, request, ...rest);
};
