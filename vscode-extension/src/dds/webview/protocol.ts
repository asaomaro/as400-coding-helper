/**
 * ホストと WebView の間の契約。
 *
 * ## このファイルは `vscode` に依存しない（意図的）
 *
 * WebView UI は**素の web として書く**。ホストは今のところ VSCode だけだが、
 * ゴール範囲ではスタンドアロンのホストが同じ UI を載せる。
 * そのときに差し替わるのは `bridge`（`acquireVsCodeApi` の呼び出し箇所）だけで、
 * **この契約と UI 本体は 1 行も変えずに済む**——それがこの分離の目的。
 *
 * 型は `@as400/dds-core`（vscode 非依存）だけを参照する。
 */

import type {
  NewItem,
  PatchOp,
  RenderDiagnostic,
  RenderModel
} from "@as400/dds-core";

/**
 * ホストが何を肩代わりするか（design DD8）。
 *
 * `host` の意味は「何が使えるか」ではなく **「ホストが何を肩代わりするか」**。
 * `true` なら UI は自前の部品を降ろす。スタンドアロンでは軒並み `false` になり、
 * UI が自前でファイル操作・undo・コマンドパレットを持つ。
 */
export interface Host {
  readonly name: "standalone" | "vscode";
  /** ホストが開閉・保存を持つ。 */
  readonly providesFileIO: boolean;
  /** ホストが undo / redo を持つ。 */
  readonly providesUndo: boolean;
  /** ホストがコマンドパレットを持つ。 */
  readonly providesCommandPalette: boolean;
  /** ホストで対応するソースをテキストエディタとして開ける。 */
  readonly canOpenTextEditor: boolean;
  /** ホストが F4 プロンプターを持つ。 */
  readonly hasPrompter: boolean;
}

/** VSCode ホストの能力。undo・保存・パレットはすべて VSCode が持つ。 */
export const VSCODE_HOST: Host = {
  name: "vscode",
  providesFileIO: true,
  providesUndo: true,
  providesCommandPalette: true,
  canOpenTextEditor: true,
  hasPrompter: true
};

/** 初回の読み込み。ホストの能力もここで渡す。 */
export interface LoadMessage {
  readonly type: "load";
  readonly model: RenderModel;
  readonly host: Host;
}

/** パッチが適用された（テキスト側の編集で起きることもある）。 */
export interface AppliedMessage {
  readonly type: "applied";
  readonly model: RenderModel;
}

/**
 * パッチが拒否された。
 *
 * **現在のモデルを添えて返す。** UI 側で「元の位置」を覚えて戻すより、
 * ホストが持つ唯一の正から描き直すほうが、状態が 2 か所に分かれない。
 */
export interface RejectedMessage {
  readonly type: "rejected";
  readonly reason: string;
  readonly diagnostics: readonly RenderDiagnostic[];
  readonly model: RenderModel;
}

/** ホスト → WebView。 */
export type HostMessage = LoadMessage | AppliedMessage | RejectedMessage;

/** WebView の初期化完了。ホストはこれを待って `load` を送る。 */
export interface ReadyMessage {
  readonly type: "ready";
}

/** 編集操作。**GUI の操作は必ずこれを通る**（独自の編集経路を作らない）。 */
export interface PatchMessage {
  readonly type: "patch";
  readonly ops: readonly PatchOp[];
}

/** 対応するソース行をテキストエディタで開く（`canOpenTextEditor` のホストのみ）。 */
export interface OpenSourceMessage {
  readonly type: "openSource";
  /** 0 始まりのソース行番号。 */
  readonly sourceLine: number;
}

/** WebView → ホスト。 */
export type WebviewMessage = ReadyMessage | PatchMessage | OpenSourceMessage;

/**
 * WebView から来たメッセージを検証する。**不正なら `undefined`**。
 *
 * spec のエラー処理どおり「WebView からの不正メッセージは無視してログに残す」。
 * 例外を投げないのは、投げてもホスト側で握り潰すしかなく、
 * **1 通の不正メッセージでエディタが死ぬ**ほうが害が大きいため。
 */
export function parseWebviewMessage(value: unknown): WebviewMessage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  switch (value.type) {
    case "ready":
      return { type: "ready" };
    case "patch": {
      const ops = parsePatchOps(value.ops);
      return ops === undefined ? undefined : { type: "patch", ops };
    }
    case "openSource":
      return isInteger(value.sourceLine) && value.sourceLine >= 0
        ? { type: "openSource", sourceLine: value.sourceLine }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * パッチ操作の列を検証する。**1 つでも不正なら列ごと捨てる。**
 *
 * 部分適用しないという core の方針（spec「パッチ対象 `id` が存在しない場合は何も適用しない」）を、
 * 入口でも同じ形にしておく。「4 件のうち 3 件だけ通った」状態を作らない。
 */
export function parsePatchOps(value: unknown): readonly PatchOp[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const ops: PatchOp[] = [];
  for (const candidate of value) {
    const op = parsePatchOp(candidate);
    if (op === undefined) {
      return undefined;
    }
    ops.push(op);
  }
  return ops;
}

function parsePatchOp(value: unknown): PatchOp | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  switch (value.op) {
    case "moveItem":
      return isNonEmptyString(value.id) &&
        isInteger(value.line) &&
        isInteger(value.pos)
        ? { op: "moveItem", id: value.id, line: value.line, pos: value.pos }
        : undefined;
    case "resizeItem":
      return isNonEmptyString(value.id) && isInteger(value.length)
        ? { op: "resizeItem", id: value.id, length: value.length }
        : undefined;
    case "removeItem":
      return isNonEmptyString(value.id)
        ? { op: "removeItem", id: value.id }
        : undefined;
    case "addItem": {
      if (!isNonEmptyString(value.record) || !isRecord(value.item)) {
        return undefined;
      }
      const item = parseNewItem(value.item);
      return item === undefined
        ? undefined
        : { op: "addItem", record: value.record, item };
    }
    default:
      return undefined;
  }
}

function parseNewItem(value: Record<string, unknown>): NewItem | undefined {
  const kind = value.kind;
  if (kind !== "field" && kind !== "constant") {
    return undefined;
  }

  // **`line` / `pos` は必須**（`NewItem` の型どおり。画面に置かない追加は無い）。
  if (!isInteger(value.line) || !isInteger(value.pos)) {
    return undefined;
  }

  // 残りの欄は「あるなら型が正しいこと」だけを見る。
  // 欄の意味（長さが 30-34 桁に収まるか・数値シフトに小数桁があるか等）は core の validate が
  // 判断する——**ここで判断を持つと真実源が 2 つになる。**
  const strings = ["name", "text", "dataType", "usage"] as const;
  for (const key of strings) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      return undefined;
    }
  }
  const numbers = ["length", "decimals"] as const;
  for (const key of numbers) {
    if (value[key] !== undefined && !isInteger(value[key])) {
      return undefined;
    }
  }

  return {
    kind,
    name: value.name as string | undefined,
    text: value.text as string | undefined,
    length: value.length as number | undefined,
    dataType: value.dataType as string | undefined,
    decimals: value.decimals as number | undefined,
    usage: value.usage as string | undefined,
    line: value.line,
    pos: value.pos
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}
