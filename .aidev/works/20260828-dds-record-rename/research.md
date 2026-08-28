# 調査: 様式の改名と参照追随

## 調査の問い

- Q1: 実機は同じ名前の様式を 2 つ通すか。名前の長さの上限は。
- Q2: 参照が存在しない様式を指すと落ちるか（＝追随に値打ちがあるか）。
- Q3: `HLPRCD` の「ファイル名を省いたときだけこのファイル内」は実機で確かめられるか。
- Q4: `MNUBARDSP` / `MNUBARCHC` は確かめられるか。
- Q5: いまの改名の経路（項目）はどうなっているか。

## 判明した事実

実機は IBM i 7.3 / `CRTDSPF`。再現は
`verify/probe-record-names.mjs`（N 系）と、切り分けの追試（H 系・M 系）。

### F1(Q1): 同じ名前の様式は**通らない**／名前は 10 桁まで

| 形 | 実機 |
|---|---|
| 同じ名前の様式が 2 つ | **通らない**（N1） |
| 別々の名前 | 通る（N2） |
| 様式名 10 文字 | 通る（NC） |
| 様式名 11 文字 | **通らない**（ND） |

### F2(Q2): `SFLCTL` / `ERASE` / `PASSRCD` は**存在しない様式を指すと落ちる**

| 形 | 実機 |
|---|---|
| `SFLCTL(SFLREC)`（在る） | 通る（N3） |
| `SFLCTL(OLDNAME)`（無い） | **通らない**（N4） |
| `ERASE(REC1)` / `ERASE(GONE)` | 通る（N5）/ **通らない**（N6） |
| `PASSRCD(REC1)` / `PASSRCD(GONE)` | 通る（N7）/ **通らない**（N8） |

追随しないと壊れることが確かめられている。

### F3(Q3): `HLPRCD` は**コンパイラーが見ていない**

最初の probe では 3 形とも落ちたが、**対照も落ちた**——`HLPRCD` には
ファイル・レベルの `HELP` が要る（H3 が通らない）。`HELP` を足すと:

| 形 | 実機 |
|---|---|
| `HELP` ＋ `HLPRCD(HELPREC)`（在る） | 通る（H1） |
| `HELP` ＋ `HLPRCD(GONE)`（**無い**） | **通る**（H4） |
| `HELP` ＋ `HLPRCD(DFTHELP HELPFILE)` | 通る（H5） |

**存在しない様式でも通る**＝ コンパイラーは見ていない。つまり
**追随しないと実行時まで気付けない**ので追う値打ちはむしろ大きい。
裏を返すと**誤って追っても実機は教えてくれない**ので、原典の条件
「ファイル名を指定しない場合には…定義中のファイルに入っていなければなりません」を
厳密に守る（引数が 1 つのときだけ追う）。

### F4(Q4): `MNUBARDSP` / `MNUBARCHC` は**確かめられなかった**

メニュー・バーの通る形を組めず、**対照（正しい参照）も落ちた**（M1）。
判定できないので**原典だけを根拠にする**。原典の文は明確:

- `MNUBARDSP`: 「メニュー・バー・レコードは、定義中のレコードと**同じファイル内に
  存在**しなければなりません」
- `MNUBARCHC`: 「指定するレコードは、**ファイル内に存在するもの**でなければならず」

`MNUBARDSP` には形式が 2 つあり、`MNUBARDSP[(&pull-down-input)]` の 1 つ目は
様式名ではない。**`&` で始まる引数を除く**守りが要る。

### F5(Q5): 項目の改名の経路

- 編集は `setAttributes`（`name` を含む）。宛先は `itemUnitAt`（項目だけ）。
- 追随は `renameReferenceResults`（`ddsEdit.ts`）が**物理行ごと**に
  `renameFieldReferences` を当てる。
- 参照の表は `ddsReferences.ts` の `FIELD_ARGUMENTS` と `NOT_FOLLOWED`。
  様式のキーワード 6 件は `NOT_FOLLOWED` に「改名の手段が無い」と書いてある。

## 影響範囲

- `src/core/dds/ddsReferences.ts` — 様式の表（`RECORD_ARGUMENTS`）と
  `findRecordReferences` / `renameRecordReferences`。`NOT_FOLLOWED` から 6 件を外す。
- `src/core/dds/ddsEdit.ts` — `renameRecord` の型・検証・適用。
  `renameReferenceResults` を項目・様式で使い回す。
- `src/dds/webview/protocol.ts` / `ui.ts` — 受け渡しと名前の入力欄。

## 実現性 / リスク

- **項目の参照を巻き込まない**こと。表を分ければ起きないが、テストで固定する。
- 名前の重複は**編集の時点で**弾ける（同じソースの中の話なので）。

## 実装アンカー

- A1: 参照の表（`src/core/dds/ddsReferences.ts` `FIELD_ARGUMENTS` の隣）。
- A2: 追随の当て方（`src/core/dds/ddsEdit.ts` `renameReferenceResults`）——
  **どの参照を追うかだけを差し替える**（物理行ごとに当てる作りは同じ）。
- A3: 様式のプロパティ（`src/dds/webview/ui.ts` `renderRecordProperties`）。
- A4: 項目の名前の入力欄（`src/dds/webview/ui.ts` `attributeInput`）——
  約束（Enter / Esc / blur・同じ値なら送らない）をそろえる相手。

## 実装時の注意

- **`&` で始まる引数は様式名ではない**（F4）。位置だけで決めない。
- **`HLPRCD` は引数が 1 つのときだけ**（F3）。
- 「（様式の外）」＝ 最初の様式より前の行には名前が無いので、入力欄を出さない。

## spec への申し送り

- 実機で確かめたものと**原典だけのもの**を表の中で書き分ける（F4）。
- 拒否は「ソースに書けないもの」だけという既存の方針に沿う——
  名前の重複は実機が通さないので拒否してよい（F1）。
