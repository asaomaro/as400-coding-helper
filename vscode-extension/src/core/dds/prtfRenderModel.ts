import { collectIndicators } from "./ddsConditioning";
import { resolvePrintDensity, type PrintDensity } from "./prtfDensity";
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
import { toFileKeywords, type RenderModel } from "./dspfRenderModel";

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
  options?: PrtfLayoutOptions & { readonly showPage?: number }
): RenderModel {
  return {
    ...fromPrtfLayout(
      resolvePrtfLayout(lines, options),
      buildDspfOutline(lines),
      collectIndicators(lines),
      resolvePrintDensity(lines),
      options?.showPage
    ),
    fileKeywords: toFileKeywords(lines)
  };
}

/** 既に解決済みのレイアウトから作る（二重に解決しないため）。 */
export function fromPrtfLayout(
  layout: PrtfLayout,
  outline: readonly OutlineRecord[] = [],
  indicators: ReturnType<typeof collectIndicators> = [],
  density?: PrintDensity,
  /** 描くページ（1 始まり）。省略時は 1 ページ目。 */
  showPage = 1
): RenderModel {
  // **様式のキーワード欄を引けるようにする。** `HIGHLIGHT` は様式に書くと
  // その中の全項目に効く（原典）ので、項目だけを見ると太字を取りこぼす。
  const recordKeywords = new Map<string, string>();
  for (const record of outline) {
    if (record.name.length > 0) recordKeywords.set(record.name, record.keywords);
  }

  // **モデルは全ページ分を持つ。** 絞るのは描くとき（`selectPrintPage`）——
  // ページを替えるたびにホストへ作り直しを頼むと、往復のあいだ絵が消える。
  const page = Math.min(Math.max(1, Math.trunc(showPage)), layout.pages);
  const onPage = layout.items;

  const items: RenderItem[] = onPage.map(item =>
    toRenderItem(
      {
        ...item,
        keywords: item.keywords,
        conditioning: item.conditioning,
        occupancy: item.occupancy,
        // 行番号を書いていない項目は、行が行送りで決まる。
        rowFromSpacing: !item.hasExplicitRow
      },
      {
        print: true,
        recordKeywords: recordKeywords.get(item.recordName ?? "") ?? ""
      }
    )
  );

  const records: string[] = [];
  for (const item of onPage) {
    if (item.recordName && !records.includes(item.recordName)) {
      records.push(item.recordName);
    }
  }

  return {
    kind: "prtf",
    canvas: { rows: layout.page.rows, columns: layout.page.columns },
    overflowLine: layout.page.overflowLine,
    pages: layout.pages,
    currentPage: page,
    ...(density !== undefined ? { density } : {}),
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
    indicators,
    // 生の行を持たないので空。`buildPrtfRenderModel` が足す。
    fileKeywords: []
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

/**
 * **1 ページ分に絞ったモデル。** 帳票でなければそのまま返す。
 *
 * 絞るのを描く側に置くのは、**ページを替えるたびにホストへ作り直しを頼まない**ため
 * ——往復のあいだ絵が消える。`screenModel`（2 次画面サイズ）と同じ形。
 *
 * 範囲の外を指したら端に丸める。空の絵を出すより、端のページを見せる方がよい。
 */
export function selectPrintPage(model: RenderModel, page: number): RenderModel {
  const total = model.pages ?? 1;
  if (model.kind !== "prtf" || total <= 1) return model;

  const wanted = Math.min(Math.max(1, Math.trunc(page)), total);
  return {
    ...model,
    currentPage: wanted,
    items: model.items.filter(item => (item.page ?? 1) === wanted)
  };
}
