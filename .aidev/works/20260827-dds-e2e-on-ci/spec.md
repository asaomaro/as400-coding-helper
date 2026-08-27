# 仕様: エディタの GUI e2e を CI に載せる

## 設計方針

**別ジョブにする。** 既存の `verify` ジョブに足すと、ブラウザの用意（1 分ほど）が
原典照合と単体テストの前に挟まる。並行に走らせれば全体の時間は伸びない。
ブラウザ回りの失敗が原典照合の失敗を隠すこともない。

`playwright-core` は**依存に入れない**（CI 以外では要らず、`npm ci` を重くする）。
CI で `--no-save` で入れる。ただし**版を固定する**——キャッシュの鍵が版で決まるので、
浮動にすると毎回キャッシュが外れる。

## 対象範囲

- `.github/workflows/prompter-definitions.yml` — `gui-e2e` ジョブ
- `vscode-extension/dev/README.md` — CI で走ることを書く

## インターフェース / データ構造

```yaml
gui-e2e:
  runs-on: ubuntu-latest
  env:
    PLAYWRIGHT_VERSION: "1.62.1"   # キャッシュの鍵。上げるときはここだけ
  steps:
    - checkout / setup-node
    - actions/cache: ~/.cache/ms-playwright  key: ...-${{ env.PLAYWRIGHT_VERSION }}
    - npm ci || npm install
    - npm install --no-save playwright-core@${PLAYWRIGHT_VERSION}
    - node node_modules/playwright-core/cli.js install chromium
    - npm run compile:webview
    - node dev/e2e.mjs
```

`dev/e2e.mjs` は `~/.cache/ms-playwright` から chromium を探す（既存の `findChromium`）。
`PLAYWRIGHT_CHROMIUM` で明示もできる。**e2e 側は何も変えない。**

## 振る舞いの詳細

- ブラウザが見つからない / ページが無いときの終了コードは **2**（既存）。
  ジョブは失敗する。**skip にしない**——「走らなかった」を「通った」と読み違えない。
- `install chromium` は `--with-deps` を付けない。ubuntu-latest には必要な共有ライブラリが
  入っており、`--with-deps` は sudo を要求して遅い。起動は `--no-sandbox --disable-gpu`
  （既存）なのでサンドボックスの制約にも当たらない。

## ドメイン固有の考慮

**不安定なまま載せない**（backlog `dds.md` の条件）。載せる前に手元で **10 回連続**回し、
再現率を測って記録する。1 回でも落ちたら載せない——赤を無視する習慣がつくと、
CI 全体が効かなくなる。

## エラー処理 / 異常系

- キャッシュが外れてもジョブは通る（ダウンロードが入るぶん遅くなるだけ）。
- `npm ci` が使えないときは `npm install` に落ちる（既存ジョブと同じ形）。

## 受け入れ基準との対応

- AC1: `on: push(main) / pull_request`（ワークフロー全体の設定を共有）
- AC2: 最後のステップが `node dev/e2e.mjs`。**`continue-on-error` を付けない**
- AC3: `verify/e2e-stability.sh` と測定結果を work に残す
- AC4: `actions/cache` で `~/.cache/ms-playwright`
- AC5: `gui-e2e` は `verify` と別ジョブ（`needs` を付けない＝並行）
