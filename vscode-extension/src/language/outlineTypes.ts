import * as vscode from "vscode";

/**
 * アウトライン（DocumentSymbol）の共通型。
 *
 * 木の組み立ては vscode に依存させない。`vscode.TextDocument` も
 * `vscode.DocumentSymbol` も使わず、行の読み取り関数と素のオブジェクトだけで完結させる。
 * vscode 依存はこのファイルの `toDocumentSymbols` に閉じる。
 *
 * 理由: 既存の `resolveDdsLevel` が `lineAt: (index) => string` という純粋な形を採っており
 * それに倣うこと、そしてテストで `TextDocument` の偽物を用意せずに済むこと。
 */

export type OutlineKind =
  // DDS
  | "record"
  | "field"
  | "key"
  | "select"
  | "join"
  | "help"
  // .cmd（コマンド定義ソース）
  | "command"
  | "parm"
  | "elem"
  | "qual"
  | "dep"
  | "pmtctl";

/** 0 始まりの行・桁で表す範囲。`vscode.Range` に依存しない。 */
export interface OutlineRange {
  readonly startLine: number;
  readonly startChar: number;
  readonly endLine: number;
  readonly endChar: number;
}

export interface OutlineNode {
  readonly name: string;
  readonly detail: string;
  readonly kind: OutlineKind;
  /** シンボル全体の範囲（子・キーワード継続行を含む）。 */
  readonly range: OutlineRange;
  /** 名前そのものの範囲。必ず `range` に含まれる（VSCode の要件）。 */
  readonly selectionRange: OutlineRange;
  readonly children: OutlineNode[];
}

/**
 * OutlineKind → vscode.SymbolKind。
 *
 * kind は**アウトラインに出るアイコンにしか影響しない**。意味は name と detail が担う。
 * 完全に対応する種別が無いものは、近いものを当てている。
 */
const SYMBOL_KIND: Readonly<Record<OutlineKind, vscode.SymbolKind>> = {
  // DDS
  record: vscode.SymbolKind.Struct,     // レコード様式＝フィールドの集合体
  field: vscode.SymbolKind.Field,
  key: vscode.SymbolKind.Key,           // キー・フィールド（17 桁目 K）
  select: vscode.SymbolKind.Property,   // 選択／省略（S / O）
  join: vscode.SymbolKind.Interface,    // 結合（J）。複数ファイルの関係
  help: vscode.SymbolKind.Object,       // ヘルプ（H）
  // .cmd
  command: vscode.SymbolKind.Module,
  parm: vscode.SymbolKind.Field,
  qual: vscode.SymbolKind.Property,     // 修飾名の構成要素
  elem: vscode.SymbolKind.Variable,     // 要素リストの要素
  dep: vscode.SymbolKind.Event,         // 依存関係の制約
  pmtctl: vscode.SymbolKind.Event       // プロンプト制御の制約
};

export function toSymbolKind(kind: OutlineKind): vscode.SymbolKind {
  return SYMBOL_KIND[kind];
}

function toRange(range: OutlineRange): vscode.Range {
  return new vscode.Range(
    new vscode.Position(range.startLine, range.startChar),
    new vscode.Position(range.endLine, range.endChar)
  );
}

function isBefore(
  aLine: number,
  aChar: number,
  bLine: number,
  bChar: number
): boolean {
  return aLine < bLine || (aLine === bLine && aChar <= bChar);
}

/**
 * 親の range が子を覆うように広げる（再帰的に、葉から順に）。
 *
 * VSCode は **子の range が親の range に含まれていること**を要求する。
 * 満たさないと、パンくず・カーソル追従・sticky scroll が子に解決できなくなる。
 *
 * `.cmd` の ELEM / QUAL は PARM 文とは別の行にあるため、PARM の range を自分の行だけに
 * しておくと必ずこの要件を破る（実際に破っていた）。飛び地になりうるが、
 * containment は VSCode の硬い要件で、兄弟同士の重なりは要件ではない。
 */
export function expandToChildren(node: OutlineNode): OutlineNode {
  const children = node.children.map(expandToChildren);

  let { startLine, startChar, endLine, endChar } = node.range;
  for (const child of children) {
    if (!isBefore(startLine, startChar, child.range.startLine, child.range.startChar)) {
      startLine = child.range.startLine;
      startChar = child.range.startChar;
    }
    if (!isBefore(child.range.endLine, child.range.endChar, endLine, endChar)) {
      endLine = child.range.endLine;
      endChar = child.range.endChar;
    }
  }

  return {
    ...node,
    range: { startLine, startChar, endLine, endChar },
    children
  };
}

/** OutlineNode の木を vscode.DocumentSymbol の木に変換する。 */
export function toDocumentSymbols(
  nodes: readonly OutlineNode[]
): vscode.DocumentSymbol[] {
  return nodes.map(node => {
    const symbol = new vscode.DocumentSymbol(
      node.name,
      node.detail,
      toSymbolKind(node.kind),
      toRange(node.range),
      toRange(node.selectionRange)
    );
    symbol.children = toDocumentSymbols(node.children);
    return symbol;
  });
}

/**
 * 行を読む関数。範囲外の行番号には空文字を返すこと。
 * `resolveDdsLevel` と同じ形にそろえてある。
 */
export type LineReader = (index: number) => string;

/** 文書のテキストから LineReader と行数を作る（テストからも使う）。 */
export function toLineReader(text: string): {
  lineAt: LineReader;
  lineCount: number;
} {
  const lines = text.split(/\r?\n/u);
  return {
    lineAt: index => lines[index] ?? "",
    lineCount: lines.length
  };
}
