# 調査: 属性編集とプロパティ／様式ツリーに必要な事実

## 調査の問い

- **Q1**: 定数のリテラルだけを差し替えられるか（後ろにキーワードが続く場合を壊さないか）。
- **Q2**: 属性の値（型・小数桁・使用・キーワード）は既存のモデルから取れるか。
- **Q3**: 「キャンバスに描かれない項目」（AC3）は `resolveDspfLayout` の結果から取れるか。
- **Q4**: 名前を変えたとき、同じ DDS 内の他の記述に影響するか。
- **Q5**: 行の長さに上限はあるか（リテラルを伸ばしたときに何が起きるか）。

## 判明した事実

- **F1: 定数のリテラルはキーワード欄の先頭にあり、後ろにキーワードが続きうる。**
  `readConstant`（`src/core/dds/ddsLogicalUnits.ts:70`）は
  `/^'((?:[^']|'')*)'/` を**キーワード欄の先頭**に当てて読む。したがって
  `2'顧客保守'DSPATR(HI)` のような行では、**先頭のリテラルだけを差し替え、残りをそのまま繋ぐ**
  必要がある。リポジトリのサンプル（`docs/src/*.dspf` / `*.prtf`）には
  「定数＋キーワード」の実例が無いので、**テストで自分で作る**。

- **F2: 属性の一部は `DspfPlacedItem` に無い。**
  現状あるのは `kind` / `name` / `text` / `row` / `column` / `width` / `usage` / `dataType`
  （`dataType` は PR #109 で追加）/ `conditioning` / `occupancy` / `sourceLine` / `recordName`。
  **`decimals`（36-37 桁）と `keywords`（45 桁〜）は持っていない。**
  ただし `keywords` は `toLogicalUnits` が単位ごとに連結して持っている（`LogicalUnit.keywords`）ので、
  **公開するだけ**でよい。

- **F3: 「描かれない項目」は `layout.items` に入らない**（AC3 に直接効く）。
  `resolveDspfLayout` は次を `continue` で落とす:
  - 位置欄が数字でない → `invalid-position`（`dspfLayout.ts:257`）
  - 位置欄が空 → `missing-position`（`:267`）
  - **画面に出ない用途（`H` / `P` / `M`）→ 診断も出さずに落とす**（`:220`）
  したがって**様式ツリーは `layout.items` から作れない**。
  **`toLogicalUnits` から直接作る**（配置の有無と無関係に、様式と項目を列挙できる）。

- **F4: 名前の参照解決は core に無い。**
  `SFLCTL` / `SFLSIZ` 等、フィールド名を引数に取るキーワードの**解釈は実装されていない**
  （`grep` で該当なし）。参照フィールド（29 桁の `R`）も解決していない（`ddsFieldWidth.ts:48`）。
  → **名前を変えても他所は追随しない**。本 work では追跡せず、**利用者に見えるところ
  （プロパティの説明文）で注意を促す**に留める。

- **F5: 行の上限は 100 桁**（`src/lint/rules/lineLength.ts:15` `MAX_COLUMN = 100`）。
  原典が「仕様書の注記以外は 7〜80 桁」としつつ、**81-100 桁の目盛りを持つ**ため 80 では切らない。
  → リテラルを伸ばして 100 桁を超えるなら**書けない**（拒否する）。

## 影響範囲

- **触る**: `core/dds/dspfLayout.ts`（`decimals` / `keywords` の公開）、
  `core/dds/ddsEdit.ts`（属性の編集操作）、`core/dds/ddsEditWriteBack.ts`（属性欄の書き戻し）、
  `core/dds/dspfRenderModel.ts`（プロパティに出す値と、**配置に依らない項目一覧**）、
  `dds/webview/{protocol,ui}.ts` ＋ `ui.css`（3 ペイン・プロパティ・ツリー）、
  `dds/editorProvider.ts`（新しい編集メッセージの通し）、`dev/standalone.ts`（同上）。
- **触らない**: `dspfPreview*` / `prtfPreview*` / `lint/*` / `cli/*` / `prompter/*` / `contributes`。

## 実現性 / リスク

- **実現可能**。編集の骨格（検証 → 置き換え指示 → 適用）は PR #109 で通っており、
  **属性はその上に操作を 1 つ足すだけ**。
- **リスク1: 定数のリテラル差し替えで後続キーワードを壊す**（F1）。
  実サンプルに例が無いので**気付きにくい**。テストで先に作る。
- **リスク2: ツリーの出所を間違える**（F3）。`layout.items` から作ると
  「描かれない項目に手が届く」という AC3 の狙いが**そのまま落ちる**。
- **リスク3: 名前変更の波及**（F4）。core が参照を追わないので、
  `SFLCTL(NAME)` のような記述は**古い名前のまま残る**。本 work の範囲外だが、
  **利用者に見える形で断る**必要がある。
- **リスク4: プロパティの入力とキャンバスのキー操作が競合**（AC-I5）。
  入力欄で矢印キーや `Delete` を押したときにキャンバスの項目が動く/消えると事故になる。

## 実装アンカー

- **A1: 桁定義**（`src/core/ddsLayout.ts:14` `DDS_COLUMNS`、`:38` `ddsField`、`ddsReplaceField`）。
- **A2: 属性の書き戻し先**（`src/core/dds/ddsEditWriteBack.ts` — `writeBackLength` の隣に並べる）。
- **A3: 編集操作の型と検証**（`src/core/dds/ddsEdit.ts:29` `DdsEdit`、`:74` `validateDdsEdits`、
  `:126` `applyDdsEdits`）。
- **A4: 論理単位**（`src/core/dds/ddsLogicalUnits.ts:70` `readConstant`、`:73` `keywordAreaOf`、
  `toLogicalUnits`）— **ツリーの出所**。
- **A5: 配置と診断**（`src/core/dds/dspfLayout.ts:70` `DspfPlacedItem`、`:220` 非表示用途の除外、
  `:267` 位置なしの除外）。
- **A6: 描画モデル**（`src/core/dds/dspfRenderModel.ts:62` `buildDspfRenderModel`）。
- **A7: UI**（`src/dds/webview/ui.ts:57` `startEditor`、`:154` `measure`、`ui.css`）。
- **A8: 2 つの器**（`src/dds/editorProvider.ts:39`、`dev/standalone.ts`）。
- **A9: 確定デザイン**（`docs/design/dds-designer/mock-c1-standalone-first.html` — 3 ペインの実物）。

## 実装時の注意

- **リテラルの差し替えは「先頭の 1 つだけ」**（F1）。`readConstant` と同じ正規表現を使い、
  **同じ規則を 2 か所に書かない**（共有に切り出す）。
- **ツリーは `toLogicalUnits` から**（F3）。`layout.items` を使うと描かれない項目が落ちる。
- **名前の変更は追随しない**（F4）ので、プロパティにその旨を出す。
- **プロパティ入力中はキャンバスのキー操作を止める**（既存 `ui.ts` の `isTypingTarget` を使う。
  いまは矢印と `Delete` にしか効いていないので、範囲を見直す）。
- 100 桁を超える書き換えは拒否する（F5）。

## spec への申し送り

1. **属性の編集操作を 1 つ足す**（`setAttributes`）か、欄ごとに分けるか。
   1 つに束ねるほうが「1 回の確定で複数欄が変わる」を素直に表現できる。
2. **ツリーの項目と描画モデルの項目は別物**（F3）。モデルに
   「配置された項目（描く）」と「全項目（一覧）」の 2 つを持たせる形が要る。
3. **プロパティに出す数字**（占有・右端の余裕）は `occupancy` と `canvas.columns` から**UI で引き算**
   してよい（文字を数える計算ではないので、真実源は増えない）。
4. 名前変更の波及（F4）は**本 work の対象外**。プロパティに注意書きを出し、backlog へ。
