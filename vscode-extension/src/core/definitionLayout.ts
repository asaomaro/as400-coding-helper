import type { Dialect, LanguageId } from "../prompter/types";

/**
 * プロンプター定義 JSON の置き場所（レイアウト）の知識。
 *
 * VSCode 側（`prompter/jsonDefinitions.ts`・`vscode.workspace.fs`）と
 * lint core 側（`lint/defsLoader.ts`・`node:fs`）で **I/O は共有できない**が、
 * 「どこに何があるか」は同じでなければならない。その部分だけをここに置く。
 *
 * このモジュールは **vscode を import しない**。表示言語は引数で受け取る。
 */

/** 定義ファイル名はキーワードそのもの（全 288 定義で一致することを検査済み）。 */
export function definitionFileName(keyword: string): string {
  return `${keyword}.json`;
}

/**
 * `resources/prompter/` 配下のサブパスを決める。
 *
 * RPG は方言ごとに分ける。`.cmd` の文は CL コマンドではないので別に置く
 * （混ぜると CL のプロンプターに PARM や QUAL が出てしまう）。DDS も同様に分ける。
 */
export function definitionSubPath(
  language: LanguageId,
  dialect: Dialect | undefined,
  uiLanguage: "ja" | "en"
): string[] {
  if (language === "rpg-fixed") {
    // RPG も言語別に分ける。ただし RPG III は英語原典が無く英語版を作れない
    // ため、読み込み側で日本語版に落ちる（loadDefinition の fallback）。
    return ["rpg", dialect ?? "ile", uiLanguage];
  }
  const kind = language === "cmd" ? "cmd" : language === "dds" ? "dds" : "cl";
  return [kind, uiLanguage];
}
