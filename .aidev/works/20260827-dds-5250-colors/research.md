# 調査: 5250 の配色

## 調査の問い

- Q1: 色と表示属性の対応は原典にどう書かれているか。表として取れるか。
- Q2: `COLOR` を書かないときの色はどう決まるか。
- Q3: 「書いたのに出ない」組み合わせはあるか。
- Q4: 実機と突き合わせる手段はあるか。
- Q5: core に表を持ち込む手段は（core はファイルを読まない）。

## 判明した事実

### F1: 原典に**16 進の対応表**がある（32 行）

`docs/origin/dds/detail/rzakc_rzakcmstdfdspat.htm` の「有効な P フィールド値 (無保護)」。
`DSPATR(&P フィールド)` に書ける値の表だが、中身は**5250 の表示属性バイトそのもの**。

| 16 進数 | 制限がある場合の色 | 完全な色 |
|---|---|---|
| 20 | 通常 | 緑 |
| 21 | 反転表示 | 緑、反転表示 |
| 22 | 高輝度 | 白 |
| 27 | 非表示 | 非表示 |
| 28 | 明滅 | 赤 |
| 30 | 桁区切り線 | 空、桁区切り線 |
| 32 | 高輝度、桁区切り線 | 黄、桁区切り線 |
| 38 | 明滅、桁区切り線 | ピンク |
| 3A | 明滅、高輝度、桁区切り線 | 青 |
| …（全 32 行） | | |

**HTML の表として構造が取れる**（`<tr>`/`<td>` を数えて確認済み。9 行の色の表も同様）。
もう 1 つ「(保護)」の表（`A0`-`BF`）があり、**下位 5 ビットの意味は同じ**。

ビットの割り当ては表から機械的に読める:
`RI=0x01` / `HI=0x02` / `UL=0x04` / `BL=0x08` / `CS=0x10`、基底 `0x20`。

### F2: `COLOR` を書かないときの色は `CS` / `HI` / `BL` で決まる

`…dfcolor.htm` の「表 1. カラー表示装置での DSPATR キーワード」（表として抽出済み）:

| CS | HI | BL | 色 |
|---|---|---|---|
| | | | 緑 (通常) |
| X | | | 空 |
| | X | | 白 |
| | | X | 赤、明滅なし |
| | X | X | 赤、明滅あり |
| X | X | | 黄 |
| X | | X | ピンク |
| X | X | X | 青 |

F1 の 16 進表と**完全に一致する**（`0x30`=空 / `0x22`=白 / `0x28`=赤 / `0x32`=黄 /
`0x38`=ピンク / `0x3A`=青）。→ **16 進表 1 つで両方を賄える。**

原典はさらに: 「緑はカラー表示装置におけるフィールドのデフォルトの色」
「フィールドに DSPATR(HI)、DSPATR(CS)、または DSPATR(BL) を指定した場合は、
COLOR(GRN) も同時に指定しなければ、そのフィールドの色は変更されます」。

### F3: 「書いたのに出ない」組み合わせがある（Q3 の答え）

原典（`…dfdspat.htm` の注）:

> 5250 表示装置を使用する場合に、同一フィールドについて **UL、HI、および RI の 3 つの属性を
> 同時に指定した場合には、ND を指定した場合と同じ結果**になります。

16 進表とも整合する（`0x27` = `RI|HI|UL` = 非表示。`0x2F` / `0x37` / `0x3F` も同じ）。
**コンパイルは通り、警告も出ない。** 実機に出して初めて「消えている」と分かる類。

### F4: `DSPATR` の値は 11 種（原典の表）

すべてのフィールドに有効: `BL` `CS` `HI` `ND` `PC` `RI` `UL`
入力可能フィールドにのみ有効: `MDT` `OID` `PR` `SP`

**見え方に効くのは `BL` `CS` `HI` `ND` `RI` `UL` の 6 つ**。
`PC`（カーソル位置決め）・`MDT` / `OID` / `SP` / `PR` は色にも属性にも効かない。

`COLOR` の値は 7 種: `GRN` `WHT` `RED` `TRQ` `YLW` `PNK` `BLU`。

### F5: 実機と突き合わせられる（Q4 の答え）

`ts5250` の画面モデルの `Cell` は
`color` / `reverse` / `underline` / `blink` / `columnSeparator` / `nonDisplay` を**そのまま持つ**
（`packages/tn5250/dist/screen/types.d.ts`）。

→ 全 32 通りを並べた DSPF を実機で表示させ、**セルの属性と本 PJ の解決結果を突き合わせられる**。
`20260827-dds-keyword-continuation` / `…-keyword-edit` と同じ経路（実機は IBM i 7.3・`ASAOLIB`）。

### F6: core に表を持つ手段は既にある

`src/core/dds/editCode.ts` が
`import editCodeData from "../../../resources/completion/dds-editcodes.json"` している。
**静的な JSON の import はビルド時に埋め込まれる**（tsc の `resolveJsonModule` と esbuild の両方）。
生成は `docs/origin/generate-dds-editcodes.mjs`、検査は `verify-dds-editcodes.mjs`。

→ **同じ形にする**。表は原典から生成し、core は import するだけ。

### F7: 非表示の描き方（Q の未確定事項）

原典は「非表示」としか言わない。実機では**文字が出ない**（桁は占有する）。

デザイナで完全に消すと、**直すために選べなくなる**——条件標識のときと同じ問題で、
そのときは「キャンバスから消し、一覧に理由を残す」形にした。
しかし配色は**表示の話**であって条件のような状態ではないので、
**枠だけを残して中身を伏せる**方が素直（そこに項目があることは見えている必要がある）。

## 影響範囲

- `docs/origin/generate-dds-attributes.mjs`（新規）/ `verify-dds-attributes.mjs`（新規）
- `vscode-extension/resources/completion/dds-attributes.json`（生成物）
- `src/core/dds/dspfAttributes.ts`（新規）— キーワード → 表示属性
- `src/core/dds/dspfRenderModel.ts` — `RenderItem` に表示属性を載せる
- `src/dds/webview/ui.ts` / `ui.css` — 配色で描く、切替
- `package.json` の `verify:defs` に検査を足す

## 実現性 / リスク

- **リスク: 表の抽出**。原典の表は `<table>` だが、日本語版はセルに脚注番号が混ざる
  （`空1` / `黄1`）。**数字を落とす**必要がある。
- **リスク: 色の名前**。原典は日本語（緑・空…）。**色の識別子は英語**（`green` / `turquoise`）に
  正規化し、日本語は表示にだけ使う。
- **リスク: 既定の変更**。配色を既定で入れると、いままでの見え方が変わる。
  requirement で「既定は入」と決めた（実機の見え方を出すのが目的）。
- **リスク: 条件つきの `COLOR`**（`50 COLOR(RED)`）。`toLogicalUnits` がキーワード行の
  条件付け欄を捨てるので、**条件に関係なく効いてしまう**。スコープ外とし backlog へ。

## 実装アンカー

- A1: 生成の先例（`docs/origin/generate-dds-editcodes.mjs`。出力は
  `vscode-extension/resources/completion/dds-editcodes.json`）
- A2: core が表を import する先例（`vscode-extension/src/core/dds/editCode.ts:1`）
- A3: 検査の登録（`vscode-extension/package.json` の `verify:defs`）
- A4: `RenderItem`（`vscode-extension/src/core/dds/dspfRenderModel.ts:38`）
- A5: 描画と切替（`vscode-extension/src/dds/webview/ui.ts` の `renderItems` /
  `display` オブジェクト / `template()` のツールバー）
- A6: 実機との突き合わせの先例
  （`.aidev/works/20260827-dds-keyword-edit/verify/verify-keyword-fold.mjs`）

## 実装時の注意

- **16 進表 1 つで足りる**（F2）。色の表は**検査**に使う（2 つの表が食い違わないことを確かめる）。
- **脚注番号を値に混ぜない**（`空1` → `空`）。
- `PC` / `MDT` / `OID` / `SP` / `PR` は**見え方に効かない**。効かないものを効かせない。
- 明滅は**点滅させない**（目に障る）。静的な印にする。
- **桁と位置は変えない**（配色は色だけ）。

## spec への申し送り

- 表は原典から生成し、core は import するだけ（F6）。
- 非表示は**枠だけ残して中身を伏せる**（F7）。
- 条件つきの `COLOR` / `DSPATR` はスコープ外（backlog へ）。
