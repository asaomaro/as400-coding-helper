# 仕様: ルーラー/制御コード表示の対象拡張子の拡張

関連 issue: #4 / 前提: requirement.md

## 概要

対象拡張子判定を `rpg, rpgle, clp, dds, dspf, prtf, cmd` に拡張する。
拡張子リストを `fileScope.ts` に単一の定数として持ち、`isInScopeDocument` / `isInScopeUri` の双方が
それを参照する。あわせて、新拡張子ファイルを開いた際に拡張機能がアクティベートされるよう
`package.json` のアクティベーション/言語登録を見直す。

## 設計方針

### 1. 拡張子リストの一元化（fileScope.ts）

`fileScope.ts` に対象拡張子の定数と判定ヘルパーを定義し、二重定義を排除する。

```ts
export const TARGET_EXTENSIONS = [
  "rpg", "rpgle", "clp", "dds", "dspf", "prtf", "cmd",
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
```

- 拡張子判定は `.${ext}` で行い、`toLowerCase` で大文字小文字非依存（既存挙動踏襲）。
- languageId 判定（`rpg-fixed` / `cl`）は維持。

### 2. アクティベーションの担保（package.json）

現状 `activationEvents` は `onLanguage:rpg-fixed` / `onLanguage:cl` のみ。
このままでは新拡張子（rpg/dds/dspf/prtf/cmd）を開いても拡張機能が起動せず、
ルーラー/SOSI 表示が動かない。これを解決するため、**新拡張子を既存言語の `extensions` に関連付ける**。

| 拡張子 | 割り当て言語 | 理由 |
|--------|-------------|------|
| `.rpg` | `rpg-fixed` | 固定長 RPG。既存 RPG 文法が妥当 |
| `.dds`, `.dspf`, `.prtf` | `rpg-fixed` | 固定長フォーマット系。専用文法は未整備のため当面 RPG 言語に同居（構文ハイライトの厳密性は本 issue のスコープ外） |
| `.cmd` | `cl` | コマンド定義系。CL ファミリに同居 |

`package.json` の `contributes.languages[].extensions` に上記を追記する。
`onLanguage:rpg-fixed` / `onLanguage:cl` のアクティベーションが新拡張子にも波及するため、
`activationEvents` の追記は不要。

> 代替案: 新拡張子ごとに独立した languageId を新設する案もあるが、文法・設定ファイルの新規作成が必要で
> 本 issue（表示系の有効範囲拡大）に対して過剰。よって既存言語への関連付けを採用する。

## 対象範囲

- `vscode-extension/src/utils/fileScope.ts`（判定ロジック）
- `vscode-extension/package.json`（`contributes.languages[].extensions`）

## インターフェース / データ構造

- `TARGET_EXTENSIONS: readonly string[]`（公開定数。拡張子は先頭ドット無し小文字）
- `isInScopeDocument(document)` / `isInScopeUri(uri)`：シグネチャ変更なし（後方互換）

## 振る舞いの詳細

- `foo.DDS`（大文字）/ `bar.prtf` などで scope 判定が真。
- `baz.ts` / `note.txt` は偽（従来どおり）。
- 既存 `.rpgle` / `.clp` は真のまま（回帰なし）。
- `dbcsShiftMarkers.ts` / `diagnostics.ts` は `isInScopeDocument` 経由で自動的に新拡張子に波及。

## AS400 固有の考慮

- 対象拡張子は AGENTS.md 指定の `rpg, rpgle, clp, dds, dspf, prtf, cmd` に一致させる。
- DDS/PRTF/CMD 専用の桁位置定義・構文解析は本 issue のスコープ外（表示有効範囲の拡大のみ）。

## エラー処理 / 異常系

- 拡張子なしパス・大文字混在も `toLowerCase` + `endsWith` で安全に判定（例外なし）。

## 受け入れ基準との対応

| requirement の完了条件 | 本仕様での満たし方 |
|---|---|
| 7拡張子（大文字含む）で真 | `TARGET_EXTENSIONS` + `hasTargetExtension`（toLowerCase） |
| 対象外拡張子は偽 | リスト外は `some` が偽を返す |
| 既存 .rpgle/.clp 維持 | リストに継続して含める＋languageId 判定維持 |
| 両関数が同一定義を参照 | `hasTargetExtension` を両者が呼ぶ |
| （追加）新拡張子で機能が実起動 | package.json で既存言語に拡張子関連付け＝onLanguage 起動 |
