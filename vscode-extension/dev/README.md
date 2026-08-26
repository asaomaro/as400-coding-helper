# 開発用ハーネス（`dev/`）

**検証用であり製品ではない。** `npm run compile:webview` で `dev/out/` に生成し、
ブラウザで開く。VSIX には `out/dds-webview/` だけが載る（こちらは載らない）。

## 何のためにあるか

DDS ビジュアルエディタの UI（`src/dds/webview/`）は **VSCode 非依存**に書いてある。
その主張は、**UI を 1 行も変えずに VSCode の外で動かせるか**でしか確かめられない。

| ファイル | 役割 |
|---|---|
| `standalone.ts` / `.html` / `.css` | 単独起動ハーネス。`Bridge` の別実装（`postMessage` ではなく直接呼び出し）を与えるだけで、`ui.ts`・`protocol.ts`・**core の編集エンジン**はそのまま使う |
| `e2e.mjs` | そのハーネスを**実際に操作して**確かめる e2e（移動・つまみ・追加・削除・undo・DBCS の桁） |

ホストが肩代わりしないもの（`providesFileIO` / `providesUndo` が `false`）は、
ハーネス側の帯（ファイルを開く・保存・元に戻す）として自前で持つ。**これが VSCode 版との差の全部**。

## 検証用サンプル

帯の選択肢で切り替える。**実サンプルだけでは踏めない形**を 1 本ずつ足してある
（手で触ると見落とすため、e2e もこの並びを前提に書いてある）。

| サンプル | 何を確かめるためか |
|---|---|
| `CUSTMNT.dspf` | 実物。DBCS を含む定数・参照フィールド・複数様式 |
| `hidden-items.dspf` | **キャンバスに描かれない項目**（位置欄が空・画面に出ない用途）に一覧から手が届くか |
| `indicators.dspf` | **条件標識**。排他の組（`50` / `N50`）・両方オンで重なる組（`01` / `02`）・キーワードだけを条件付ける標識（`30`） |

## 動かし方

```sh
# 1. ビルド（型検査 → 束ねる）
npm run compile:webview -w rpg-cl-vscode-support   # ルートから。単体なら npm run compile:webview

# 2a. ブラウザで触る
#     dev/out/index.html をブラウザで開く（file:// で動く）

# 2b. e2e を回す
npm install --no-save playwright-core
npm run dev:e2e
```

`playwright-core` を **devDependency にしていない**のは、CI にブラウザ本体が無く動かせないため。
入れると「CI に載っているのに走っていないテスト」が生まれる。手動導入に留めている。
ブラウザは `~/.cache/ms-playwright/chromium-*` を自動で探す（`PLAYWRIGHT_CHROMIUM` で明示も可）。

## ここで確かめられないもの

- **VSCode 側の器**（`contributes.customEditors` の登録・`WorkspaceEdit` の適用・undo の連携）。
  これは `test/unit/` の単体テストと、F5 での手動確認が受け持つ。
- 実機（IBM i）での見え方。`ibmi-remote` skill で `CRTDSPF` して確かめる。
