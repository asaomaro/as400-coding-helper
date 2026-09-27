# レビュー記録

## ラウンド 1（2026-09-27）

CHECK: ok / FINDINGS: 0
- 要件適合: AC1〜AC3 を確認。
- 正確性: 型・使用の一覧は F4 プロンプターの定義（原典から生成）をそのまま使う。小数は数値の型（画面 S/Y/N/D/F、帳票 S/F）のときだけ聞く。
  使用を明示で空白にしたときは空白のまま書く（core の既定 B は「使用を聞かなかった」ときだけ）。
- 残り: VS Code 版の QuickPick の操作は本物の VS Code では押していない（ホストの入力手段だけの差で、一覧と既定は共有）。

## ラウンド 2（2026-09-27）

CHECK: ok / FINDINGS: 1（直した）
- 最初の版は `src/core/dds/fieldChoices.ts` で `resources/prompter/dds/ja/*.json` を import しており、tsc が出力先（`out/`・`out-test/`）に
  `resources/prompter/` の一部だけを写した。定義を相対パスで探すコード（lint・RPG III の数値欄の検査など）がその一部を読み、単体テストが 40 件落ちた
  （コミット前の確認で `head` が要約行を切っていて見落とした）。配布物でも同じことが起きる。
  → 定義は呼び出し側が渡す形に直した（VS Code 版は拡張の `resources/` から読む、単独起動は束ねた JSON）。
  src が `resources/prompter` の JSON を import しないことを見張るテストを足した。
