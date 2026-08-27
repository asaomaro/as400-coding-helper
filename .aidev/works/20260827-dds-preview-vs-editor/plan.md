# 計画: プレビューとビジュアルエディタの使い分けを案内する

## 実装方針
配線（コマンド → メニュー → 検査）を先に通し、文書は最後に書く。
検査を先に足すと落ちる状態が作れるので、**検査 → 実装**の順にする。

## 作業順序と依存関係
1. `verify-contributes.mjs` に検査を足す（依存: なし）
2. コマンドを登録する（依存: なし）
3. `package.json` に `commands` / `menus` / `title` を足す（依存: 2）
4. 使い分けの文書（依存: なし）

## リスク / 留意点
- `vscode.openWith` の引数順（uri, viewType）を取り違えると無言で失敗する。
- メニューの `when` は `resourceExtname` で書く。`editorLangId` は DDS が
  言語登録されていないので効かない（AGENTS.md）。

## テスト方針
- `npm run verify` の `verify:defs`（`verify-contributes.mjs`）で配線を機械検査する。
- **検査が落ちることを先に確かめる**（メニューを足す前に走らせる）。
- コンパイル・lint・単体テストの回帰。
