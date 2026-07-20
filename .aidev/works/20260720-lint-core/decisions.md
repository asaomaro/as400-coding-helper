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
