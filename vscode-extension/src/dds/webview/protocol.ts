import type { DdsEdit, DdsEditRejection } from "../../core/dds/ddsEdit";
import type { RenderModel } from "../../core/dds/dspfRenderModel";

/**
 * エディタ UI とホストの契約。**`vscode` を import しない。**
 *
 * UI は素の web として書き、ホストとはこのメッセージだけで会話する。
 * VSCode 版は `postMessage` を挟み、単独起動版は直接呼ぶ——**UI から見た形は同じ**。
 * ここを崩すと、エディタは VSCode の外に出られなくなる。
 */

/**
 * ホストが何を肩代わりするか。
 *
 * 意味は「何ができるか」ではなく **「ホストが何を肩代わりするか」**。
 * `true` なら UI は自前の部品を降ろす。単独起動では軒並み `false` になり、
 * ファイル操作や undo を UI の外側（ホストの殻）が持つ。
 */
export interface EditorHost {
  readonly name: "standalone" | "vscode";
  readonly providesFileIO: boolean;
  readonly providesUndo: boolean;
  readonly canOpenSource: boolean;
}

export const VSCODE_HOST: EditorHost = {
  name: "vscode",
  providesFileIO: true,
  providesUndo: true,
  canOpenSource: true
};

export const STANDALONE_HOST: EditorHost = {
  name: "standalone",
  providesFileIO: false,
  providesUndo: false,
  canOpenSource: false
};

/** ホスト → UI。 */
export type HostMessage =
  | { readonly type: "load"; readonly model: RenderModel; readonly host: EditorHost }
  | { readonly type: "applied"; readonly model: RenderModel }
  | {
      readonly type: "rejected";
      readonly model: RenderModel;
      readonly rejections: readonly DdsEditRejection[];
    }
  /** 追加の内容の回答。取り消しなら `item` は null。 */
  | { readonly type: "askItemResult"; readonly item: Record<string, unknown> | null };

/** UI → ホスト。 */
export type EditorMessage =
  | { readonly type: "ready" }
  | { readonly type: "edit"; readonly edits: readonly DdsEdit[] }
  | { readonly type: "openSource"; readonly sourceLine: number }
  /**
   * 追加する項目の内容を聞く。
   *
   * **入力の手段はホストが持つ**（VSCode なら `showInputBox`、単独起動なら自前のダイアログ）。
   * UI にフォームを持たせないのは、入力の作法がホストごとに違うため。
   */
  | {
      readonly type: "askItem";
      readonly kind: "field" | "constant";
      readonly row: number;
      readonly column: number;
    };

/**
 * UI から来たメッセージを検証する。**不正なら `undefined`**。
 *
 * 例外を投げないのは、投げてもホスト側で握り潰すしかなく、
 * **1 通の不正メッセージでエディタが死ぬ**ほうが害が大きいため。
 */
export function parseEditorMessage(value: unknown): EditorMessage | undefined {
  if (!isRecord(value)) return undefined;

  switch (value.type) {
    case "ready":
      return { type: "ready" };
    case "openSource":
      return isPositiveInteger(value.sourceLine)
        ? { type: "openSource", sourceLine: value.sourceLine }
        : undefined;
    case "edit": {
      const edits = parseEdits(value.edits);
      return edits === undefined ? undefined : { type: "edit", edits };
    }
    case "askItem":
      return (value.kind === "field" || value.kind === "constant") &&
        isPositiveInteger(value.row) &&
        isPositiveInteger(value.column)
        ? { type: "askItem", kind: value.kind, row: value.row, column: value.column }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * 編集操作の列を検証する。**1 つでも不正なら列ごと捨てる。**
 *
 * 「4 件のうち 3 件だけ通った」状態を作らない——core が部分適用しないのと同じ形を入口でも守る。
 */
export function parseEdits(value: unknown): readonly DdsEdit[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const edits: DdsEdit[] = [];
  for (const candidate of value) {
    const edit = parseEdit(candidate);
    if (edit === undefined) return undefined;
    edits.push(edit);
  }
  return edits;
}

function parseEdit(value: unknown): DdsEdit | undefined {
  if (!isRecord(value)) return undefined;

  switch (value.kind) {
    case "move":
      return isPositiveInteger(value.sourceLine) &&
        isPositiveInteger(value.row) &&
        isPositiveInteger(value.column)
        ? { kind: "move", sourceLine: value.sourceLine, row: value.row, column: value.column }
        : undefined;
    case "resize":
      return isPositiveInteger(value.sourceLine) && isPositiveInteger(value.length)
        ? { kind: "resize", sourceLine: value.sourceLine, length: value.length }
        : undefined;
    case "remove":
      return isPositiveInteger(value.sourceLine)
        ? { kind: "remove", sourceLine: value.sourceLine }
        : undefined;
    case "add": {
      if (typeof value.recordName !== "string" || value.recordName.length === 0) {
        return undefined;
      }
      if (!isRecord(value.item)) return undefined;
      const item = value.item;
      if (item.kind !== "field" && item.kind !== "constant") return undefined;
      if (!isPositiveInteger(item.row) || !isPositiveInteger(item.column)) return undefined;

      // 欄の**意味**（長さが桁数欄に収まるか等）は core の検証が見る。
      // ここで判断を持つと、同じ規則が 2 か所になる。
      for (const key of ["name", "text", "dataType", "usage"]) {
        if (item[key] !== undefined && typeof item[key] !== "string") return undefined;
      }
      for (const key of ["length", "decimals"]) {
        if (item[key] !== undefined && !Number.isInteger(item[key])) return undefined;
      }

      return {
        kind: "add",
        recordName: value.recordName,
        item: {
          kind: item.kind,
          name: item.name as string | undefined,
          text: item.text as string | undefined,
          length: item.length as number | undefined,
          dataType: item.dataType as string | undefined,
          decimals: item.decimals as number | undefined,
          usage: item.usage as string | undefined,
          row: item.row,
          column: item.column
        }
      };
    }
    default:
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
