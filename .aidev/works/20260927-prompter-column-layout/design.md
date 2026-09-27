# 設計: 欄を桁の決まりどおりに寄せる

## 方針
- 置き方は**定義の属性**（`attributes.columnLayout`）で持つ。判定を書き戻しのコードに欄の名前で書かない（定義を足すたびにコードを直すことになる）。
- `right` は数値ではないが右に寄せる欄（`numericOnly` は数値検査も伴うので使わない。`N01` や開始位置を数値検査に掛けない）。
- `indicatorSlots`（DDS 条件付け）: 空白を除いて `N?\d\d` の並びに分け、3 桁の枠に右寄せで最大 3 組。`*` で始まる値（画面サイズ条件名）は 9 桁目から。
- `rowColumn`（DDS 位置）: 空白で区切って 2 つなら行・桁、1 つなら桁（行送りの帳票・相対位置 `+2` は桁だけ）。各 3 桁に右寄せ。
- 形に合わない値は書き戻しで左詰めに落とし、`validate` がエラーにして確定を止める（判定は `commandText.ts` の `columnLayoutError`。UI は `model.ts` を import するので画面にも出る）。
- C の結果標識は 71-76 の 1 欄では空の組を表せないので、2 桁×3 欄に分ける。原典照合（`verify-rpg-definitions.mjs`）は
  「同じラベルに複数の欄を対応させたら、並べた範囲が原典の範囲と一致すること」を見るように広げる。

## 対象範囲
- `vscode-extension/src/prompter/types.ts`（`columnLayout`）/ `commandText.ts`（`layOutColumns` / `columnLayoutError`）/ `model.ts`（`validate`）
- `vscode-extension/resources/prompter/rpg/ile/ja/{C,D,F}-SPEC.json`（英語版は `generate-rpg-spec-definitions.mjs` で作り直す）
- `docs/origin/generate-dds-prompter.mjs`（`COLUMN_LAYOUT`）/ `docs/origin/verify-rpg-definitions.mjs` / `docs/origin/rpg-spec-en-strings.json`

## 依拠する事実
- DSPF の小数・行・桁を左詰めにすると CPD7422（`verify/P4DECL.dspf` / `P4POSL.dspf`。右寄せの `P4DECR.dspf` は作成できる）。
- D の開始位置を左詰めにすると RNF0263（`verify/P4RL.rpgle`、実操作調査の CMPLXR も同じ）。
- 物理/論理の条件付け・位置は「使用しません」（原典 `FIELD-PF-lfcond.html` / `FIELD-PF-lfloc.html`）。

## 受け入れ基準との対応
- AC1: `layOutColumns` と定義の `columnLayout`。単体テスト（`prompterRegressions.test.ts`「桁の決まりどおりに寄せる」）。
- AC2: `columnLayoutError` を `validate` から呼ぶ。単体テスト。
- AC3: `verify/make-layout.mjs` で書き戻しから組んだ DSPF / RPG を `compile.mjs` で実機にかける。対照は手で組んだ左詰め。
- AC4: `verify-rpg-definitions.mjs`（同じラベルの複数欄）・`verify:defs`・`verify-prompter-roundtrip.mjs`・`npm test`。
