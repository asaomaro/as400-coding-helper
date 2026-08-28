# 仕様: キーワード使用レベル検査

## 設計方針

### 1. 軽い資源を別に作る

`generate-dds-keyword-levels.mjs` が `dds-keywords.json` から
**名前とレベルだけ**を取り出す。`dspfLayout` は WebView にも束ねられるので、
解説つきの表を取り込まない。

### 2. **一覧に無い ＝ 判断しない**

原典がレベルを書いていないキーワードは表に入れない。
**咎める側では「知らないものを咎めない」**——補完側の「判別できなかったものは
どのレベルでも出す」と対になる。

### 3. 診断はレイアウトの解決に足す

`unconditionableDiagnostics` の隣。`keyword-wrong-level` として DSPF / PRTF 両方に。
ファイル・レベルは論理単位にならないので `fileLevelKeywordLines` から読む。

### 4. 既定 ON

検証済みサンプルで偽陽性 0 件（`research.md` F4）。lint core の既定 ON の基準を満たす。

## 受け入れ基準との対応

- AC1: `keywordLevelDiagnostics`。
- AC2: `verify/probe-levels.mjs`（7 通り）。
- AC3: 表に無ければ `undefined` → 咎めない。単体で固定（**外すと落ちる**）。
- AC4: 単体でサンプルを当てる。
- AC5: `enabledByDefault: true` ＋ `package.json` の設定。
