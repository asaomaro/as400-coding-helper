import * as vscode from "vscode";

/**
 * 対象拡張子を **用途ごとに**定義する。先頭ドットなし・小文字（AGENTS.md の指定に一致）。
 *
 * ここを単一の真実源とし、DocumentSelector の glob もキーバインドの発火条件も
 * すべてここから導く。以前は各所で `**\/*.{pf,lf,dspf,prtf,mnudds}` のように
 * glob を手書きしており、実際に `.dds` が DDS キーワード補完から漏れていた。
 */

/** RPG（固定長）。ILE と RPG III、SQL 組み込み版。 */
export const RPG_EXTENSIONS = [
  "rpg",       // RPG III / RPG400
  "rpgle",     // ILE RPG
  "sqlrpgle",  // SQL 組み込み ILE RPG
  "sqlrpg"     // SQL 組み込み RPG III
] as const;

/** CL。OPM と ILE。 */
export const CL_EXTENSIONS = [
  "clp",       // OPM CL
  "clle"       // ILE CL
] as const;

/**
 * DDS。実務ではオブジェクトの種類ごとに拡張子が分かれ、`.dds` というファイルは作らない。
 * `.dds` を残しているのは、そう名付ける環境への保険。
 */
export const DDS_EXTENSIONS = [
  "pf",        // 物理ファイル
  "lf",        // 論理ファイル
  "dspf",      // 画面ファイル
  "prtf",      // 印刷ファイル
  "mnudds",    // メニュー（DSPF と同じ A 仕様書の固定長）
  "dds"        // `.dds` と名付ける環境への保険
] as const;

/** コマンド定義ソース（CL コマンドではなく CMD/PARM/ELEM/QUAL/DEP/PMTCTL）。 */
export const CMD_EXTENSIONS = [
  "cmd"
] as const;

/**
 * ルーラー表示・制御コード(SOSI)表示などの入力補助機能の対象とする拡張子。
 * 用途別の集合の合成として定義する（片方だけ増えることが構造的に起きないように）。
 */
export const TARGET_EXTENSIONS = [
  ...RPG_EXTENSIONS,
  ...CL_EXTENSIONS,
  ...DDS_EXTENSIONS,
  ...CMD_EXTENSIONS
] as const;

const TARGET_LANGUAGE_IDS = ["rpg-fixed", "cl"];

/**
 * `**\/*.{pf,lf,...}` 形式の glob を作る。DocumentSelector の pattern に使う。
 *
 * 拡張子が 1 個のときは波括弧を付けない。候補が 1 つだけの brace group
 * （`{cmd}`）を展開せず**リテラルとして扱う** glob 実装があり、そうなると
 * どの文書にも一致せず機能が丸ごと死ぬ。安全側に倒す。
 */
export function toGlobPattern(extensions: readonly string[]): string {
  if (extensions.length === 0) {
    // 空集合に対応する glob は無い。`**/*.{}` は意味が定まらないので返さない。
    // 呼び出し側の組み立て誤りなので、何にも一致しないことが明らかな形にする。
    return "**/*.__none__";
  }

  // 大小文字は**ここでは扱わない**。VSCode の glob は大小を区別し、実機から取り出した
  // メンバー名は大文字（`CUSTMST.PF`）になるが、これは本 PJ 全体の課題であって
  // アウトラインだけの話ではない。`package.json` の keybindings（F4）は
  // `resourceExtname == .pf` と小文字固定、`ruler.ts` の glob も小文字のみ。
  // ここだけ大文字を足すと「アウトラインは出るが F4 とルーラーは効かない」という
  // 別の食い違いになる（実際に一度そうした）。直すなら keybindings・ruler・
  // verify-contributes をまとめて揃える必要があり、本作業の範囲外。
  if (extensions.length === 1) {
    return `**/*.${extensions[0]}`;
  }
  return `**/*.{${extensions.join(",")}}`;
}

/**
 * 拡張子集合から DocumentSelector を作る。
 *
 * `file` に加えて `untitled` も対象にする。保存前の新規ファイルでも入力補助が効くように
 * （既存の DDS キーワード補完がそうしている）。
 */
export function toDocumentSelector(
  extensions: readonly string[]
): vscode.DocumentFilter[] {
  // 空集合なら何も登録しない（誤って全ファイルに効く形にしない）。
  if (extensions.length === 0) {
    return [];
  }

  const pattern = toGlobPattern(extensions);
  return [
    { scheme: "file", pattern },
    { scheme: "untitled", pattern }
  ];
}

function hasTargetExtension(fsPath: string): boolean {
  const lower = fsPath.toLowerCase();
  return TARGET_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`));
}

export function isInScopeDocument(document: vscode.TextDocument): boolean {
  if (TARGET_LANGUAGE_IDS.includes(document.languageId)) {
    return true;
  }

  return hasTargetExtension(document.uri.fsPath);
}

export function isInScopeUri(uri: vscode.Uri): boolean {
  return hasTargetExtension(uri.fsPath);
}
