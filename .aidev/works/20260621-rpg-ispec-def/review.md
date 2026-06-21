# レビュー記録

## ラウンド 1（2026-06-21・autonomous batch）

対象: `I-SPEC.json`（新規）/ `specClassifier.ts`（新規・共有分類）/ `positionResolver.ts`・`ruler.ts`（重複削除→共有呼び出し）/ backlog の I-SPEC を `[x]`。

- **要件適合**: I-SPEC を原典準拠で新設し、F4 プロンプター配線まで実施（ユーザー承認スコープ）。完了条件を満たす。
- **正確性**: 桁位置が原典 L503-515 と一致（test (c)）。dropdown 無し（I 仕様に固定値列挙が原典に無いため text 採用＝非捏造）。
- **規約適合（AGENTS.md）**: 原典照合を主E直読で実施。**languageId 波及チェック**: 変更は表示(ruler)と
  プロンプター解決(positionResolver)の内部分類のみで、`contributes.languages`・拡張子関連付け・言語登録・診断には不波及。
  分類の単一化はドリフト（F/O/P が ruler だけに入る類の再発）を**構造的に防止**。
- **保守性**: 重複ロジック（classifyCSpec/getCNewOpcodes ×2）を共有モジュールへ集約＝DRY 改善。tsc クリーン。

### 指摘
- [must] なし / [should] なし
- [nit] I-SPEC は1定義で2行種（レコード行/フィールド行）を兼ねるため全欄 required:false（decisions D2）。/ 対応: 許容（行種非破綻を優先）。
- [nit] comment 行（桁7='*'）での F4 は従来 D/C と同様に種別解決し得る（既存挙動）。本変更で対象が H/F/I/O/P に拡大。/ 対応: 許容（既存挙動と一貫・別 follow-up 余地）。

判定: must/should なし → 通過。
