# タスク: 印刷装置 38 桁（使用目的）の値集合を入れる

- [x] T1: `parseDetail` に `<li><samp>X</samp> 意味` の読み方を足し、`addOption` に
      「`X` またはブランク: 意味」（en `X or blank: 意味`）の形を足す。
      対象: `docs/origin/generate-dds-prompter.mjs` の `addOption`（`:146` 付近）と
      `parseDetail` の値の読み取り（`<dt>/<dd>` と表の後）/ 根拠: spec D1 D2
- [x] T2: 実機で印刷装置 38 桁の全 37 通りを判定（対照つき）。
      対象: `.aidev/works/20260829-dds-prtf-usage-values/verify/probe-prtf38.mjs`（新規）。
      解析は `../../20260829-dds-restricted-expand/verify/parse-listing.mjs` を再利用 / 根拠: spec D3
- [x] T3: `PROVEN_COMPLETE` を決めて定義を再生成（依存: T1・T2）。
      対象: `docs/origin/generate-dds-prompter.mjs:PROVEN_COMPLETE` / 根拠: spec D3
- [x] T4: テストを足し、抽出を戻すと落ちることを確かめる（依存: T3）。
      対象: `vscode-extension/test/unit/ddsPositionalValues.test.ts` / 根拠: AC6
- [x] T5: サンプルで指摘 0・`npm test`・`npm run verify`・往復・e2e（依存: T4）。
      対象: `docs/src/` / `vscode-extension/` / 根拠: AC5 AC6
