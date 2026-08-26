# タスク: 01-workspace

- [x] T1: root `package.json` を新規作成し npm workspaces を定義する（`workspaces: ["vscode-extension", "packages/*"]`）。既存の孤児 `package-lock.json`（root に `package.json` が無いのに存在・`"packages": {}`）を正規化する
      対象: `package.json`（新規） / `package-lock.json`（既存・root） / 根拠: research「root package.json 不在」の実測
- [x] T2: `packages/dds-core` のパッケージ骨格を作る（`package.json` / `tsconfig.json` / `src/index.ts`）。**`@types/vscode` を依存に入れない**（AC9 の本体）（依存: T1）
      対象: `packages/dds-core/`（新規） / 根拠: spec D1
- [x] T3: `packages/dds-cli` のパッケージ骨格を作る（`package.json` に `bin` / `tsconfig.json` / `src/main.ts`）。`dds-core` に依存させる（依存: T1）
      対象: `packages/dds-cli/`（新規） / 根拠: spec D1・spec「インターフェース / CLI」
- [x] T4: `vscode-extension` を workspace メンバとして成立させ、`dds-core` への依存を追加する。あわせて `tsconfig.json` の `include` に `test` を追加し、**初めてコンパイルされる既存テストのエラーをここで潰す**（依存: T1）
      対象: `vscode-extension/package.json` / `vscode-extension/tsconfig.json`（`include: ["src"]`） / 根拠: research F12・spec「対象範囲・変更」
- [x] T5: テスト実行基盤を実体化する。core / cli は `node --test`（依存ゼロ）、拡張は `test` スクリプトのスタブ（`echo "Tests are not configured..."`）を実体化し `vscode-test` を devDependencies に追加する（依存: T2, T3, T4）
      対象: `vscode-extension/package.json`（`scripts.test` / `devDependencies`） / `packages/*/package.json` / 根拠: research F12・A9
- [x] T6: `vscode` 非依存ガードのスクリプトを作る（`packages/dds-core/src` 配下に `from "vscode"` が 0 件であることを検査し、違反時に非 0 終了する）（依存: T2）
      対象: `scripts/check-no-vscode-dep.mjs`（新規） / 根拠: spec D1・requirement AC9
- [x] T7: CI ワークフローを新設する（node セットアップ → `npm ci` → 全パッケージ `tsc` → core/cli の `node --test` → 非依存ガード）。既存の `aidev-tests.yml` は変更しない（依存: T5, T6）
      対象: `.github/workflows/extension-tests.yml`（新規） / 参考: `.github/workflows/aidev-tests.yml` / 根拠: research F12・A10
- [x] T8: `build-vsix.sh` を workspaces 構成に合わせて調整し、**VSIX が実際に生成できることを確認する**（依存: T4）
      対象: `build-vsix.sh`（`cd "$EXT_DIR"` → `npm install` → `vsce package`） / 根拠: 親 plan R5
- [x] T9: 受け入れ確認 — root と各パッケージで `tsc` が通る／`node --test` が起動する／**`dds-core` に `vscode` の import を一時的に置くと `tsc` とガードの両方が失敗する**ことを確認し、置いたものを戻す／CI が緑（依存: T7, T8）
      対象: リポジトリ全体（確認作業。新規ファイルなし） / 根拠: 本 subtask の plan「テスト方針」
