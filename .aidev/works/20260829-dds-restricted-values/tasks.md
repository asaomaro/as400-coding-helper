# タスク: DDS の値集合を原典どおりに直す

- [x] T1: 子ページを manifest に足して日英とも取得する
      対象: `docs/origin/sources.mjs` / `docs/origin/dds{,-en}/FIELD-DSPF-valentries.html`
- [x] T2: `fetch-origin.mjs` の併合の鍵を保存先パスから作る
      対象: `docs/origin/fetch-origin.mjs` の `loadExisting`
- [x] T3: 生成器に「注」「ブランクまたは X」「子ページ」の読み取りを足す（依存: T1）
      対象: `docs/origin/generate-dds-prompter.mjs` の `parseDetail`
- [x] T4: 実機で 38 桁の値を判定する（対照つき）（依存: T3）
      対象: `.aidev/works/20260829-dds-restricted-values/verify/probe-pos38.mjs`
- [x] T5: 原典の誤植（ja の `0`）を置き換えで直す（依存: T4）
      対象: `docs/origin/generate-dds-prompter.mjs` の `ORIGIN_ERRATA`
- [x] T6: 値集合の回帰テストを足し、後退を戻すと落ちることを確かめる（依存: T5）
      対象: `vscode-extension/test/unit/ddsPositionalValues.test.ts`
- [x] T7: backlog を割る（値集合の修復＝済 / `restricted-value` の有効化＝残り）
      対象: `.aidev/backlog/workflow.md`
