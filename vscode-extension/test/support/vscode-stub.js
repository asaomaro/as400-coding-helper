// vscode API のスタブ。ユニットテストは拡張機能ホストを起こさずに動かす。
// 実物が要るもの（WebView・装飾の描画）は integration 側で見る。
const Module = require("node:module");

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
  constructor(start, end) { this.start = start; this.end = end; }
}

const vscode = {
  Position,
  Range,
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
    getConfiguration: () => ({ get: () => undefined }),
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
