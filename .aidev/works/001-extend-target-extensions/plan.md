# 計画: ルーラー/制御コード表示の対象拡張子の拡張

関連 issue: #4 / 前提: spec.md

## 実装方針

spec.md の2つの設計判断に沿って、小さく検証可能な単位で進める。

1. まず `fileScope.ts` の判定ロジックを拡張子リスト一元化の形にリファクタ＋拡張する（コアの振る舞い）。
2. 次に `package.json` で新拡張子を既存言語に関連付け、アクティベーションを担保する。
3. 最後にユニットテストで受け入れ基準（7拡張子真 / 対象外偽 / 既存維持）を固定する。

`fileScope.ts` の変更が他工程の前提になるため最初に行う。package.json は独立しているため並行可能だが順序通りで問題ない。

## 作業順序と依存関係

1. `fileScope.ts`：`TARGET_EXTENSIONS` 定数と `hasTargetExtension` を導入し、両関数を書き換え（依存: なし）
2. `package.json`：新拡張子を `rpg-fixed` / `cl` の `extensions` に追記（依存: なし）
3. ユニットテスト追加：scope 判定の受け入れ基準を検証（依存: 1）

## リスク / 留意点

- **回帰**: 既存 `.rpgle` / `.clp` を必ずリストに残す。テストで担保する。
- **コンパイル**: `as const` 配列の型と `some` の取り回しで型エラーが出ないか `npm run compile` で確認。
- **アクティベーション**: package.json の拡張子関連付けは手動E2Eでしか完全確認できないため、test 工程では「設定が正しく記述されているか」をレビューで担保し、実起動確認は手動確認事項として記録する。

## テスト方針

- `test/unit/` に scope 判定のユニットテストを追加（mocha）。
  - 7拡張子すべて（小文字）で `isInScopeUri` / `isInScopeDocument` が真。
  - 大文字（例 `.DDS`）でも真。
  - 対象外（`.ts`, `.txt`）で偽。
  - 既存 `.rpgle` / `.clp` で真（回帰防止）。
- `npm run compile` が通ること。
- package.json の `extensions` 追記は内容をレビューで確認（実アクティベーションは手動E2E、test工程で要否を判断）。
