import { collectIndicators } from "./ddsConditioning";
import { toRenderItem, type RenderItem } from "./ddsRenderItem";
import {
  buildDspfOutline,
  type OutlineItem,
  type OutlineRecord
} from "./dspfOutline";
import {
  resolvePrtfLayout,
  type PrtfLayout,
  type PrtfLayoutOptions
} from "./prtfLayout";
import type { RenderModel } from "./dspfRenderModel";

/**
 * 帳票（PRTF）を**描くための形**。GUI に渡すのは DSPF と同じ `RenderModel`。
 *
 * **vscode を import しない。**
 *
 * ## 画面と何が違うか
 *
 * - **紙面の大きさは DDS に書かれていない**。`CRTPRTF` の `PAGESIZE` で決まるので、
 *   ホストが設定から渡す（帳票プレビューと同じ設定を使う）。
 * - **属性文字が無い**。表示装置は項目の前後 1 桁を属性文字が占めるが、印刷には出ない。
 *   占有は項目そのもの（`prtfLayout` が入れている）。
 * - **行が行送りで決まる**。実務の PRTF は位置欄に行番号を書かず、
 *   `SPACEA` / `SPACEB` / `SKIPA` / `SKIPB` で行が動く（`resolvePrtfLayout` が解く）。
 *   行番号を書き込むと**それらが無効になる**ので、行を変える移動は拒否する（`ddsEdit`）。
 * - **5250 の配色は持たない**。`COLOR` / `DSPATR` は表示装置ファイルのキーワードで、
 *   PRTF のキーワード一覧に `DSPATR` は無い。
 *
 * ## 判定はここに持たない
 *
 * 配置・幅・重なり・はみ出し・2 重印刷は `resolvePrtfLayout` が決める。
 * ここがやるのは**描くのに必要な形へ翻訳する**ことだけ。
 */

/** ソース行から帳票の描画モデルを作る。 */
export function buildPrtfRenderModel(
  lines: readonly string[],
  options?: PrtfLayoutOptions
): RenderModel {
  return fromPrtfLayout(
    resolvePrtfLayout(lines, options),
    buildDspfOutline(lines),
    collectIndicators(lines)
  );
}

/** 既に解決済みのレイアウトから作る（二重に解決しないため）。 */
export function fromPrtfLayout(
  layout: PrtfLayout,
  outline: readonly OutlineRecord[] = [],
  indicators: ReturnType<typeof collectIndicators> = []
): RenderModel {
  const items: RenderItem[] = layout.items.map(item =>
    toRenderItem({
      ...item,
      keywords: item.keywords,
      conditioning: item.conditioning,
      occupancy: item.occupancy,
      // 行番号を書いていない項目は、行が行送りで決まる。
      rowFromSpacing: !item.hasExplicitRow
    })
  );

  const records: string[] = [];
  for (const item of layout.items) {
    if (item.recordName && !records.includes(item.recordName)) {
      records.push(item.recordName);
    }
  }

  return {
    kind: "prtf",
    canvas: { rows: layout.page.rows, columns: layout.page.columns },
    overflowLine: layout.page.overflowLine,
    items,
    // **診断は作り直さない。** `prtfLayout` のものをそのまま渡す。
    diagnostics: layout.diagnostics.map(diagnostic => ({
      code: diagnostic.code,
      message: diagnostic.message,
      sourceLine: diagnostic.sourceLine
    })),
    records,
    // **一覧の「位置なし」を帳票の見方に直す。**
    outline: placedOutline(outline, layout),
    indicators
  };
}

/**
 * 一覧の位置と「描かれない理由」を、帳票の解決結果に合わせる。
 *
 * `buildDspfOutline` は**位置欄だけ**を見るので、行番号を書かない帳票の項目を
 * すべて `no-position`（位置なし）と判定してしまう。実際には行送りで位置が決まっており、
 * **キャンバスには描かれている**——そのままだと一覧とキャンバスが食い違う。
 *
 * 配置できた項目は、解決後の行・桁を入れて理由を落とす。
 */
function placedOutline(
  outline: readonly OutlineRecord[],
  layout: PrtfLayout
): OutlineRecord[] {
  const placed = new Map(layout.items.map(item => [item.sourceLine, item]));

  return outline.map(record => ({
    ...record,
    items: record.items.map((item): OutlineItem => {
      const found = placed.get(item.sourceLine);
      if (!found) return item;
      const { hidden: _hidden, ...rest } = item;
      return { ...rest, row: found.row, column: found.column };
    })
  }));
}
