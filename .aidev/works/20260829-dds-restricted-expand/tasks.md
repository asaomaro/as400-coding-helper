# タスク: DDS 定位置欄の値集合を実機で網羅し、`restricted` を広げる

## 原典側の修復

- [x] T1: `addNoteDataTypes` を「`DBCS` を含む注」まで緩め、**すべての注**を見る（`exec` → `matchAll`）。
      前置きの語（`データ・タイプ` / `The data types`）を必須にしない。
      確認: 印刷装置 35 桁に `G` `O` が入り、他の欄の値が**増減しない**こと。
      対象: `docs/origin/generate-dds-prompter.mjs:188` `addNoteDataTypes`（正規表現は `:190`）
      / 根拠: research F6・spec D3

- [x] T2: `verify-dds-prompter.mjs` に **ja / en の値集合一致**を足す（ラベルは訳文なので比べない。
      同じ `sourceStart` の欄の `options[].value` の集合が一致すること）。
      対象: `docs/origin/verify-dds-prompter.mjs:26`（`for (const lang of ["ja","en"])` の後に横断検査を追加）
      / 根拠: research（検査の穴）・spec D8

## 実機側の観測

- [x] T3: 網羅プローブを書く。一括 7 本（PF 17/35/38・DSPF 17/35・PRTF 17/35）＋
      **種別ごとの健全性の対照**（通ると分かっている最小形が作成できること）＋
      17 桁の**単独確認**。`DLTSPLF` を持たせない。`CRTPF` は `DLTF` → `CRTPF`。
      対象: `.aidev/works/20260829-dds-restricted-expand/verify/probe-exhaustive.mjs`（新規）。
      雛形は `verify/probe-research.mjs`、解析は `verify/parse-listing.mjs`（実装済み）
      / 根拠: research A10 A11・spec D5 D9

- [x] T4: 実機に流し、欄ごとに**受理集合 / 無効集合**を確定する（依存: T3）。
      対照が期待どおりでない欄は**結果を採らない**。生のリストを `verify/` に残す。
      対象: `verify/exhaustive-*.txt` `verify/exhaustive-report.json`（新規）
      / 根拠: spec「実機に流す一覧」

## 突き合わせと反映

- [x] T5: `BLANK_FROM_PROSE` を新設し、**原典の引用と実機の判定の両方**が揃った欄にだけ
      ブランクを足す（依存: T1・T4）。本文の解析はしない。
      対象: `docs/origin/generate-dds-prompter.mjs`（`ORIGIN_ERRATA` の直前 `:113` あたりに新設、
      適用は `parseDetail` の返り値に対して `:246` 以降）
      / 根拠: research F7・spec D4

- [x] T6: `PROVEN_COMPLETE` を決めて定義を再生成する（依存: T5）。
      入れるのは **対照が期待どおり ＋ 受理集合と `options` が完全一致**の欄だけ。
      不一致の欄は `false` のままにし、**欄ごとの理由を表のコメントに書く**。
      JSON は手で直さない。
      対象: `docs/origin/generate-dds-prompter.mjs:111` `PROVEN_COMPLETE`（表のコメントごと更新）
      → `vscode-extension/resources/prompter/dds/{ja,en}/DDS-{PF,DSPF,PRTF}.json` を再生成
      / 根拠: research A1 A4・spec D6

- [x] T7: `docs/src` の全サンプルに lint をかけ、**`restricted-value` の指摘が 0 件**であることと
      他の規則の指摘が増えていないことを確かめる（依存: T6）。
      1 件でも出たらその欄を `PROVEN_COMPLETE` から外す。
      対象: `docs/src/`（11 件。DDS は `CUSTMST.pf` `CUSTLF1.lf` `DBCSSAMP.pf`
      `CUSTMNT.dspf` `CUSTRPT.prtf`）/ lint CLI は `vscode-extension/src/lint/`
      / 根拠: spec D6 条件 3・AC5

## 検証

- [x] T8: テストを更新する（依存: T7）。値集合・`restricted: true` の一覧・
      `false` のままの一覧・**実機が無効とした文字での発火**・サンプル 0 件。
      **足したら、直す前の状態に戻して落ちることを確かめる**
      （`PROVEN_COMPLETE` を戻す / 注の正規表現を戻す の 2 通り）。
      対象: `vscode-extension/test/unit/ddsPositionalValues.test.ts:112`（suite「DDS の restricted-value」）、
      `:134`（true の一覧）、`:148`（false の一覧）
      / 根拠: research A9・spec AC4 AC6

- [x] T9: `npm test` 全通過・`npm run verify` 全 OK・`verify-prompter-roundtrip.mjs` 通過を確かめる（依存: T8）。
      **改名・削除をしていなくても `rm -rf out out-test` してから走らせる**（二重実行の予防）。
      プロンプターで `true` にした欄が `<select>` になり**ブランクが選べる**ことを
      `dev/prompter-e2e.mjs` で見る（AC-I1〜I5）。
      対象: `vscode-extension/`（`npm test`）/ `docs/origin/verify-*.mjs` /
      `scripts/verify-prompter-roundtrip.mjs` / `dev/prompter-e2e.mjs`
      / 根拠: spec AC7 AC8 AC-I

- [x] T10: 実機の片付けと `verify/results.md` の仕上げ（依存: T4、最後に書く）。
      オブジェクト・メンバー・ソース物理ファイル・IFS を消して**残数 0 を確認**する。
      **スプールは消さない**——作った名前と番号を `results.md` に記録する。
      欄ごとの判定表（受理 / 無効 / 対照の結果）と、**採らなかった欄の理由**を書く。
      対象: `.aidev/works/20260829-dds-restricted-expand/verify/results.md`（新規）
      / 根拠: spec D9・AC1 AC9 AC10
