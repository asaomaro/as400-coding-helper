# 調査: F 仕様 継続行の選択欄に入る語

## 調査の問い

- Q1: 選択欄(54-59)に入る語を、**推測せずに**どうやって確定するか。
- Q2: 候補 30 件のうち実機が受けるのはどれか。
- Q3: 候補の出所（ILE のキーワード）で取りこぼしはあるか。
- Q4: 定義に足す欄の桁は空いているか。他の欄と重ならないか。

## 判明した事実

### F1: 判別はメッセージ番号で行う。作成の成否では判別できない

前 work（`20260828-rpg3-fspec-continuation`）は**作成の成否**で判別し、
通ったのが `INFDS` だけになった。しかし `INFSR` のリストは `QRG2075`（記入が不正）で、
`QRG2023`（語が無効）ではなかった。つまり `INFSR` は**有効な語**だった。

今回は**リストに出る `QRG2023` の有無**で判別する。これなら
**語ごとの正しい記入を用意しなくてよい**（30 件ぶんの仕掛けが要らない）。

`GENLVL(50)` を付けると重大度 30 でも**プログラムは作成される**ので、
`作成=○` は全件で真になる（実測。`ZZZZZZ` すら作成された）。**成否は見ない。**

### F2: リストのスプール名は `QRPGLST` ではなく「プログラム名」

`QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC` を `SPOOLED_FILE_NAME='QRPGLST'` で引いたら
**0 件**だった。実際は `K00` / `C01` のような**プログラム名**で入っている。

**この取り違えは静かに嘘をつく。** メッセージが 1 件も見つからないので
「QRG2023 が無い ＝ 有効」と判定され、**でたらめな `ZZZZZZ` まで「有効」になった**。
気付けたのは**対照を置いていたから**（`AGENTS.md` に追記済み）。

プログラム名で引けば、どのリストがどの回のものかも曖昧にならない。

### F3: 実機の判定（候補 30 件 / 対照 4 件）

`verify/probe-options.mjs`。結果は `verify/options-result.json`。
**対照 4 件（先頭・末尾に `INFDS` と `ZZZZZZ`）すべて期待どおり**——
末尾でも効いているので、途中で診断が止まっていない。

**有効 10 件**: `IGNORE` `INFDS` `INFSR` `PASS` `PLIST` `PRTCTL` `RECNO` `RENAME` `SFILE` `SLN`

**無効 20 件**（すべて `QRG2023`）: `ALIAS` `BLOCK` `DATA` `DATFMT` `DEVID` `DISK`
`EXTIND` `EXTMBR` `INDDS` `KEYED` `KEYLOC` `MAXDEV` `OFLIND` `PREFIX` `SAVEDS`
`SEQ` `STATIC` `TIMFMT` `USAGE` `USROPN`

**「有効」は不在証明ではない。** 10 件中 9 件は `QRG2023` の代わりに
**記入に関する別のメッセージ**が出ている——語は通り、記入(60-65)がその語に合わなかった、
という積極的な証拠になっている。

| 語 | 出たメッセージ |
|---|---|
| `IGNORE` | QRG2068, QRG2077, QRG2098 |
| `INFSR`  | QRG7005 |
| `PASS`   | QRG2050 |
| `PLIST`  | QRG2033 |
| `PRTCTL` | QRG2078 |
| `RECNO`  | QRG7006 |
| `RENAME` | QRG2072, QRG2077 |
| `SFILE`  | QRG2107 |
| `SLN`    | QRG2076 |
| `INFDS`  | （基準どおり。記入に使ったダミー `FDS` が実際にデータ構造名だったため） |

**語ごとに記入の意味が違う**ことがそのまま出ている（副ルーチン名・データ構造名・
レコード番号フィールド…）。記入欄を自由入力にする根拠でもある。

### F4: 桁は空いている

`resources/prompter/rpg/rpg3/ja/F-SPEC.json` の現状は
`CONTINUATION`(53) の次が `FILEADD`(66)。**54-65 は未定義**なので重なりは起きない。

なお **53 桁目の `K` は継続行そのものに書く**（ファイル行ではない）。
前 work で「ファイル行の 53 桁目に `K`」を試して失敗している（`20260828-rpg3-numeric-fields` の R7）。

### F5: 候補の出所は**実際に取りこぼしていた**（2 巡目）

1 巡目の候補は ILE の F 仕様キーワード由来。RPG III にしか無い語を拾えない懸念（R1）を
**確かめるために 2 巡目を流した**（`verify/candidates-round2.json`。20 語。対照 4 件とも期待どおり）。

**さらに 5 件が有効**: `SAVDS` `IND` `NUM` `ID` `COMIT`
（無効 15 件: `SAVIND` `FMTS` `MSGQ` `KEY` `START` `USER` `DTAARA` `LABEL` `SEQNO`
`RCDNBR` `ALTSEQ` `CMTID` `INCLUD` `SAVE` `OPEN`）

**つまり ILE 由来の候補は 15 件中 5 件（3 分の 1）を取りこぼしていた。**
→ **選択欄を列挙で縛ってはいけない。** 集合が閉じている保証がない。

### F6: メッセージ本文が判定を裏づける（`verify/probe-msgsummary.mjs`）

「QRG2023 でない ＝ 語は有効」と読んでよいかを本文で裏取りした。

| 語 | メッセージ | 本文（先頭） |
|---|---|---|
| `ZZZZZZ` | QRG2023 | `The Option entry is invalid. Continuation…` |
| `SAVDS` | QRG2156 | `**NUM, SAVDS, IND and ID options valid for**…` |
| `IGNORE` | QRG2098 | `IGNORE option specified for program-described…` |
| `SFILE` | QRG2107 | `File with SFILE option not externally-described` |

**どれも語そのものを名指ししている**——語は認識されており、文脈（装置種別・
外部記述かどうか）が合わないという指摘。読み替えは正しい。

**おまけに `QRG2156` は 4 語を並べている。** 「実機は有効な集合を並べてくれない」は
`QRG2023` については正しいが、**別のメッセージが部分集合を並べることはある**。

### F7: 有効な語は文脈に依存する

`SFILE` は外部記述ファイル、`IGNORE` も外部記述、`NUM`/`SAVDS`/`IND`/`ID` は WORKSTN。
**平たい選択肢一覧にすると「選べるのに使えない」語が並ぶ。**
語ごとの使いどころを説明として持たせるほうが実態に合う。

## 影響範囲

- `resources/prompter/rpg/rpg3/ja/F-SPEC.json` — 欄を 2 つ足す。
- 検証: `verify-prompter-roundtrip.mjs`（全 538 定義）/ `validate-prompter-defs.mjs`。
- 英語版は作らない（RPG III は原典が入手できない。AGENTS.md）。

## 実現性 / リスク

- **R1: 候補の出所に取りこぼしがある** → **実際にあった**（F5。15 件中 5 件）。
  2 巡目でも「まだ無い語」の可能性は消えない（候補に無い語は検出できない、という
  RPG III の命令コードと同じ限界）。**選択欄を列挙で縛らない**ことで無害化する。
- **R2: `dropdown` は列挙外の値を打てない。** `attributes.restricted:false` は
  検証を緩めるだけで、`<select>` そのものが自由入力を受け付けない。
  F5 で取りこぼしが確定したので、**`dropdown` は採らない**。
  （なお同じ問題は CL 側の 86 欄にもある。別項目として backlog へ。）

## 実装アンカー

- A1: 足す先 — `vscode-extension/resources/prompter/rpg/rpg3/ja/F-SPEC.json`
  の `CONTINUATION`(53) と `FILEADD`(66) の間。
- A2: 桁の書き戻し — `src/prompter/commandText.ts` の `buildRpgLineText`
  （`sourceStart` / `sourceLength` を見る。**変更不要**）。
- A3: 条件表示 — `dependsOn` の `effect:"visible"`（`src/prompter/visibilityRules.ts:64`）。
  `CONTINUATION` が `K` のときだけ出す。

## 実装時の注意

- **`restricted` は `SerializableField` に載っていない。** 画面の作り分けに使うなら
  描画モデルに足す必要がある（`formModel.ts`）。
- 記入(60-65)は**ファイル行では空白でなければならない**（`QRG2016`。
  20-23 / 47-52 / 60-65 / 67-70 / 73-74）。継続行でのみ意味を持つので、
  条件表示で守るのが素直。
