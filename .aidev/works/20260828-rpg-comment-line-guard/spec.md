# 仕様: RPG の注記行のガード

## 設計方針

判定（`isCommentLine`）を `src/core/rpgSpec.ts` に置き、**2 か所**で使う:

1. `classifyWithState` — 注記行は `undefined`（仕様書として分類しない）。
2. `absorb` — 注記行は索引に入れない。

`ruler.ts` の写しは**外す**。規則は 1 か所。

## なぜ `absorb` にも要るか

`absorb` は**分類の結果に関わらず毎行呼ばれる**。ファイル名の方は衝突しない
（注記行の 7-16 桁は必ず `*` で始まる）が、**`lastRecordName` は中身を問わず
上書きする**——注記を 1 行挟むだけで、続くフィールド行が「直前のレコード様式」を
見失い、記述種別が変わる（プログラム記述が外部記述として扱われる）。

## 対象範囲

- `src/core/rpgSpec.ts` / `src/language/ruler.ts`

## 受け入れ基準との対応

- AC1: `classifyWithState` の先頭。
- AC2: `ruler.ts` から写しを外した。
- AC3: 注記でない行は素通り。単体で固定。
- AC4: `absorb` の先頭。単体で固定（**外すと落ちる**ことを確認済み）。
