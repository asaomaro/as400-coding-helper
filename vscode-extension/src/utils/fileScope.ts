import * as vscode from "vscode";

/**
 * ルーラー表示・制御コード(SOSI)表示などの入力補助機能の対象とする拡張子。
 * 先頭ドットなし・小文字で定義する（AGENTS.md の指定に一致）。
 *
 * DDS は実務上 `.dds` というファイルを作らず、オブジェクトの種類ごとに
 * `.pf`(物理ファイル) / `.lf`(論理ファイル) / `.dspf`(画面) / `.prtf`(印刷)
 * の拡張子を使う。`.dds` も残しているのは、そう名付ける環境への保険。
 */
export const TARGET_EXTENSIONS = [
  // RPG（固定長）
  "rpg",       // RPG III / RPG400
  "rpgle",     // ILE RPG
  "sqlrpgle",  // SQL 組み込み ILE RPG
  "sqlrpg",    // SQL 組み込み RPG III
  // CL
  "clp",       // OPM CL
  "clle",      // ILE CL
  // DDS（オブジェクトの種類ごとに拡張子が分かれる）
  "pf",        // 物理ファイル
  "lf",        // 論理ファイル
  "dspf",      // 画面ファイル
  "prtf",      // 印刷ファイル
  "mnudds",    // メニュー（DSPF と同じ A 仕様書の固定長）
  "dds",       // `.dds` と名付ける環境への保険
  // その他
  "cmd",       // コマンド定義
] as const;

const TARGET_LANGUAGE_IDS = ["rpg-fixed", "cl"];

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
