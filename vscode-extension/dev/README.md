# 開発用ハーネス（`dev/`）

**検証用であり製品ではない。** `npm run compile:webview` で `dev/out/` に生成し、
ブラウザで開く。VSIX には `out/dds-webview/` と `out/prompter-webview/` だけが載る
（こちらは載らない）。

## 何のためにあるか

**2 つの WebView**——DDS ビジュアルエディタ（`src/dds/webview/`）と
F4 プロンプター（`src/prompter/webview/`）——はどちらも **VSCode 非依存**に書いてある。
その主張は、**UI を 1 行も変えずに VSCode の外で動かせるか**でしか確かめられない。

| ファイル | 役割 |
|---|---|
| `standalone.ts` / `.html` / `.css` | DDS の単独起動ハーネス。`Bridge` の別実装（`postMessage` ではなく直接呼び出し）を与えるだけで、`ui.ts`・`protocol.ts`・**core の編集エンジン**はそのまま使う |
| `e2e.mjs` | そのハーネスを**実際に操作して**確かめる e2e（移動・つまみ・追加・削除・undo・DBCS の桁） |
| `prompter-standalone.ts` / `prompter.html` / `prompter.css` | F4 プロンプターの単独起動ハーネス。同じ作り。定義 JSON は `import` で埋め込む（`file://` では `fetch` できない） |
| `prompter-e2e.mjs` | プロンプターの e2e（条件表示・必須・繰り返しの組・ヘルプ・F4 in F4・書き戻し行） |

ホストが肩代わりしないものは、ハーネス側の帯として自前で持つ。
**これが VSCode 版との差の全部**。

| | DDS エディタ | F4 プロンプター |
|---|---|---|
| ホストが持つもの | ファイル操作・undo・ソースを開く | 定義の読み込み・入れ子の窓・書き戻し |
| 単独起動で `false` なもの | `providesFileIO` / `providesUndo` / `canOpenSource` | `closesWindow`（閉じる先が無いので結果を残す） |

### プロンプター側で確かめていること

`binding.ts` が HTML とインライン JS 827 行を文字列で組み立てていた頃は、
**型検査も自動テストも効かなかった**。実際 `dependencies` は WebView に渡っておらず
**一度も画面に出ていなかった**のに、`buildInitialState()` を見る単体テストは通っていた
（PR#93〜#98 で 3 回）。いまはブラウザで実際に押して確かめる。

**後退を戻すと落ちることは確認済み**（6 件。
`.aidev/works/20260828-prompter-standalone/verify/e2e-load-bearing.md`）。

## 検証用サンプル

帯の選択肢で切り替える。**実サンプルだけでは踏めない形**を 1 本ずつ足してある
（手で触ると見落とすため、e2e もこの並びを前提に書いてある）。

| サンプル | 何を確かめるためか |
|---|---|
| `CUSTMNT.dspf` | 実物。DBCS を含む定数・参照フィールド・複数様式 |
| `hidden-items.dspf` | **キャンバスに描かれない項目**（位置欄が空・画面に出ない用途）に一覧から手が届くか |
| `indicators.dspf` | **条件標識**。排他の組（`50` / `N50`）・両方オンで重なる組（`01` / `02`）・キーワードだけを条件付ける標識（`30`） |

プロンプター側は**同梱の定義 JSON をそのまま使う**（作り物の定義で誤魔化さない）。

| サンプル | 何を確かめるためか |
|---|---|
| `SBMJOB` | 値がコマンドの欄（F4 in F4）・基本 / 追加の別（F10） |
| `SNDPGMMSG` | 条件必須（`MSGID`→`MSGF`）・相関制約・CDML(DEP) |
| `CRTBNDRPG` | オブジェクト名の候補 |
| `ALCOBJ` | 入れ子の囲み（要素リストの要素 1 が修飾名） |
| `PARM`(.cmd) | 繰り返し group が 2 つ |
| `SAVOBJ` | CDML(PMTCTL) の条件表示（`DEV` の値で欄が出入りする） |
| `CALL` | 複数値の欄（`PARM` は 255 件）・入れ子で開く先 |
| `FIXTURE` | **実定義では踏めない形**——追加パラメーター側の必須欄・条件で隠れる必須欄。「見えない欄で確定を止めない」を確かめる（同梱 251 定義に無かったので手で書いた） |

## 動かし方

```sh
# 1. ビルド（型検査 → 束ねる）
npm run compile:webview -w rpg-cl-vscode-support   # ルートから。単体なら npm run compile:webview

# 2a. ブラウザで触る
#     dev/out/index.html をブラウザで開く（file:// で動く）

#     dev/out/prompter.html をブラウザで開く（プロンプター側）

# 2b. e2e を回す（2 本まとめて）
npm install --no-save playwright-core
npm run dev:e2e

#     片方だけなら
node dev/e2e.mjs            # DDS ビジュアルエディタ
node dev/prompter-e2e.mjs   # F4 プロンプター
```

`playwright-core` を **devDependency にしていない**のは、CI 以外では要らず `npm ci` を
重くするだけだから。CI 側は `--no-save` で**版を固定して**入れる
（浮動にするとブラウザのキャッシュの鍵が毎回変わって取り直しになる）。
ブラウザは `~/.cache/ms-playwright/chromium-*` を自動で探す（`PLAYWRIGHT_CHROMIUM` で明示も可）。

## CI で走る

`.github/workflows/prompter-definitions.yml` の **`gui-e2e` ジョブ**が、PR と main への
push で回す。`verify` とは別ジョブなので並行に走り、既存のジョブを遅くしない。
**2 本は別ステップ**にしてある（`if: always()`）——片方が落ちても、もう片方の結果を
1 回の実行で見るため。

**不安定なまま載せていない。** 載せる前に手元で 10 回連続回して緑を確認した
（2026-08-27・109 件・1 回 25 秒。記録は
`.aidev/works/20260827-dds-e2e-on-ci/verify/stability-2026-08-27.txt`、
測り直しは同じ場所の `e2e-stability.sh`）。

**落ちたら止まる**（`continue-on-error` を付けていない）。不安定なテストを混ぜると
赤を無視する習慣がつき、CI 全体が効かなくなる。**もし不安定になったら、
非ブロッキングにするのではなく原因を直すか、外す。**

## ここで確かめられないもの

- **VSCode 側の器**（`contributes.customEditors` の登録・`WorkspaceEdit` の適用・undo の連携、
  プロンプターなら F4 のキーバインド・定義の探索・`applyChanges` の書き戻し）。
  これは `test/unit/` の単体テスト・`test/integration/` と、F5 での手動確認が受け持つ。
  **F5 は `npm run compile:all`**（tsc ＋ esbuild）で起動する——`compile` だけだと
  束ねた資産が無く、**画面が真っ白になる**（例外も出ない）。
- 実機（IBM i）での見え方。`ibmi-remote` skill で `CRTDSPF` して確かめる。
