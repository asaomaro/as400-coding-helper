# タスク: 03-parse-serialize

- [x] T1: `dds/model.ts` にモデル型を定義する（`DdsDoc` / `DdsLine` / `DdsItem`）。**すべての行が `raw` を持つ**こと、`id` は `${record}#${ordinal}` で採番後に再利用しないこと、`keywords` は未解釈の文字列配列であることを型とコメントで明示する
      対象: `packages/dds-core/src/dds/model.ts`（新規） / 根拠: spec「インターフェース / モデル」, spec D2
- [x] T2: `text/decode.ts` にエンコーディング判定を実装する。BOM → UTF-8 strict → Shift_JIS の順で判定し、いずれも失敗したら UTF-8 非 strict で読んで**警告を返す**（黙って化けさせない）。判定結果（`encoding` / `bom`）を呼び出し側に返す
      対象: `packages/dds-core/src/text/decode.ts`（新規） / 根拠: requirement AC10, spec「エラー処理」, 本 plan「エンコーディング判定」
- [x] T3: DDS 固定長の桁レイアウトを定数化し、行から各欄を切り出すヘルパを作る。**切り出しは `sourceColumnToCharIndex` を通す**（機能欄の DBCS リテラルで添字がずれるため）（依存: T1）
      対象: `packages/dds-core/src/dds/lineLayout.ts`（新規） / 参照: `packages/dds-core/src/text/encoding.ts` / 根拠: research F8（実ソースで確認した桁割り）, 本 plan「桁の切り出しは換算層を通す」
- [x] T4: `dds/serialize.ts` に `serialize(doc)` と `rewriteLine(raw, changes)` を実装する。`serialize` は **`raw` の単なる連結**（整形・正規化を一切しない）。`rewriteLine` は**指定桁範囲だけを差し替え**、右端超過を拒否する。改行コード・BOM・最終行の改行有無を保持する（依存: T1）
      対象: `packages/dds-core/src/dds/serialize.ts`（新規） / 根拠: spec D2, 本 plan R1・R2・R3
- [x] T5: `dds/parse.ts` を実装する。行を `opaque` / `record` / `item` に分類してモデルを組む。コメント行（7 桁目 `*`）・継続行・空行・未知の form type は **`opaque` として素通し**する。`raw` は必ず保持する（依存: T2, T3）
      対象: `packages/dds-core/src/dds/parse.ts`（新規） / 根拠: spec D2, 本 plan R6
- [x] T6: **往復バイト不変のテスト（AC2・最重要）**。代表 DDS を `parse` → `serialize` して**元と 1 バイトも違わない**ことを確認する。文字列比較ではなく**バイト列比較**で行う（改行・BOM・行末空白の差を取り逃がさないため）（依存: T4, T5）
      対象: `packages/dds-core/test/roundtrip.test.ts`（新規） / 根拠: requirement AC2, 本 plan「テスト方針」
- [x] T7: **opaque 保持のテスト（AC3）**。コメント行・継続行・未対応キーワード・空行を含む DDS で、往復後にそれらが残っていることを確認する（依存: T5, T6）
      対象: `packages/dds-core/test/roundtrip.test.ts` / 根拠: requirement AC3
- [x] T8: **両エンコーディングのテスト（AC10）**。同一内容の UTF-8 版と Shift_JIS 版から**同一のモデル**が得られ、判定結果（`encoding`）が正しいことを確認する。判定不能ケースで警告が返ることも確認する（依存: T2）
      対象: `packages/dds-core/test/decode.test.ts`（新規） / 根拠: requirement AC10, 本 plan R4・R5
- [x] T9: **DBCS を含む行の切り出しテスト**。機能欄に日本語定数を持つ行で、リテラルの範囲と表示桁が正しく取れることを確認する（02-encoding の換算を通していることの検証）（依存: T3, T5）
      対象: `packages/dds-core/test/parse.test.ts`（新規） / 根拠: 本 plan「桁の切り出しは換算層を通す」
- [x] T10: フィクスチャを整備する。**自作の DDS**（DBCS を含むもの・コメント/継続行を含むもの・CRLF 版と LF 版）を用意する。加えて**実機 `ASAOLIB/QDDSSRC` の実メンバを 1 本フィクスチャに取り込むかをユーザーに確認する**（実世界の雑多な DDS で往復不変を試せる価値が大きいため。無断では取り込まない）（依存: T6）
      対象: `packages/dds-core/test/fixtures/`（新規） / 根拠: research F15（実機に DSPF 15 本）, requirement「フィクスチャ 0 件」
- [x] T11: `dds/model` `dds/parse` `dds/serialize` `text/decode` を `dds-core` の公開 API として re-export する（依存: T4, T5）
      対象: `packages/dds-core/src/index.ts` / 根拠: spec「対象範囲」
