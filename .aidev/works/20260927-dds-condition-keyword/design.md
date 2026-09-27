# 設計: 様式・項目のキーワードに条件（標識）を付けられるようにする

## 方針
- core に `conditionKeyword`（`sourceLine`＝様式・項目の代表行、`index`＝キーワード欄全体を区切ったときの番号、`condition`）を足す。
  そのキーワードを元の行から外し（行が空になれば条件の行ごと消す。代表行は残す）、様式・項目の最後の行の後ろに条件つきのキーワード行を足す。
  既存の `setKeywords` は代表行から続く行をまとめて書き直す（他の行の条件が消える）ので使わない。
- 条件の書き方は既存の `writeBackCondition`（項目・キーワード行の条件と同じ）。条件を付けられるかは既存の `dds-conditioning.json`（原典から生成・実機で照合済み）。
- UI はキーワードのチップに「条件」を付け、押すとその場の入力欄で条件（`31` / `N40 41` / `50, 60`）を受ける。代表行は動かないので選択はそのまま。
- WebView の契約（`protocol.ts`）にも通す。

## 受け入れ基準との対応
- AC1: `ddsEdit.ts`（`conditionKeyword` / `locateKeyword`）。`ddsEdit.test.ts`。
- AC2: `ddsEdit.ts`（検証の `isConditionable`）。`ddsEdit.test.ts`。
- AC3: `ui.ts`（`keywordSection` の「条件」）・`protocol.ts`・`ui.css`。`dev/e2e.mjs`（22c）。
- AC4: `verify/make-sfl.mjs` → `CONDKW.dspf`。
