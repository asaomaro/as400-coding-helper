# 決定記録

## D1: 純粋性の担保を「tsconfig 分割」から「TypeScript コンパイラ API による import 抽出」に変える

- 背景: `design.md` の D6 は、`types` から `"vscode"` を外した `tsconfig.core.json` で
  コンパイルが落ちることをもって、`src/core` / `src/lint` / `src/cli` が vscode に
  依存していないことを担保する設計だった。T5 で実装して**違反コードを置いて確かめたところ、
  検査が素通りした**（`import * as vscode from "vscode"` を `src/core/dialect.ts` に
  足しても `tsc -p tsconfig.core.json` が exit 0 のまま）。
- 決定: `tsconfig.core.json` を廃止し、`scripts/verify-lint-core.mjs` が
  TypeScript の `ts.preProcessFile()` で import 指定子を構文的に取り出して
  `"vscode"` を弾く方式に変える。拡張子の部分集合検査（T6）も同じスクリプトに入れる。
- 理由 / 代替案:
  - **なぜ効かなかったか**: `compilerOptions.types` は *グローバル型の自動読み込み* の
    対象を絞るだけで、`import "vscode"` の**モジュール解決を止めない**。
    TypeScript は通常の node 解決で `node_modules/@types/vscode/index.d.ts` に到達する。
    `--listFiles` で実際に読み込まれていることを確認した。
  - `typeRoots` を絞る案 → `types: ["node"]` の解決自体が壊れ `TS2688` になる。
  - `paths` で `"vscode"` を存在しないパスに向ける案 → 解決に失敗すると
    通常の node 解決へ**フォールバックする**ため塞げない（実測で exit 0）。
  - grep 案 → コメントや文字列中の `"vscode"` を誤検出し、複数行 import を取りこぼす。
    `verify-contributes.mjs` がソースを正規表現で読んでいる脆さを繰り返したくない。
  - 採用案は `typescript`（既に devDependency）の公式 API を使うので**新たな依存が無く**、
    構文的に正確。違反あり／コメント中の誤検出なし／拡張子違反の 3 ケースで
    期待どおり動くことを確認済み。
- 影響: `spec.md` の受け入れ基準「`vscode` を import せずに動作する（機械的に検査できる形で担保）」は
  満たす。担保の**手段**が変わっただけで基準は変わらない。
  `tasks.md` の T5 は「`tsconfig.core.json` を追加」から「`verify-lint-core.mjs` に純粋性検査を実装」へ
  読み替える。T6 と実質統合され、CI（T22）に足すコマンドは 1 本になる。
  `design.md` D6 の記述は**誤り**なので、review で design を参照する際は本記録を優先すること。

## D2: 定義の resources ディレクトリを相対の段数ではなく上位探索で解決する

- 背景: `defaultResourcesDir` を `join(moduleDir, "..", "..", "resources")` と
  決め打ちにしていた。`out/lint/` からは正しいが、テストのビルド出力は
  `out-test/src/lint/` で **1 段深い**ため `out-test/resources` を指し、定義が
  1 つも読めなくなる。しかも `loadDefinitions` は読めない定義を「無い」ものとして
  扱うので**例外にならず指摘ゼロ**になり、「検査が通った」と区別が付かない。
  T20 のテストを書いて初めて気付いた（CLI 経路では正しく動いていたため）。
- 決定: `resources/prompter` が見つかるまで上位ディレクトリを辿って解決する。
- 理由 / 代替案: テスト用に段数を変える／テストからパスを明示的に渡す、でも通せるが、
  どちらも**製品コードの脆さを残したまま**テストだけ通す形になる。ビルド配置が
  変わった時に同じ黙った壊れ方をする。探索にすれば配置に依存しない。
- 影響: `lintCorpus.test.ts` に 3 件の回帰テストを追加した
  （resources が見つかること／主要な定義が実際に引けること／規則が実際に発火すること）。
  最後の 1 件は「検証済みコーパスが指摘ゼロなのは規則が何もしていないからではない」
  ことを示すもので、偽陽性ゼロの主張が空虚でないことの裏づけになる。
