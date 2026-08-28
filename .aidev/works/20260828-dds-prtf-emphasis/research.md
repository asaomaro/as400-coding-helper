# 調査: 帳票の強調

## 調査の問い

- Q1: 帳票の見え方に効くキーワードはどれか。
- Q2: 使用レベルは（様式に書けるか）。
- Q3: カラー名の集合は画面と同じか。
- Q4: いまの描画モデルは帳票の見え方をどう扱っているか。

## 判明した事実

### F1(Q1): 4 つ。うち**見え方に載せられるのは 3 つ**

原典の説明文から見え方に関わるものを拾うと `COLOR` / `HIGHLIGHT` / `LINE` /
`UNDERLINE`。`LINE` は**線を印刷するキーワード**（項目の見え方ではない）なので
この work では扱わない。

### F2(Q2/Q3): **実機の判定**（IBM i 7.3 / `CRTPRTF`）

`verify/probe-prtf-appearance.mjs`。原典と**全件一致**した。

| 形 | 実機 |
|---|---|
| `HIGHLIGHT` を様式に | 通る |
| `HIGHLIGHT` を項目に | 通る |
| **`UNDERLINE` を様式に** | **通らない** |
| `UNDERLINE` を項目に | 通る |
| `COLOR(BLK)` / `COLOR(BRN)` | 通る |
| **`COLOR(WHT)`** | **通らない** |
| `COLOR(*RGB 0 0 0)` | 通る |
| **`COLOR` を様式に** | **通らない** |
| `HIGHLIGHT` ＋ `UNDERLINE` ＋ `COLOR` を項目に | 通る |
| **`DSPATR(HI)` を帳票に** | **通らない** |

### F3: 原典の生テキスト（判断に効く文）

- `HIGHLIGHT`: 「HIGHLIGHT を**レコード・レベルで指定した場合**には、このキーワードは
  該当のレコードの中の**すべてのフィールドに適用**されます。したがって、レコード・
  レベルおよびフィールド・レベルの HIGHLIGHT キーワードがともに指定されていて、
  **どちらか一方の標識条件が満たされていれば**、その HIGHLIGHT キーワードが使用されます」
- `COLOR`: 「COLOR を指定しなかった場合…**カラーは黒 (デフォルト)** になります」／
  カラー名は `BLK 黒 BLU 青 BRN 茶 GRN 緑 PNK ピンク RED 赤 TRQ 空 YLW 黄` の 8 つ。
- `COLOR`（装置依存）: 「他の値は、黒と白の中間のカラーになります
  (**出力装置によって異なります**)」「**ハイライト・カラーは装置に依存します**」

### F4(Q4): **画面の表を帳票に当てていた**

`toRenderItem`（`src/core/dds/ddsRenderItem.ts:153`）は種別に関わらず
`resolveAppearanceUnder(item.keywordGroups, {})` を通す。これは画面用
（`COLOR` の名前が違い、`DSPATR` を読む）。帳票では:

- `COLOR(BRN)` / `COLOR(BLK)` が**読めない**（画面の表に無い）
- `COLOR(WHT)` を**読めてしまう**（帳票では実機が通さない）

UI は `isDisplayFile()` で描画を止めていたので**画面には出ていなかった**が、
モデルには誤った値が入っていた。

## 影響範囲

- 新規 `docs/origin/generate-dds-print-appearance.mjs` / `verify-dds-print-appearance.mjs`
- 新規 `resources/completion/dds-print-appearance.json`
- 新規 `src/core/dds/prtfAppearance.ts`
- `src/core/dds/ddsRenderItem.ts` — 種別で分ける。
- `src/core/dds/prtfRenderModel.ts` — 様式のキーワードを渡す。
- `src/dds/webview/ui.ts` / `ui.css` — 描画と切替。

## 実現性 / リスク

- **画面の回帰**が一番の risk。`toRenderItem` は両方が通る。既定引数で
  画面側の呼び出しを変えない形にする。
- 様式のキーワードを項目に届ける経路が要る（`outline` から引ける）。

## 実装アンカー

- A1: `src/core/dds/ddsRenderItem.ts:153`（`appearance` を作っている場所）。
- A2: `src/core/dds/prtfRenderModel.ts:62`（`toRenderItem` の呼び出し）。
- A3: `src/dds/webview/ui.ts:672`（配色を描いている場所）。
- A4: `src/core/dds/prtfDensity.ts`（原典から生成した資源を core が読む形の手本）。

## 実装時の注意

- **カラー名を書き写さない**。原典から生成する（`prtfDensity` と同じ形）。
- **装置依存の形で色を決めない**（F3 の引用）。
- 様式に効くのは `HIGHLIGHT` だけ（`UNDERLINE` / `COLOR` は項目レベル）。

## spec への申し送り

- 検査は原典との一致だけでなく、**実機で確かめた 8 件**とも突き合わせる
  ——カラー名の表は画面にも同じ形であり、**原典の中だけでは帳票のものか分からない**。
