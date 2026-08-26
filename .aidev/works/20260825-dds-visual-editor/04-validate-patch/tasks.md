# タスク: 04-validate-patch

- [x] T1: 診断の型を定義する（`Diagnostic`）。**重大度は `error` / `warning` の 2 段**。コード（`DDS7101` 桁溢れ / `DDS7102` 重なり / `DDS7103` 属性バイト隣接 等）・対象アイテム ID・ソース行番号を持たせる
      対象: `packages/dds-core/src/dds/validate.ts`（新規） / 根拠: spec「インターフェース / RenderDiagnostic」, design DD9
- [x] T3: **実機で DBCS 要素の隣接規則を確認する**（spec D7 の未確定事項）。日本語定数の直後にフィールドを置き、SO/SI が桁を消費することと属性バイトの相互作用を `CRTDSPF` の警告有無で確定させる。**確認後に実機の後片付けをする**
      対象: 実機 `SR-OSAKA` の `ASAOLIB`（一時オブジェクト） / 根拠: spec D7「未確定として残るもの」, 本 plan R2
- [x] T2: `dds/validate.ts` を実装する。**桁溢れ**（データ範囲が行幅超過＝エラー。**属性バイトは含めない**）・**行範囲外**（エラー）・**長さ欄に収まらない**（エラー）・**隣接違反**（`b1 < a2 + 2`＝**警告**）。要素の幅はフィールドが `length`、定数が `displayWidth(text)`（依存: T1, T3）
      対象: `packages/dds-core/src/dds/validate.ts` / 根拠: spec D7（実機で確定した規則）, 本 plan「検証規則」
- [x] T4: `patch/ops.ts` に `PatchOp` の型を定義する（`moveItem` / `resizeItem` / `addItem` / `removeItem` の 4 種）。**GUI の L1 操作とこの 4 種が 1:1 対応する**ことを型のコメントで明示する（AC4 を構造で保証する要）
      対象: `packages/dds-core/src/patch/ops.ts`（新規） / 根拠: spec「インターフェース / パッチ操作」, requirement AC4
- [x] T5: `moveItem` / `resizeItem` を実装する。行(39-41)・桁(42-44)・長さ(30-34)を `rewriteLine` 経由で差し替える。**構造を変えないので ID は不変**（依存: T4）
      対象: `packages/dds-core/src/patch/ops.ts` / 参照: `packages/dds-core/src/dds/serialize.ts` `rewriteLine` / 根拠: spec D2
- [x] T6: `addItem` / `removeItem` を実装する。挿入位置は**レコード様式の末尾**とし、**継続行（opaque）の途中に割り込まない**。削除は該当行を取り除く（依存: T4）
      対象: `packages/dds-core/src/patch/ops.ts` / 根拠: 本 plan R4
- [x] T7: **エラー級の違反だけパッチを拒否する**。隣接違反などの警告では**拒否しない**（実機がコンパイルを通すため。spec D7）。拒否は適用前に行う（依存: T2, T5, T6）
      対象: `packages/dds-core/src/patch/ops.ts` / 根拠: spec D7「実装への影響」, 本 plan R1
- [x] T8: **部分適用しないことを保証する**。複数操作のうち 1 つでも拒否されたら、**何も適用せずに終わる**（依存: T7）
      対象: `packages/dds-core/src/patch/ops.ts` / 根拠: spec「エラー処理」
- [x] T9: `applyOps` が**変更行範囲（`changedLines`）を返す**ようにする。VSCode 側が `WorkspaceEdit` を全文置換ではなく範囲置換にするために要る。構造変更時は挿入位置から末尾までを範囲とする（依存: T8）
      対象: `packages/dds-core/src/patch/ops.ts` / 根拠: design DD6
- [x] T10: テストを書く。**spec D7 の実測表 8 ケースをそのまま隣接規則のテストにする**。加えて桁溢れ／重大度（警告ではパッチが拒否されない）／4 操作それぞれ／部分適用しない／**ID の安定性（move 後は不変・remove 後は振り直し）**／`changedLines`（依存: T9）
      対象: `packages/dds-core/test/validate.test.ts`・`packages/dds-core/test/patch.test.ts`（新規） / 根拠: 本 plan「テスト方針」
- [x] T11: `dds/validate` と `patch/ops` を `dds-core` の公開 API として re-export する（依存: T9）
      対象: `packages/dds-core/src/index.ts` / 根拠: spec「対象範囲」
