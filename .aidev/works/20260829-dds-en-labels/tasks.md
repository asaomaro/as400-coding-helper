# タスク: 英語版 DDS 定義から日本語を無くす

- [x] T1: `generate-dds-columns.mjs` に**英語のリンク抽出**を足し、補完ラベル
      （`順序番号`/`仕様書タイプ`/`注記`/`キーワード項目`）を言語で切り替える。
      **日本語の経路は触らない**。
      対象: `docs/origin/generate-dds-columns.mjs` の `ENTRY`（`:57` 付近）・
      `parseColumns`（`:65`）・補完（`:105`-`:120`）/ 根拠: spec D1 D2
- [x] T2: `--lang=en` で `dds-{keyword-columns,field-labels}.en.json` を生成し、
      **開始桁の配列が日本語版と一致**することを確かめる（依存: T1）。
      対象: `vscode-extension/resources/navigation/`（新規 2 ファイル）/ 根拠: AC3
- [x] T3: `generate-dds-prompter.mjs` を言語対応にする（依存: T2）。種別名・ファイル説明・
      桁の書き方・ブランクの接頭辞・値ラベルの括弧、および `dds-field-labels.en.json` の読み込み。
      対象: `docs/origin/generate-dds-prompter.mjs` の `TYPES`（`:36`）・
      `addBlank`/`addOption`・`labels` の読み込み（`:415`）・`description`（`:450`）・
      ファイル定義（`:483`）/ 根拠: spec D3
- [x] T4: `verify-dds-prompter.mjs` に**英語版の日本語混入**と**桁の日英一致**の検査を足す（依存: T3）。
      対象: `docs/origin/verify-dds-prompter.mjs` / 根拠: spec D4
- [x] T5: 再生成・テスト・**日本語版に差分が出ないこと**・戻すと落ちること（依存: T4）。
      対象: `vscode-extension/` 一式 / 根拠: AC4 AC5 AC6
