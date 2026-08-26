/**
 * WebView へ渡す描画専用のモデル（`RenderModel`）を作る。
 *
 * ## 判断は全部こちら側にある（design DD3）
 *
 * `widthCols`（表示桁数・SO/SI 込み）は**この層が計算して載せる**。
 * WebView は `widthCols * セル幅` で描くだけで、文字幅を数えない——
 * **WebView が自分で数え始めた時点で換算が 2 か所になり、spec D3 が破れる**。
 *
 * ## 配置は ASCII レンダラと同じ計算を通る
 *
 * `render/layout` を共有しているので、05 で取れた実機ゴールデンの一致が
 * そのまま GUI の配置の担保になる（`render/layout` の冒頭コメント）。
 *
 * ## 今は使わない拡張点を最初から刻んである（design DD5）
 *
 * | 拡張点 | skeleton | 将来 |
 * |---|---|---|
 * | `kind` | 常に `"dspf"` | PRTF 対応で分岐 |
 * | `canvas.lineMode` | 常に `"absolute"` | PRTF は様式内相対行 |
 * | `records` | 常に 1 要素 | レイヤー方式で複数 |
 * | `activeRecordId` | その 1 件 | アクティブ様式の切替 |
 * | `RenderItem.editable` | 常に `true` | 非アクティブ様式は `false` |
 *
 * **`records` を最初から配列にしてある**ので、レイヤー方式の導入が
 * 「配列に 2 件目が入るだけ」になり、UI の構造変更が要らない。
 */

import type { DdsDoc } from "../dds/model.js";
import {
  validate,
  DEFAULT_SCREEN,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticSeverity,
  type ScreenSize
} from "../dds/validate.js";
import { placements, type Segment } from "./layout.js";

/** WebView へ渡す描画専用のモデル。 */
export interface RenderModel {
  /** 種別。skeleton は DSPF のみ。 */
  readonly kind: "dspf" | "prtf";
  readonly canvas: RenderCanvas;
  /** 表示する様式。skeleton は常に 1 要素（0 件＝描けるものが無い）。 */
  readonly records: readonly RenderRecord[];
  /** 編集対象の様式 ID。描けるものが無い場合は空文字。 */
  readonly activeRecordId: string;
  /** 文書全体の診断。**アクティブ様式のぶんだけに絞らない**（下記）。 */
  readonly diagnostics: readonly RenderDiagnostic[];
}

/** キャンバスの大きさと行の意味。 */
export interface RenderCanvas {
  readonly rows: number;
  readonly cols: number;
  /** 行番号の意味。DSPF は画面の絶対行。PRTF（将来）は様式内の相対行。 */
  readonly lineMode: "absolute" | "relative";
}

/** 1 レコード様式。 */
export interface RenderRecord {
  /** 様式 ID。skeleton では様式名と同じ（同一 DDS 内で一意）。 */
  readonly id: string;
  readonly name: string;
  readonly items: readonly RenderItem[];
}

/** 画面に置かれた 1 要素。 */
export interface RenderItem {
  /** `DdsItem.id` と同一。**`PatchOp` の宛先**になる。 */
  readonly id: string;
  readonly kind: "field" | "constant";
  /** 画面上の行（1 始まり）。 */
  readonly line: number;
  /** 画面上の桁（1 始まり・表示桁）。 */
  readonly pos: number;
  /** 表示桁数（DBCS・SO/SI 込み）。**core が計算する**（DD3）。 */
  readonly widthCols: number;
  /** 描画用テキスト。定数はリテラル、フィールドはプレースホルダの反復。 */
  readonly text: string;
  /**
   * 描画の区切り（`cols` の合計は `widthCols`）。
   *
   * **UI はこれを `cols × セル幅` の箱に流し込むだけでよい。**
   * 「この文字は何桁か」を UI に判断させないための形（design DD3）。
   */
  readonly segments: readonly Segment[];
  /** 編集できるか。skeleton では常に `true`。 */
  readonly editable: boolean;
  /** ソース行（0 始まり）。テキストエディタへジャンプするために使う。 */
  readonly sourceLine: number;
}

/** キャンバス上に出す診断。 */
export interface RenderDiagnostic {
  readonly severity: DiagnosticSeverity;
  /**
   * 診断コード。
   *
   * design の型には無かったが載せている——UI が種類で出し分けられないと、
   * 「隣接違反（警告・実機も通す）」と「桁溢れ（エラー）」が同じ見た目になる。
   * 判断は core が持ったまま、**表示の区別に必要な識別子だけ**を渡す形。
   */
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly itemId?: string;
  /** 0 始まりのソース行番号（エディタへのジャンプ用）。 */
  readonly sourceLine?: number;
}

/** `buildRenderModel` の指定。 */
export interface RenderModelOptions {
  /** 描く様式。省略すると最初の様式。 */
  readonly record?: string;
  /**
   * 画面の大きさ。既定は 24×80。
   *
   * **`DSPSIZ` からは求められない。** ファイルレベルのキーワードは `opaque` 行として
   * 素通ししており（03 の設計）、解釈していないため。既定値で描いていることを隠さない。
   */
  readonly screen?: ScreenSize;
}

/**
 * `DdsDoc` から `RenderModel` を作る。
 *
 * **置かれていないアイテム（行 / 桁が無い）・画面外・幅が判定できないアイテムは `items` に入らない。**
 * 黙って消えるわけではなく、`validate` の診断（`DDS7104` / `DDS7107` 等）として
 * `diagnostics` に残り、ソース行へジャンプできる。
 */
export function buildRenderModel(
  doc: DdsDoc,
  options: RenderModelOptions = {}
): RenderModel {
  const screen = options.screen ?? DEFAULT_SCREEN;
  const activeName = options.record ?? doc.records[0]?.name;

  const items: RenderItem[] = placements(doc, {
    record: activeName,
    screen
  }).map(placement => ({
    id: placement.item.id,
    kind: placement.item.kind,
    line: placement.line,
    pos: placement.pos,
    widthCols: placement.widthCols,
    text: placement.text,
    segments: placement.segments,
    editable: true,
    sourceLine: placement.item.lineIndex
  }));

  // 様式が 1 つも無い DDS（全行 opaque 等）は「描けるものが無い」状態として返す。
  // spec のエラー処理どおり、エディタ側が「編集可能な項目なし」を出せるようにする。
  const records: RenderRecord[] =
    activeName === undefined
      ? []
      : [{ id: activeName, name: activeName, items }];

  return {
    kind: "dspf",
    canvas: { rows: screen.rows, cols: screen.cols, lineMode: "absolute" },
    records,
    activeRecordId: activeName ?? "",
    // **アクティブ様式のぶんだけに絞らない。** 他様式の違反を隠すと、
    // 「GUI で開いている限り問題が見えない」状態を作ってしまう。
    // 呼び出し側は itemId でキャンバス上のマークと一覧を出し分けられる。
    diagnostics: validate(doc, screen).map(toRenderDiagnostic)
  };
}

function toRenderDiagnostic(diagnostic: Diagnostic): RenderDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    itemId: diagnostic.itemId,
    sourceLine: diagnostic.sourceLine
  };
}
