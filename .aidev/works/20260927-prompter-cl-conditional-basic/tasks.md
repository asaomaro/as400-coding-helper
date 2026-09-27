# タスク: CL の条件表示の欄を基本の画面に出す・説明の箇条書きを落とさない（P17）

## タスク
- [x] T1: `generate-cdml-rules.mjs` で `PmtCtl="PMTCTL"` を `basic` に、`generate-cl-definitions.mjs` で `<ul>` を説明に入れる。作り直して検査。単体テスト。
      対象: `docs/origin/{generate-cdml-rules.mjs,generate-cl-definitions.mjs,cdml-attributes.md}` / `resources/prompter/{cl,cmd}/**` / `test/unit/prompterRegressions.test.ts`
      依存: なし
      AC: AC1, AC2, AC3
