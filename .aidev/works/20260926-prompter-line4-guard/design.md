# 仕様: RPG ソースの 4 行目にもプロンプターの値を書き戻す

## 設計方針
- `isEditAllowedRange`（FR-031 の判定）は変えない。Tab 移動（`rpgTabNavigation.ts`）も同じ判定を使っており、FR-031 自体は維持する。
- プロンプターの RPG の書き戻し（`applyChanges.ts` の RPG の分岐）で、行全体の置き換えが FR-031 に当たるときは、
  **組み立てた新しい行の 1〜6 桁目が元の行と同じなら、置き換える範囲を 7 桁目以降に狭める**。同じでなければ書かずに通知する。
- 判定は純粋関数 `narrowToEditableColumns(original, updated, protectedColumns)` にして単体テストする（`vscode` 非依存の `commandText.ts` に置く）。
  比較は両方を 6 桁まで空白で埋めてから行う（元の行が 6 桁未満でも比べられるように）。

## 対象範囲
- `vscode-extension/src/prompter/commandText.ts`（`narrowToEditableColumns` を足す）
- `vscode-extension/src/prompter/applyChanges.ts`（RPG の分岐で使う・通知）
- `vscode-extension/test/unit/prompterRegressions.test.ts`（単体テスト）

## 依拠する既存の事実
- `applyChanges.ts:56-75`: RPG/DDS は行全体（0 桁目〜行末）を置き換え、DDS 以外で `isEditAllowedRange` が false なら `console.log` して return する。
- `rpgEditGuards.ts:3-20`: 0 始まりの 3 行目（＝4 行目）で開始桁が 6 未満なら false。
- CL / cmd は `applyChanges.ts:33-53` の分岐で先に return するので、この判定を通らない（CL の 4 行目は元から影響しない）。
- `commandText.ts` は `vscode` を import しない（ファイル先頭の注記）。
