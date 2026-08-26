---
backlog: display
kind: standing        # standing（定常ドメインキュー）| split（タスク分割由来・短命）
priority: 0           # 複数backlog選択順（小さいほど先）。既存挙動の不具合は定義追加より先
---
# 表示系（ルーラー / SOSI）バックログ

ルーラー表示・SOSI（DBCS 制御コード）表示に関する不具合と改善のキュー。
対象コードは `vscode-extension/src/language/ruler.ts` と
`vscode-extension/src/language/dbcsShiftMarkers.ts`。

`aidev-util-batch` が消化する対象リスト。各未チェック行 = 1件のタスク。

## 項目

- [ ] **ルーラーが DBCS 行で桁ズレする**（`ruler.ts`）

  **症状**: DBCS（全角）を含む行で、ルーラーの目盛りとコード本文の桁が一致しない。
  ズレは最初の DBCS 文字以降で累積する。

  **原因**: `vscode-extension/src/language/ruler.ts:130` が
  `const width = Math.max(MIN_WIDTH, lineText.length)` と **JS の文字数**で幅を取り、
  `:216` の `buildTensRow` が **1 桁 = 1 文字**で目盛りを組む。
  一方エディタは全角を 2 セル幅で描画し、さらに `dbcsShiftMarkers` が
  `{` `}` を `before` 装飾として重ねるため、本文の視覚幅は文字数より広くなる。

  **証拠（計算・実測）**: `@as400/dds-core` の `displayWidth` で表示桁を求め、
  `lineText.length` と比較した結果:

  | 行の内容 | 文字数 | 表示桁 | ズレ |
  |---|---|---|---|
  | `A ... 1  2'社員マスタ保守'` | 53 | 62 | **+9** |
  | `A ... 3  2'社員番号'` | 50 | 56 | **+6** |
  | `A EMPNAM 20 B 4 14`（ASCII のみ） | 44 | 44 | 0 |
  | `A ... 23  2'F3=終了'` | 51 | 55 | **+4** |

  ズレ 9 の内訳は「全角 7 文字 × 各 +1 桁 = 7」＋「SO 1 桁」＋「SI 1 桁」で一致する。
  ASCII のみの行はズレ 0 なので、**DBCS を含む行に限った問題**である。

  **未検証**: 表示環境が無いため**視覚的な確認は行っていない**。上記はコードと
  表示桁計算からの決定論的な導出であり、実際の VSCode 上での見え方は未確認。
  着手時にまず目視で再現させること。

  **修正の材料は既にある**: `@as400/dds-core` の `displayWidth` / `charIndexToColumn` /
  `sosiPositions`（02-encoding で実装済み）を使えば、表示桁ベースで目盛りを組み直せる。
  判定は同じ `isDbcsCodePoint` を共有しているので、SOSI 表示と食い違わない。

  **出所**: `.aidev/works/20260825-dds-visual-editor/research.md` F10 /
  同 `02-encoding` の T10。本 work では**修正しない**判断（ユーザー決定・スコープ維持）。

- [ ] **`vscode-extension/scripts/validate-prompter-defs.mjs` が孤児**

  npm script・CI・シェルスクリプトのいずれからも参照されていない。
  実行経路に繋ぐか、不要なら削除するかを決める。
  出所: `01-workspace` の `review.md` nit-3。

- [ ] **拡張の `package.json` に `repository` と `LICENSE` が無い**

  `vsce package` が毎回警告を出す。VSIX の配布方針とあわせて決める。
  出所: `01-workspace` の `review.md` nit-2。

- [ ] **DDS 原典（V6R1）と実装の突き合わせ**

  `docs/origin/dds/DDS-DSPF.pdf` / `DDS-PRTF.pdf` を取得済み（2026-08-26）。
  L3（キーワード編集）に入る前に、原典と実装を機械的に突き合わせる。

  **原典があることで初めて扱えるようになる項目**:
  - `EDTCDE` / `EDTWRD` を持つ数値フィールドの**表示幅**
    （現状は `length` のまま描いており、実機と食い違う。05 の review nit-1）
  - `DSPSIZ` の読み取り（画面サイズを DDS から取る。05 の review nit-2）
  - 条件標識が付いた要素同士の重なりの扱い（`CPD7866` が
    「with no conditions specified」と限定している理由。04 の未検証事項）
  - `DATE` / `TIME` / `USER` 等のキーワード項目の表示幅（05 の review should-1 で
    「判定できない」として警告を出しているもの）

  **注意**: 原典は **V6R1** で、`cl` / `ilerpg` の 7.4 とは版が異なる。
  版差に依存しうる記述を引くときは成果物に明記すること。
