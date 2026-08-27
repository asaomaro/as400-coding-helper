# 仕様: DDS の操作を CLI に載せる

## 設計方針

**薄く載せる。** 判断はすべて `src/core/dds/` にあるので、CLI は
「ファイルを読む → コアを呼ぶ → 形にする」だけ。**CLI に規則を持たない。**

`lint.js` の作り（`UsageError` / `run(argv): number` / `require.main` 判定）を踏襲する。
終了コードの規約も同じ（0 / 1 / 2）。**テストから `run()` を直接呼べる**のが要点。

種別（画面 / 帳票）は `resolveDdsType` に委ねる。拡張子を CLI に数え上げない。

## 対象範囲

- `vscode-extension/src/cli/dds.ts`（新規）
- `vscode-extension/package.json` — `dds` スクリプト
- `vscode-extension/test/unit/ddsCli.test.ts`（新規）

## インターフェース / データ構造

```
node out/cli/dds.js <コマンド> [オプション] <ファイル>

  parse    様式と項目を JSON で出す
  render   描画モデルを出す（--format json|text）
  patch    編集を当てる（--edits <path|-> [--write]）

共通:
  --format <json|text>   出力形式（parse は json のみ）
  --output <path>        出力先（既定 標準出力）
  --help

帳票（.prtf）だけのオプション:
  --page-rows <n>        1 ページの行数（既定 66）
  --page-columns <n>     1 行の桁数（既定 132）
  --overflow <n>         オーバーフロー行（既定 60）
```

### `render --format text`

桁ルーラー付きの絵。**1 桁 = 1 文字**で、DBCS の 2 桁目は空白にする
（`RenderSegment.cols` をそのまま使い、CLI で幅を数え直さない）。

```
     ....+....1....+....2....+....3
  1 |                              |
  2 |   顧 客 保 守       CUSTOMER |
```

非表示（`DSPATR(ND)`）の項目は `·` で置く——**桁は占めるが文字が出ない**ことを
絵の上でも区別できるようにする。

### `patch --edits`

`DdsEdit[]` の JSON を受ける（`-` で標準入力）。

1. `validateDdsEdits` に通す。**拒否が 1 つでもあれば何も書かず終了コード 1。**
2. `applyDdsEdits` の結果を後ろから当てる（先に当てると行番号がずれる）。
3. `--write` があれば元のファイルへ、無ければ結果を標準出力へ。

## 振る舞いの詳細

- 拒否は **JSON でも読める形**で出す（`--format json` のとき
  `{ "rejections": [{ code, message, sourceLine }] }`）。
  エージェントが理由で分岐できるようにするため。
- 改行は**元のファイルに合わせる**（CRLF のファイルを LF で書き戻さない）。
- 末尾の改行の有無も保つ。
- DDS 以外のファイル（`resolveDdsType` が `DDS-DSPF` / `DDS-PRTF` を返さない）は
  終了コード 2 で断る。**`.pf` / `.lf` は配置の概念が無い**ので対象外。

## ドメイン固有の考慮

- **`validate` は作らない**。`lint` の `layout-*` 規則が `resolveDspfLayout` /
  `resolvePrtfLayout` をそのまま包んでおり、同じ判定になる（`src/lint/rules/layout.ts:52`）。
  2 つ目の入口を作ると、どちらが正か分からなくなる。help でその旨を案内する。
- 桁の書き戻し（右寄せ・折り返し）は `ddsEdit` / `ddsEditWriteBack` の仕事。
  **CLI では 1 桁も数えない。**

## エラー処理 / 異常系

| 事象 | 終了コード |
|---|---|
| 成功 | 0 |
| 編集が拒否された | 1 |
| 使用法の誤り / 読めない / 書けない / DDS でない | 2 |

## 受け入れ基準との対応

- AC1: `parse` が `buildDspfOutline` を JSON 化
- AC2: `render --format text` の絵。DBCS は `segments` の `cols` で並べる
- AC3: `validateDdsEdits` を先に通し、拒否があれば書かない
- AC4: `applyDdsEdits` の置き換え指示を後ろから当てる（他行に触らない）
- AC5: `resolveDdsType` で分岐し、帳票は `buildPrtfRenderModel`
- AC6: `run(argv): number` が 0 / 1 / 2 を返す
