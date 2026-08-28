# 調査: 2 次画面サイズでの編集

## 調査の問い

- Q1: 上書き行は**どこに置けるか**（原典に規定が無い。挿入位置の決定に要る）。
- Q2: 1 項目に上書き行を **2 本**置けるか。
- Q3: 上書き行は**条件付けの欄に何を書けるか**（標識を混ぜられるか）。
- Q4: **条件が付いた項目**にも上書き行を付けられるか。
- Q5: 上書き行は位置以外の欄（長さ）を持てるか。
- Q6: 既存の `move` は何を宛先にしているか。

## 判明した事実

すべて実機（IBM i 7.3 / `CRTDSPF`）に判定させた。原典（`DSPSIZ` / `条件付け (7 - 16 桁目)`）は
上書き行の**置き場所を書いていない**ため、原典照合では決まらない。
再現: `verify/probe-override-placement.mjs` / `verify/probe-conditioned-override.mjs`。

- F1(Q1): **項目の run の直後**に置ける。run の途中には置けない。
  | 形 | 結果 |
  |---|---|
  | 項目行のすぐ後ろ | 通る (P1) |
  | 継続行(`+`)の後ろ | 通る (P2) |
  | 継続行の**途中**（項目行と継続の間） | **通らない** (P3) |
  | 単独キーワード行の後ろ | 通る (P4) |
  | 項目行の**前** | **通らない** (P5) |
  | 様式の直後（先行する項目が無い） | **通らない** (PB) |
  2 項目が並ぶとき、上書き行は**直前の項目**に付く (P6) ——`toLogicalUnits` の
  いまの解釈（`ddsLogicalUnits.ts:515`）と一致する。
- F2(Q2): **2 本は置けない** (P9)。1 項目 1 本。
- F3(Q3): 条件付けの欄に書けるのは**画面サイズ条件名だけ**。
  標識を足すと通らない (Q3)、標識だけでも通らない (Q7)。
- F4(Q4): **条件が付いた項目にも付けられる**。項目行の標識 (Q2)、OR 前置き (Q4)、
  標識つきの定数 (Q5) のいずれも通る。
- F5(Q5): **長さ欄を持てない** (PA)。条件名と位置だけ。
- F6(Q6): `move` は `itemUnitAt(units, sourceLine)` で論理単位を引き、
  `edit.sourceLine - 1` の行を `writeBackPosition` で書き換える
  （`ddsEdit.ts:376-388`）。**宛先は代表行 1 本に固定**されている。

### 誤判定を 1 件踏んだ（記録）

最初の probe で「標識つきの項目には上書き行を付けられない」(P7 通らない) と出た。
**対照（上書き行なしの標識つき項目）を足したら、それも通らなかった** ——
原因は probe 側で、標識を 8 桁目から 3 桁 (`" 1"`) で書いていた。
正しくは **9-10 桁に 2 桁** (`01`)。直すと両方通る。
AGENTS.md「消去法で決めない」と同じ筋で、**対照を置かないと probe のバグが
実機の規則に見える**。

## 影響範囲

- `src/core/dds/ddsEdit.ts` — `move` の宛先の分岐、検証、上書き行の生成。
- `src/core/dds/ddsLogicalUnits.ts` — `alternatePositions`（既にある）。挿入位置に要る
  「run の末尾」を出す口が無い。
- `src/core/dds/dspfScreenSize.ts` — 2 次のサイズと条件名。書く名前の決定に要る。
- `src/dds/webview/ui.ts` — `onPointerDown` の早期 return（D3 で塞いだ箇所）。
- `src/dds/webview/protocol.ts` — 編集の受け渡し。
- `src/cli/dds.ts` — `patch` の `--screen-size`。

## 実現性 / リスク

- 実機の規則は上のとおり確定しており、書き出す形は 1 通りしかない。
- リスクは**挿入によって行番号がずれる**こと。`DdsEditResult` は 0 始まりの区間
  置き換えなので、挿入（`replaceFrom === replaceTo`）は既に表現できる
  （`ddsEdit.ts:138-144` のコメント）。複数の編集を 1 回で渡すときの順序に注意。

## 実装アンカー

- A1: `move` の適用（`src/core/dds/ddsEdit.ts:376` `case "move"`）— 宛先の分岐を入れる。
- A2: `move` の検証（`src/core/dds/ddsEdit.ts:297`）— 2 次固有の拒否を足す。
- A3: 上書き行の探索（`src/core/dds/dspfLayout.ts:340`）— 同じ突き合わせ方
  （`matchesScreenSize`）を編集側でも使う。**写さずに共有する。**
- A4: 掴めなくしている箇所（`src/dds/webview/ui.ts` の `onPointerDown` 早期 return）。
- A5: 条件名の書き出し（`src/core/dds/ddsConditionWriteBack.ts` `formatScreenSizeArea`）
  — 9 桁目から書く。既にある（`20260828-dds-screen-size-column`）。
- A6: 2 次のサイズと条件名（`src/core/dds/dspfScreenSize.ts:37` `ScreenSizes.secondary`）。

## 実装時の注意

- **`formatScreenSizeArea` は 9 桁目から書く**。8 桁目は実機が通さない
  （`20260828-dds-screen-size-column` で回帰を 1 件出している箇所）。
- **上書き行に長さを書かない**（F5）。`writeBackPosition` は位置欄しか触らないので、
  空の A 仕様書行から作れば足りる。
- **run の末尾を数え直さない**。`LogicalUnit.sourceLines` には上書き行も入っている
  （`ddsLogicalUnits.ts:526`）ので、その最大値が run の末尾になる。
- `alternatePositions` は 0 本か 1 本（F2）。ただし**入力が壊れていれば 2 本ありうる**
  ので、探すときは `find` で先頭を採る。

## spec への申し送り

- 拒否は「ソースに書けないもの」だけ（`ddsEdit.ts:145` の方針）。**2 次が宣言されていない**
  ・**PRTF**・**画面サイズ条件名が決まらない**の 3 つが該当する。
- `resize` を 2 次で塞ぐ根拠は F5（長さ欄を持てない＝サイズごとに長さは変えられない）。
