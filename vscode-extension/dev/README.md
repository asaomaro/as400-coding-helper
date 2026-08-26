# 開発用ハーネス（`dev/`）

**検証用であって製品ではない。** `.vscodeignore` で `dev/**` を除外しているので VSIX には入らない。

## 何のためにあるか

DDS ビジュアルエディタの UI（`src/dds/webview/`）は **VSCode 非依存**に書いてある
（design DD7: スタンドアロンが本体・VSCode は埋め込み先の 1 つ）。
その主張は、**UI を 1 行も変えずに VSCode の外で動かせるか**でしか確かめられない。

ここにあるのはその確認手段:

| ファイル | 役割 |
|---|---|
| `standalone.ts` / `standalone.html` / `standalone.css` | 単独起動ハーネス。`Bridge` の別実装（`postMessage` ではなく直接呼び出し）を与えるだけで、`ui.ts` と `protocol.ts` はそのまま使う |
| `e2e.mjs` | そのハーネスを**実際にマウス操作して**確かめる e2e（ドラッグ移動・リサイズ・追加・削除・拒否経路・DBCS の桁） |

ホストが肩代わりしないもの（`providesFileIO` / `providesUndo` が `false`）は
ハーネス側の帯（ファイルを開く・保存・元に戻す）として自前で持つ——design DD8 の実物。

## 動かし方

```sh
# 1. ハーネスをビルドする（dev/out/ に出る）
npm run dev:standalone -w rpg-cl-vscode-support

# 2a. ブラウザで触る場合: dev/out を静的配信して開く
npx --yes http-server vscode-extension/dev/out -p 8765   # 何でもよい

# 2b. e2e を回す場合（ブラウザは e2e が内蔵サーバで配信する）
npm install --no-save playwright-core
npm run dev:e2e -w rpg-cl-vscode-support
```

`playwright-core` を **devDependency にしていない**のは、CI ではブラウザ本体が無く動かせないため。
入れると「CI に載っているのに走っていないテスト」が生まれる。手動導入に留めている。

ブラウザは `~/.cache/ms-playwright/chromium-*` を自動で探す。無ければ
`npx playwright install chromium`、または `PLAYWRIGHT_CHROMIUM=/path/to/chrome` で指定する。

## 限界（ここで確かめられないもの）

- **AC8（`.dspf` の既定エディタがテキストのままであること・ルーラー / SOSI）** は VSCode でしか見られない。
- `CustomTextEditorProvider` の `WorkspaceEdit` 適用も同様（単体テストでは
  `test/unit/ddsEditorEdit.test.ts` が `parse → applyOps → lineReplacement` までを固定している）。
