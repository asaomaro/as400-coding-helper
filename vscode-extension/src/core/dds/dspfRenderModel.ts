import { isDbcsCodePoint, printWidth } from "../dbcs";
import { resolveDspfLayout, type DspfDiagnostic, type DspfLayout } from "./dspfLayout";
import { buildDspfOutline, type ItemAttributes, type OutlineRecord } from "./dspfOutline";

/**
 * 画面（DSPF）を**描くための形**。GUI に渡す唯一のモデル。
 *
 * **vscode を import しない。** VSCode の WebView でも、ブラウザ単体でも同じものを描けるようにする
 * ——この層が `vscode` に触った時点で、エディタは VSCode の外に出られなくなる。
 *
 * ## 判定はここに持たない
 *
 * 配置・幅・重なり・はみ出しは `resolveDspfLayout` が決める。ここがやるのは
 * **「描くのに必要な形へ翻訳する」**ことだけ——具体的には
 * 「文字と、それが何桁を占めるか」の対応（`segments`）を足す。
 *
 * ## なぜ `segments` が要るか
 *
 * DBCS は SO/SI が桁を消費するので、**リテラルをそのまま開始桁に置くと 1 桁ずれる**
 * （`'社員番号'` は SO+8+SI = 10 桁で、最初の文字は開始桁の**次**に出る）。
 * かといって UI 側で「これは全角か」を判定させると、桁の真実源が 2 つになる。
 * そこで**文字と占有桁数の対応を core が決めて渡し**、UI は `cols × セル幅` の箱に流すだけにする。
 */

/** 描画の 1 区切り。SO/SI は `text` が空の 1 桁として現れる。 */
export interface RenderSegment {
  readonly text: string;
  readonly cols: number;
  /**
   * SO / SI の桁。
   *
   * **表示切替で `{` `}` を描くために持つ。** UI に「これは全角か」を判断させないため、
   * 種別は区切りを作るときに決める（桁の判断は core、描くのは UI）。
   */
  readonly shift?: "so" | "si";
}

export interface RenderItem {
  /** 1 始まり。**編集の宛先**（合成 ID は持たない——構造が変わると別の項目を指すため）。 */
  readonly sourceLine: number;
  readonly kind: "field" | "constant";
  /** 1 始まり。 */
  readonly row: number;
  /** 1 始まり・表示桁。 */
  readonly column: number;
  /** 表示桁数（DBCS・SO/SI 込み）。幅不明なら undefined。 */
  readonly widthCols: number | undefined;
  /** 表示するラベル（定数はリテラル、フィールドは名前）。 */
  readonly label: string;
  /** 描画の区切り。`cols` の合計は `widthCols`。幅不明なら空。 */
  readonly segments: readonly RenderSegment[];
  /** 属性文字を含む実効占有（1 始まり・両端を含む）。 */
  readonly occupancy: { readonly start: number; readonly end: number };
  /** 長さ欄を持つか。**定数は持たない**ので、長さは変えられない。 */
  readonly resizable: boolean;
  readonly recordName?: string;
  /** プロパティに出す値。**キーワードは解釈しない**（生テキスト）。 */
  readonly attributes: ItemAttributes;
}

export interface RenderModel {
  /** 種別。DSPF のみ。PRTF を載せるときにここで分岐する。 */
  readonly kind: "dspf";
  readonly canvas: { readonly rows: number; readonly columns: number };
  /** 描く項目（配置できたものだけ）。 */
  readonly items: readonly RenderItem[];
  readonly diagnostics: readonly DspfDiagnostic[];
  /** 様式の一覧（追加先の選択に使う）。 */
  readonly records: readonly string[];
  /**
   * **全項目**の一覧（様式ごと・配置に依らない）。
   *
   * `items` は画面に置けたものだけなので、位置欄が空・画面に出ない用途の項目は入らない。
   * それらにも手が届くように、一覧は別に持つ（`dspfOutline`）。鍵は `sourceLine` で共通。
   */
  readonly outline: readonly OutlineRecord[];
}

/** ソース行から描画モデルを作る。 */
export function buildDspfRenderModel(lines: readonly string[]): RenderModel {
  return fromLayout(resolveDspfLayout(lines), buildDspfOutline(lines));
}

/** 既に解決済みのレイアウトから作る（二重に解決しないため）。 */
export function fromLayout(
  layout: DspfLayout,
  outline: readonly OutlineRecord[] = []
): RenderModel {
  const items = layout.items.map(toRenderItem);
  const records: string[] = [];
  for (const item of layout.items) {
    if (item.recordName && !records.includes(item.recordName)) {
      records.push(item.recordName);
    }
  }

  return {
    kind: "dspf",
    canvas: { rows: layout.screen.rows, columns: layout.screen.columns },
    items,
    diagnostics: layout.diagnostics,
    records,
    outline
  };
}

function toRenderItem(item: DspfLayout["items"][number]): RenderItem {
  const label = item.kind === "constant" ? (item.text ?? "") : (item.name ?? "");

  return {
    sourceLine: item.sourceLine,
    kind: item.kind,
    row: item.row,
    column: item.column,
    widthCols: item.width,
    label,
    segments:
      item.width === undefined
        ? []
        : item.kind === "constant"
          ? constantSegments(item.text ?? "")
          : [{ text: placeholder(item), cols: item.width }],
    occupancy: item.occupancy,
    // 定数は桁数欄を持たない（原典: 固定情報フィールドに桁数を指定してはならない）。
    resizable: item.kind === "field" && item.width !== undefined,
    attributes: {
      ...(item.name !== undefined ? { name: item.name } : {}),
      ...(item.text !== undefined ? { text: item.text } : {}),
      ...(item.width !== undefined && item.kind === "field" ? { length: item.width } : {}),
      ...(item.dataType !== undefined ? { dataType: item.dataType } : {}),
      ...(item.decimals !== undefined ? { decimals: item.decimals } : {}),
      ...(item.usage !== undefined ? { usage: item.usage } : {}),
      keywords: item.keywords
    },
    ...(item.recordName !== undefined ? { recordName: item.recordName } : {})
  };
}

/**
 * フィールドの見え方。SDA と同じ流儀で、長さと位置が分かる形にする。
 *
 * 実際に何が出るかは実行時のデータ次第なので、**名前ではなくプレースホルダ**を敷く
 * （名前を出すと、名前の長さと桁数が食い違って見える）。
 */
function placeholder(item: DspfLayout["items"][number]): string {
  const numeric = (item.name ?? "").length > 0 && isNumericLike(item);
  return (numeric ? "9" : "X").repeat(item.width ?? 0);
}

function isNumericLike(item: DspfLayout["items"][number]): boolean {
  return item.kind === "field" && /^[SY]$/u.test((item.dataType ?? "").trim().toUpperCase());
}

/**
 * 定数の区切り。**`printWidth` と同じ規則**で歩く（SO/SI が桁を消費する）。
 *
 * 同じ種別の連なりは 1 区切りにまとめる。全角の連なりは `cols` が文字数の 2 倍、
 * SO / SI は**空文字の 1 桁**として現れる。
 */
export function constantSegments(text: string): RenderSegment[] {
  const segments: RenderSegment[] = [];
  let run = "";
  let runCols = 0;
  let inDbcsRun = false;

  const flush = (): void => {
    if (runCols > 0) {
      segments.push({ text: run, cols: runCols });
      run = "";
      runCols = 0;
    }
  };
  const shift = (kind: "so" | "si"): void => {
    flush();
    segments.push({ text: "", cols: 1, shift: kind });
  };

  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    const dbcs = isDbcsCodePoint(codePoint);

    if (dbcs && !inDbcsRun) {
      shift("so");
      inDbcsRun = true;
    } else if (!dbcs && inDbcsRun) {
      shift("si");
      inDbcsRun = false;
    }

    run += character;
    runCols += dbcs ? 2 : 1;
  }

  if (inDbcsRun) {
    shift("si"); // 行末まで DBCS が続いた場合のシフトイン
  }
  flush();

  return segments;
}

/** 区切りの合計と `printWidth` が一致することの保証（テストが使う）。 */
export function segmentsWidth(segments: readonly RenderSegment[]): number {
  return segments.reduce((total, segment) => total + segment.cols, 0);
}

export { printWidth };
