# 調査: キーワード使用レベル検査

## 判明した事実

### F1: **実機は違うレベルを通さない**（IBM i 7.3 / `CRTDSPF`）

`verify/probe-levels.mjs`。原典のレベルと全件一致した。

| 形 | 実機 |
|---|---|
| 正しいレベル（対照） | 通る |
| `DSPSIZ` を様式に / 項目に | **通らない** |
| `OVERLAY` をファイルに / 項目に | **通らない** |
| `COLOR` を様式に / ファイルに | **通らない** |

### F2: レベルのデータは**既にある**が、検査には使っていない

`resources/completion/dds-keywords.json` の `level`。補完（`keywordsForLevel`）が
使っている。DSPF 172 件 / PRTF 62 件 / PF 44 件がレベルを持つ。

### F3: **そのまま取り込むと束が重くなる**

`dspfLayout` は **WebView にも束ねられる**。解説つきの `dds-keywords.json` は大きい。
`dds-conditioning.json` と同じく、**名前とレベルだけの軽い資源**を別に作る
（13.7 KB）。

### F4: 検証済みサンプルで**偽陽性 0 件**

`CUSTMNT.dspf` / `CUSTRPT.prtf` / `CUSTMST.pf` / `CUSTLF1.lf` / `DBCSSAMP.pf` の
5 件に当てて 0 件。lint core の既定 ON の基準（「実機コンパイル確認済みのソースに
当てて偽陽性が 0 件」）を満たす。

## 影響範囲

- 新規 `docs/origin/generate-dds-keyword-levels.mjs` / `resources/completion/dds-keyword-levels.json`
- 新規 `src/core/dds/ddsKeywordLevels.ts`
- `src/core/dds/dspfLayout.ts` / `prtfLayout.ts` — 診断を足す
- `src/lint/rules/index.ts` / `types.ts` / `package.json` — 規則の登録
