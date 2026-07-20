# CDML 属性の扱い

実機の `*CMD` から `QCDRCMDD` で取れる CDML（`docs/origin/cmddef/*.xml`）に含まれる
全属性について、本 PJ が**使うか使わないか、その理由**を記録する。

「まだ見ていない属性がある」状態を無くすための一覧。DTD は
`/QIBM/XML/DTD/QcdCLCmd.dtd`、件数は 244 コマンドの実測値。

反映は `docs/origin/generate-cdml-rules.mjs` が行う。**JSON は手で直さない。**

## 使っている

| 属性 | 件数 | 使い道 |
|---|---|---|
| `Kwd` | 3112 | パラメータ名の対応付け |
| `Dep` / `DepParm` | 536 | 相関チェック → `dependencies` |
| `PmtCtl` / `PmtCtlCond` | 231 | 条件表示 → `promptControl` |
| `Value` の `MapTo` | 1633 | 内部値への変換 → `valueMap` |
| `Rstd` | 2500 | 列挙値以外を書けるか → `attributes.restricted` |
| `Len` | 1943 | 長さ → `attributes.maxLength`（DEC は「桁数.小数部」） |
| `Type` | 3112 | 数値型の判定 → `attributes.numericOnly` |
| `Case` | 1907 | `MIXED` は英大文字を強制しない |
| `RangeMinVal` / `RangeMaxVal` | 194 | 数値の範囲 → `attributes.minValue` / `maxValue` |
| `Rel` / `RelVal` | 66 | 値の制約 → `attributes.valueRelation` |
| `AlwVar` | 2500 | CL 変数を書けるか → `attributes.allowsVariable`（NO は 26 欄） |
| `Max` | 2500 | 繰り返しの上限 → `maxOccurrences` |
| `IsFile` / `IsPgm` / `IsDtaAra` | 149 欄が該当 | 欄が指すオブジェクトの種類 → `objectKind`。ワークスペースのソースから名前の候補を出す |
| `Dft` | 1658 | 既定値の裏取り（実測で差異ゼロ。上書きはしない） |
| `Min` | 3112 | 必須の裏取り（実測で**食い違いゼロ**。反映不要） |
| `Val` | 13712 | 選択肢の値。`MapTo` と対で使う |
| `CtlKwd` / `CtlKwdRel` / `CmpVal` / `CmpKwd` | — | `Dep` / `PmtCtl` の制御条件 |
| `NbrTrue` / `NbrTrueRel` | — | 成立した条件の個数の閾値 |
| `LglRel` | 49 | `PmtCtl` グループの AND/OR |
| `MsgID` | — | 違反時のメッセージ ID。文面の末尾に残す |
| `CmdName` | 244 | コマンド名の対応付け |

## 使わない — 理由つき

### `PosNbr`（2500）— **定位置指定の順序ではない**

使ってはいけない。実機で確かめた結果、**CL パーサーは原典の「定位置 N」に従い、
`PosNbr` には従わない**。

`CHGJOBD` は原典が「JOBD=1, USER=2, JOBQ=3」、`PosNbr` は「JOBD=1, JOBQ=2, JOBPTY=3」で
食い違う（`MaxPos=3`）。位置 2 に修飾名を書いて実機でコンパイルすると
`CPD0049『Qualified name not valid for parameter USER.』`——
**位置 2 は USER**、つまり原典が正しい。

543 欄中 53 欄でこの食い違いがあり、`PosNbr` を採っていればコマンド・ヘルプの
「定位置指定順」が誤りになっていた。既存の `positional`（原典由来）が正。

### 表示文言（`Prompt` / `PromptMsgID` / `Choice` / `ChoiceMsgID`）

pub400 は `QLANGID(ENU)` で **CDML の文言は英語**。日本語 NLS(`QSYS2962`) を
ライブラリー・リストに入れて `LANGID(JPN)` にしても `CCSID=37` /
`Prompt="Save Object"` のまま（`*CMD` オブジェクト側に紐づくため）。
本 PJ の日本語は原典 HTML 由来なので、こちらは採らない。

### 実行時の受け渡し（プロンプターに関係しない）

`RtnVal` / `PassVal` / `PassAtr` / `Vary` / `ListDspl` / `KeyParm` / `CCSID` —
コマンド処理プログラムへの値の渡し方の指定であり、入力補助には関係しない。

### 実機への問い合わせが要る

`ChoicePgm` / `ChoiceLib`（57）/ `PmtCtlPgm` / `PmtCtlLib`（3）—
選択肢や条件表示をプログラムで決めるもの。実機に接続しないと解決できない。
本 PJ は接続不要を方針にしているため採らない。

### 検査に足せるが今は採らない

| 属性 | 件数 | 理由 |
|---|---|---|
| `Constant` | 450 | 該当が既存定義に 1 件（`CRTCBLMOD.RESWORD`）。欄を隠すと書き戻しで値が落ちるおそれがあり、得るものに見合わない |
| `Full` | `YES` 11 | 値が欄を埋めきる必要があるか。該当が少なく、誤って弾くおそれの方が大きい |
| `AlwUnprt` | `NO` 1 | 印刷不能文字の可否。該当 1 件 |
| `Expr` | `NO` 588 | CL 式を書けるか。本 PJ は式の構文解析を持たないため、判定に使えない |
| `DspInput` | `PROMPT` 8 | 入力の表示方法。該当が少ない |
| `InlPmtLen` | 725 | 入力欄の表示幅。見た目のみで、正誤には影響しない |

### 実データに出現しない

`RelKwd` / `RangeMinKwd` / `RangeMaxKwd` / `CurLib` — 244 コマンドで 0 件。
出現したら扱いを決める。

### コマンド単位のメタ情報

`CmdLib` / `HlpPnlGrp` / `HlpPnlGrpLib` / `HlpID` / `MsgF` / `MsgFLib` /
`PmtFile` / `PmtFileLib` / `PmtFileMsg` / `ExecBatch` / `ChgCmdExit` /
`RtvCmdExit` / `PrdLib` / `PmtOvrPgm` / `PmtOvrLib` — ヘルプ・パネルや実行環境の
指定で、入力補助には使わない。`MaxPos` は `PosNbr` の解釈にのみ使った（上記）。

`DTDVersion` は CDML 自体の版（実データはすべて 2.0）。`Text` は
`ChoicePgmText` の選択肢説明で、英語のため採らない（表示文言と同じ理由）。
