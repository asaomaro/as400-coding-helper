# レビュー: 01-workspace

subtask の review のため、**この slice 単独**の観点で点検する（結合は親の統合 review）。

## ラウンド 1（2026-08-26）

### 検証できたこと（指摘ではない・記録）

- バンドル済み `dist/extension.js` を CommonJS として読み込み、`activate` / `deactivate` が
  関数として公開されていることを確認（`vscode` はスタブを注入）。読み込み時エラーなし。
- `package.json` の `main`（`./dist/extension.js`）が実在することを確認。
- 拡張のソースに `__dirname` / 動的 `require(` が無いことを確認。
  バンドルで壊れやすい典型パターンを踏んでいない。
- リソース読み込みは `vscode.Uri.joinPath(context.extensionUri, ...)` 経由で、
  バンドルの影響を受けない。

### 指摘

#### must-1: `build-vsix.bat`（Windows 版）が workspaces / バンドル化に追従していない

`build-vsix.sh` は D1 に合わせて更新したが、**同じ役割の `build-vsix.bat` を更新していない**。
現状の `.bat` は次の 3 点で `.sh` と挙動が食い違う:

1. `cd /d "%EXT_DIR%"` してから `npm install` — ルートで実行する `.sh` と異なる。
2. `npm run compile` しか呼ばない — **`dist/extension.js` を生成しない**。
3. `vsce package` に `--no-dependencies` が無い。

結果として Windows では、(a) `@as400/dds-core` の symlink をたどって `.sh` が踏んだのと同じ
`invalid relative path` で失敗するか、(b) 仮に通っても **`main` が指す `dist/extension.js` を
含まない壊れた VSIX** ができる。どちらも実害がある。

AGENTS.md の「sh / ps1 二本立て CLI の実装観点」は `aidev` CLI についての記述だが、
**「挙動・出力・終了コードを一致させる」という思想は build スクリプトにも同じく効く**。
`.sh` だけ直して `.bat` を放置するのは、まさにそこで戒められている失敗様式。

#### should-1: `--no-dependencies` が必要な理由がスクリプトに書かれていない

`build-vsix.sh` に `--no-dependencies` を足したが、**なぜ必要かがコードから読み取れない**。
これを知らずに手で `vsce package` を叩くと、D1 で踏んだのと同じ失敗を再現する。
スクリプトにコメントを添え、`decisions.md` D1 を参照させる。

#### nit-1: `@as400/dds-core` が依存に入っているが未使用

`vscode-extension` の `dependencies` に入れたが、まだ import していない。
02-encoding で使う前提の先行配線であり、D1 に記録済み。**意図的なので修正はしない**が、
02 に入るまでは dead dependency である点を明示しておく。

#### nit-2: vsce の警告 2 件（本 subtask 起因ではない）

`repository` フィールド欠落と `LICENSE` ファイル欠落。**既存の状態**であり、
本 subtask で作り込んだものではない。deliver の「既知の制約」に載せる。

#### nit-3: `vscode-extension/scripts/validate-prompter-defs.mjs` が孤児

npm script・CI・シェルスクリプトのいずれからも参照されていない（既存の状態）。
`.vscodeignore` で VSIX からは除外済み。**本 subtask では触らない**が、
retro / propose の材料として記録する。

#### nit-4: 本番バンドルは minify され sourcemap を同梱しない

`vscode:prepublish` は `--production` で minify し、`.vscodeignore` が `**/*.map` を除く。
拡張として一般的な構成だが、**利用者環境でのスタックトレースが読みにくくなる**。
将来 sourcemap を同梱するか、minify を外す判断があってよい。

### 判定

**must 1 件 / should 1 件**のため、coding へ差し戻す。

## ラウンド 2（2026-08-26・差し戻し対応後）

### 対応内容

- **must-1 解消**: `build-vsix.bat` を `.sh` と同じ手順に揃えた。
  ルートで `npm install` → ルートで `npm run build`（依存順のビルド）→ `EXT_DIR` で
  `vsce package --no-dependencies`。`vsce` 不在時は `npx --yes @vscode/vsce` にフォールバックする点も
  `.sh` と揃えた。冒頭に「**挙動を .sh と一致させること（片方だけ直さない）**」を明記した。
- **should-1 解消**: `build-vsix.sh` の `vsce package` 直前に、`--no-dependencies` が必須である理由
  （workspace symlink をたどってリポジトリ全体を取り込む）と `decisions.md` D1 への参照をコメントで残した。
- nit-1 〜 nit-4: いずれも**意図的または既存の状態**のため修正しない。deliver / retro へ引き継ぐ。

### 再検証

- `bash -n build-vsix.sh` — 構文 OK。
- `./build-vsix.sh` — VSIX 生成成功（122 ファイル / 205.25 KB）。

### 未検証（環境不足・deliver へ引き継ぐ）

- **`build-vsix.bat` は Windows 上で未実行**。本環境は Linux のため実行できない。
  `.sh` と手順が一致していることを構造の対応で確認したに留まる。
  AGENTS.md が `aidev` CLI について「**ps1 変更は CI での実行を必ず確認する**」と戒めているのと同種のリスクで、
  **build スクリプトには対応する CI が無い**。Windows での検証手段を持たないことを既知の制約として残す。

### 判定

**must 0 件 / should 0 件 / nit 4 件**。nit のみのため review を通過とする。
