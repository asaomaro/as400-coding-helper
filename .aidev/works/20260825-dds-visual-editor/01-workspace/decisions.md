# 決定記録

## D1: 拡張を esbuild でバンドルし、`main` を `dist/extension.js` に変更した

- 背景: T4 で `@as400/dds-core` を依存に足したところ、**T8 の VSIX 生成が壊れた**。
  npm workspaces の依存は `node_modules/@as400/dds-core` の symlink になり、`vsce` がこれをたどって
  リポジトリ全体（`../ (1983 files) 20.44 MB`）を VSIX に取り込もうとし、
  `ERROR invalid relative path: extension/../rpg-cl-vscode-support-0.0.1.vsix` で失敗した（親 plan R5 の的中）。
- 決定: `esbuild` を devDependency に加え、`vscode-extension/esbuild.mjs` で
  `src/extension/extension.ts` → `dist/extension.js` に単一ファイル化する。`main` を `./dist/extension.js` に変更し、
  `vsce package --no-dependencies` で梱包する。`vscode` だけ external（実行時に拡張ホストが供給する）。
- 理由 / 代替案: 代替は (a) 依存を 02-encoding まで先送りする、(b) コアのソースを拡張の tsconfig に直接含める。
  (a) は 02 で同じ壁に必ず当たる。**土台を作るのが 01 の役目**なので先送りは筋が悪い。
  (b) はパッケージ境界（AC9 の根拠）を壊す。
  加えて `vsce` 自身が「2920 ファイルは多い。bundle せよ」と警告しており、**バンドルは元々あるべき状態**だった。
  結果、VSIX は **122 ファイル / 205 KB** に収まった。
- 影響: `tasks.md` に無い作業を追加した（T8 の「VSIX が生成できることを確認する」を満たすために必要だった）。
  `package.json` の `main` 変更は spec「対象範囲」に未記載のため、**review で確認が要る**。
  `out/` は配布物ではなくなり、型検査と開発用の中間生成物になった（→ D6）。

## D2: 既存テストを unit / integration に再配置した

- 背景: T4 で初めてテストが型検査・実行されるようになり、`test/unit/` の 2 本が
  **推移的に `vscode` を要求する**ことが判明した。`editingBehaviors.test.ts` は直接 import、
  `dialect.test.ts` は `src/prompter/dialect`（`vscode` 依存）経由。いずれも Node 単体では
  `MODULE_NOT_FOUND` で落ちる。
- 決定: 両者を `test/integration/` へ移し、`test/unit/` は **Node だけで走るもの**に限定した。
  `npm test` は unit のみを実行し、`npm run test:integration` を別スクリプトにした（CI には載せない）。
- 理由 / 代替案: 代替は `src/prompter/dialect.ts` から純粋部分を切り出すリファクタだが、
  **01-workspace の範囲を超える**（振る舞い不変とはいえ既存モジュールの構造変更）。
- 影響: `test/unit` に残ったのは `prompterModel` と `sample` の 2 本のみ。
  **拡張本体は 29 ファイル中 25 が `vscode` を import しているため、Node で走る単体テストはほとんど書けない。**
  これは `dds-core` を `vscode` 非依存に保つ価値（AC9）を裏側から裏付ける事実で、retro / insights 向けに記録する。

## D3: `tsconfig.json` の `include` に `test` を足さず、`tsconfig.test.json` を別立てにした

- 背景: T4 は「`tsconfig.json` の `include` に `test` を追加」と書かれていたが、本体の `tsconfig.json` は
  `rootDir: "./src"` を持つ。ここに `test/` を足すと rootDir 違反になり、回避のため `rootDir` を広げると
  `outDir` の階層が変わって `main` と VSIX の同梱物が壊れる。
- 決定: `vscode-extension/tsconfig.test.json` を新設し、`rootDir: "."` / `outDir: "./out-test"` で
  `src` と `test` を型検査する。本体の `tsconfig.json` は変更しない。
- 理由 / 代替案: 本体 tsconfig を書き換える案は、配布物の配置に波及して事故が大きい。
  型検査という目的だけを別 config に閉じ込めるほうが影響が小さい。
- 影響: 出力先が 2 つになった（`out/` と `out-test/`）。両方 `.gitignore` と `.vscodeignore` に登録済み。
  `tsconfig.test.json` には `skipLibCheck: true` を入れた（`glob` が引き込む `lru-cache` の
  `.d.ts` が `lib.es2015` の `Map` と非互換で落ちるため。自分のコードの型検査が目的なので依存の宣言は検査しない）。

## D4: root の `build` / `test` を `--workspaces` ではなく依存順の明示列挙にした

- 背景: `npm run build --workspaces` はパッケージ名のアルファベット順で回るため
  `@as400/dds-cli` が `@as400/dds-core` より先に走り、型定義未生成で `TS2307` になった。
- 決定: `dds-core → dds-cli → vscode-extension` の順を root の script に直書きする。
- 理由 / 代替案: TypeScript の project references（`tsc -b`）でも順序は解決できるが、
  npm script 側にも順序が要る（テスト・バンドル）。層の順序を 1 か所に明示するほうが読める。
- 影響: パッケージを増やすときは root の script に手で追加する必要がある。

## D5: `node --test` にディレクトリではなく glob を渡す

- 背景: `node --test out/test/`（および `out/test`）は、この環境の Node v24.15.0 では
  ディレクトリをモジュールとして解決しようとして `MODULE_NOT_FOUND` になった。
- 決定: `node --test "out/test/**/*.test.js"` の glob 形式にする。
- 理由: glob 形式は期待どおりテストファイルを走査することを実測で確認した。
- 影響: なし（挙動は同じ）。

## D6: `vscode-extension/out/` を git の追跡から外した

- 背景: `out/` がコミットされており、しかも `src/` に対して**内容が古かった**
  （ビルドし直すと `ruler.js` / `positionResolver.js` に差分が出た）。
  D1 で `main` を `dist/` に移したため、`out/` は配布物ではなく中間生成物になった。
- 決定: `.gitignore` に `out/` と `out-test/` を追加し、`git rm -r --cached vscode-extension/out` で
  追跡を外す（ファイルはディスクに残る）。
- 理由: 追跡したままだと、以降すべての PR がビルド成果物の差分で埋まり、レビューが実効を失う。
- 影響: コミットに 58 件の削除が現れる。**内容の削除ではなく追跡の解除**である旨を PR 本文に書く必要がある。
  なお `rpg-cl-vscode-support-0.0.1.vsix`（リポジトリ直下）は追跡されたままで、
  今回のバンドル化で内容が更新される。**この VSIX を追跡し続けるかは別途判断が要る**（本 subtask では触らない）。

## D7: テスト実行を専用ランナー（`scripts/run-node-tests.mjs`）に置き換えた（D5 を差し替え）

- 背景: **test 工程で D5（`node --test "<glob>"`）が CI で落ちることが実測で判明した。**
  CI は `node-version: '20'` を使うが、Node 20 では glob が展開されず
  `Could not find '.../out/test/**/*.test.js'` で失敗する（`npx node@20` で再現確認）。
  D5 は Node v24.15.0 でしか検証しておらず、**CI の Node で確かめていなかった**のが原因。
- 決定: ファイル列挙を自前で行う `scripts/run-node-tests.mjs` を置き、
  `node scripts/run-node-tests.mjs out/test` を各パッケージの `test` にする。
  ランナーは (1) 再帰的に `*.test.js` を集め、(2) **0 件なら失敗させる**。
- 理由 / 代替案: 代替は (a) CI を Node 24 に固定、(b) シェル側 glob（引用なし）。
  (a) は `engines: ">=20"` の宣言と矛盾する。(b) は動くが `out/test/*.test.js` が平坦階層しか拾えず、
  サブディレクトリのテストを**無言で取りこぼす**。
  **テストが存在するのに走らない**状態はこのリポジトリで実際に起きていた（research F12）ので、
  最も避けたい失敗様式。ランナーなら 0 件検出で緑の空振りも塞げる。
- 影響: Node 20 と Node 24 の**両方で実行して合格を確認済み**。
  `engines.node: ">=20.0.0"` の宣言が実測で裏付けられた。D5 は無効。
