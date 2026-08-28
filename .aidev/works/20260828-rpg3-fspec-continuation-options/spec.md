# 仕様: F 仕様 継続行の選択欄・記入欄を足す

## 概要

`F-SPEC.json`（RPG III・日本語版）に **`CONTOPT`(54-59)** と **`CONTENTRY`(60-65)** を足し、
`CONTINUATION`(53) が `K` のときだけ出す。選択欄は**自由入力**とし、
実機で確かめた 15 語を**説明（F1 ヘルプ）に載せる**。

## 設計方針

### 1. 選択欄は `dropdown` にしない

**候補の出所が閉じていないことが実測で分かった**（research F5。ILE 由来の候補は
15 件中 5 件を取りこぼしていた）。列挙で縛ると、**まだ見つけていない有効な語を
書けなくする**——`ADDPFM` の `SRCTYPE` で踏んだのと同じ形になる。

`attributes.restricted:false` では足りない。あれは**検証を緩めるだけ**で、
`<select>` そのものが自由入力を受け付けないため（research R2）。

したがって `inputType: "text"`。**確かめた 15 語は `help` に置く**（F1 で読める）。

### 2. 語ごとの使いどころも説明に書く

有効な語は**文脈に依存する**（research F7）。`SFILE` / `IGNORE` は外部記述ファイル、
`NUM` / `SAVDS` / `IND` / `ID` は WORKSTN。平たい一覧にすると
「選べるのに使えない」語が並ぶので、**どこで使うか**を添える。

### 3. 継続行のときだけ出す

`CONTINUATION` が `K` のときだけ 2 欄を表示する（`dependsOn` の `effect:"visible"`）。

**ファイル行では 60-65 は空白でなければならない**（`QRG2016`。実機で確認済み）。
条件表示にしておけば、継続行でないのに記入して `QRG2016` を踏むことがない。

### 4. 記入欄は自由入力

記入の意味は語ごとに違う（データ構造名・副ルーチン名・レコード番号フィールド・
様式名…）。research F3 の表がそのまま証拠になっている。**型で縛らない。**

## 対象範囲

- `vscode-extension/resources/prompter/rpg/rpg3/ja/F-SPEC.json` — 欄を 2 つ追加。
  併せて `CONTINUATION` の `placeholder` を `S` → `K` に直す（**現状は誤り**。
  help には「`K` か空白しか入らない」と書いてあるのに、入力例が `S` になっている）。
- `vscode-extension/test/unit/rpg3NumericColumns.test.ts` — 桁と条件表示の回帰を足す。

**変更しないもの**: 桁の書き戻し（`commandText.ts` の `buildRpgLineText` は
`sourceStart`/`sourceLength` を見るだけ）、ルーラー、英語版（RPG III は作らない）。

## インターフェース / データ構造

```jsonc
{
  "name": "CONTOPT",
  "description": "継続 選択",
  "help": "54-59桁。継続行（53桁目が K）の選択。… 実機（IBM i 7.3 / CRTRPGPGM）で
           確かめた語: INFDS INFSR RECNO PLIST PASS PRTCTL SLN RENAME SFILE IGNORE
           SAVDS IND NUM ID COMIT。… **この一覧で全部とは限らない**（…）",
  "inputType": "text",
  "sourceStart": 54, "sourceLength": 6,
  "visibleByDefault": false,
  "dependsOn": [{ "effect": "visible", "parameter": "CONTINUATION", "equalsAny": ["K"] }],
  "attributes": { "characterSet": "upper", "maxLength": 6 }
}
```

`CONTENTRY` も同形（60-65、`dependsOn` は同じ）。

## 振る舞いの詳細

| `CONTINUATION` | `CONTOPT` / `CONTENTRY` |
|---|---|
| 空白 | 出さない |
| `K` | 出す |
| 値が入っている | **出す**（`visibilityRules.ts` の「入力済みの値は隠さない」。既存ソースを読める） |

書き戻しは既存の桁の仕組みに乗るだけ（`buildRpgLineText`）。

## ドメイン固有の考慮

- **RPG III には原典が無い。** 語の集合は**実機のコンパイラの判定**が唯一の根拠
  （AGENTS.md「原典と実機が食い違ったら、実機のパーサーに判定させる」）。
- **取りこぼしを隠さない。** help に「この一覧で全部とは限らない」と書き、
  調べ方（`QRG2023` が出るかどうか）も残す。次に増やす人が同じ手順を踏める。

## エラー処理 / 異常系

- 未知の語を書いても**プロンプターは弾かない**（弾く根拠が無い）。
  実機が `QRG2023` で教える。
- `CONTINUATION` が `K` 以外なら 2 欄は隠れ、値も持ち回らない。

## 受け入れ基準との対応

- **AC1**: `verify/options-result.json` / `options-result-round2.json` に 50 件の判定と
  メッセージ番号。`research.md` F3 / F5 に一覧。
- **AC2**: 対照は 1 巡目・2 巡目とも 4/4。**先頭と末尾**に置いてあるので途中で
  診断が止まっていないことも示せる。
- **AC3**: 54-59 / 60-65 は未使用（research F4）。単体テストで桁の重なりを検査。
- **AC4**: `npm run verify` / `npm test`。
- **AC5**: help と `research.md` F5 に「ILE 由来の候補は 15 件中 5 件を取りこぼした」と明記。
