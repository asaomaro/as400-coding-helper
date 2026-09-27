# タスク: CL の文字ストリングを引用符で囲む・折り返しを実機の桁で数える

## タスク
- [x] T1: CDML の `Type="CHAR"` を `attributes.characterString` として定義に入れ（生成スクリプト）、書き戻しで囲む。折り返しを `printWidth` で判定する。単体テストと実機。
      対象: `docs/origin/{generate-cdml-rules.mjs,cdml-attributes.md}` / `resources/prompter/{cl,cmd}/**` / `src/prompter/{types,commandText}.ts` / テスト / `verify/`
      依存: なし
      AC: AC1, AC2, AC3, AC4
