# レビュー記録（RPG III 仕様書定義 H/F/I/O）

## ラウンド 1（2026-06-21）

対象: `rpg/rpg3/{H,F,I,O}-SPEC.json`（新設4件）、backlog `rpg3-spec.md` 追記。

### 観点別点検

- **要件適合**: 完了条件①（H/F/I/O 作成・F4ロード可能）②（桁が原典一致）③（backlog 反映）を満たす。
  E/L は原典(rpg010)直読が必要なため backlog `[ ]` で追跡（推測補完しない方針）。
- **正確性（原典準拠・主エージェント直読）**: 桁を rpg002 原典から抽出（research.md）し、各 JSON の
  sourceStart/sourceLength を機械照合 → **52件チェック・不一致0**。F-SPEC は 33-72 桁も rpg002 再精読で確定。
- **規約適合（languageId 波及）**: `package.json`/言語登録/`fileScope.ts` 変更なし（データ追加のみ）。
- **方言整合**: 桁は rpg3 原典値のみ使用（ile からの流用なし）。ile I/O 同様にレコード+フィールドを1定義に統合、
  上級欄は `visibleByDefault:false`、固定値欄（FILETYPE/FILEDESIG/FILEFORMAT/SEQUENCE/O TYPE）は dropdown。
- **構造**: validate-prompter-defs.mjs で 108ファイル全件適合。tsc 非回帰クリーン。

### 指摘

- must=0 / should=0 / nit=0。

### 既知の制約（PR 引き継ぎ）

- F4 実機検証は headless 未実行（ロード可能性で代理担保）。
- 原典は jaymoseley RPG tutorial（PR #42 採用の rpg3 原典）。IBM 一次資料ではないが C-SPEC と同じ採用基準。
- E/L 仕様は rpg010 直読が必要なため本PR対象外（backlog 追跡）。
- I/O のレコード行/フィールド行を1定義に統合（桁が重ならないため。ile と同方針）。RECIDCODE(21-42)・OUTIND(23-31)は
  複合欄として1パラメータに集約（細分化は将来の改善余地）。
