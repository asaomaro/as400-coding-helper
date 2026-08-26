/**
 * 固定長 DDS テキスト → モデル。
 *
 * ## 原則: 解釈できない行は素通しする
 *
 * コメント・継続行・ファイルレベルのキーワード・未知の書式は `opaque` として
 * **`raw` だけを保持**する。**扱えない要素があることは許容するが、扱えない要素を
 * 壊すことは許容しない**（requirement AC3）。
 *
 * 解釈できた行も `raw` を捨てない。書き戻しは `raw` の連結なので、
 * パーサの解釈が不完全でもファイルは壊れない。
 */

import type {
  DdsDoc,
  DdsItem,
  DdsLine,
  DdsRecord,
  Eol
} from "./model.js";
import {
  DDS_COLUMNS,
  DEFAULT_LINE_WIDTH,
  fieldAt,
  literalFromFunctions,
  numberAt,
  sliceColumns
} from "./lineLayout.js";
import { decodeSource, type SourceEncoding } from "../text/decode.js";
import { displayWidth } from "../text/encoding.js";

/** `parse` に渡す任意の指定。 */
export interface ParseOptions {
  /** ソース行の桁数。既定 80。 */
  readonly lineWidth?: number;
  /** 既にデコード済みの場合のエンコーディング表明。既定 `"utf8"`。 */
  readonly encoding?: SourceEncoding;
  /** BOM があったか。既定 false。 */
  readonly bom?: boolean;
}

/** バイト列から読み込む。エンコーディングは自動判定する。 */
export function parseBytes(
  bytes: Uint8Array,
  options: ParseOptions = {}
): { readonly doc: DdsDoc; readonly warning?: string } {
  const decoded = decodeSource(bytes);
  const doc = parse(decoded.text, {
    ...options,
    encoding: decoded.encoding,
    bom: decoded.bom
  });
  return decoded.warning === undefined
    ? { doc }
    : { doc, warning: decoded.warning };
}

/** デコード済みテキストから読み込む。 */
export function parse(text: string, options: ParseOptions = {}): DdsDoc {
  const lineWidth = options.lineWidth ?? DEFAULT_LINE_WIDTH;
  const eol: Eol = text.includes("\r\n") ? "\r\n" : "\n";

  // 末尾の改行の有無を保持する。ここを落とすと末尾 1 バイトだけ差分が出る。
  const finalNewline = text.endsWith(eol);
  const body = finalNewline ? text.slice(0, -eol.length) : text;
  const rawLines = body === "" && !finalNewline ? [] : body.split(eol);

  const lines: DdsLine[] = [];
  const records: DdsRecord[] = [];

  let currentRecord = "";
  // ID の一意性はレコード名で採番する（同名様式が続いても番号が衝突しない）。
  const ordinals = new Map<string, number>();
  // 所属アイテムは**レコードの出現ごと**に持つ。名前でキーにすると、同名の様式が
  // 2 回現れたときに両方が同じ配列を共有し、双方が全アイテムを主張してしまう。
  let currentItemIds: string[] = [];

  rawLines.forEach((raw, lineIndex) => {
    const classified = classify(raw);

    if (classified === "opaque") {
      lines.push({ kind: "opaque", raw });
      return;
    }

    if (classified === "record") {
      const name = fieldAt(raw, DDS_COLUMNS.name);
      currentRecord = name;
      currentItemIds = [];
      records.push({ name, lineIndex, itemIds: currentItemIds });
      lines.push({ kind: "record", raw, name });
      return;
    }

    const item = buildItem(raw, lineIndex, currentRecord, ordinals);
    currentItemIds.push(item.id);
    lines.push({ kind: "item", raw, item });
  });

  return {
    eol,
    bom: options.bom ?? false,
    finalNewline,
    encoding: options.encoding ?? "utf8",
    lineWidth,
    lines,
    records
  };
}

type LineKind = "opaque" | "record" | "item";

function classify(raw: string): LineKind {
  // 6 桁目が 'A' でない行（空行・短い行・別書式）は解釈しない。
  if (displayWidth(raw) < DDS_COLUMNS.formType.start) {
    return "opaque";
  }
  if (fieldAt(raw, DDS_COLUMNS.formType) !== "A") {
    return "opaque";
  }

  // 7 桁目が '*' はコメント行。
  if (sliceColumns(raw, { start: 7, end: 7 }) === "*") {
    return "opaque";
  }

  if (fieldAt(raw, DDS_COLUMNS.type) === "R") {
    return "record";
  }

  const name = fieldAt(raw, DDS_COLUMNS.name);
  if (name !== "") {
    // 名前欄に何か入っていても、**DDS の名前として妥当でなければ解釈しない**。
    // 6 桁目が 'A' なだけの壊れた行を「変な名前のフィールド」として取り込むと、
    // 後段の編集がその行を書き換えて壊しうる。素通しするほうが安全。
    return isValidDdsName(name) ? "item" : "opaque";
  }

  // 名前が無くても行桁があれば定数。
  const hasPosition =
    fieldAt(raw, DDS_COLUMNS.line) !== "" || fieldAt(raw, DDS_COLUMNS.pos) !== "";
  if (hasPosition) {
    return "item";
  }

  // 名前も位置も無い ＝ ファイルレベルのキーワード行か継続行。解釈しない。
  return "opaque";
}

function buildItem(
  raw: string,
  lineIndex: number,
  record: string,
  ordinals: Map<string, number>
): DdsItem {
  const name = fieldAt(raw, DDS_COLUMNS.name);
  const functions = sliceColumns(raw, DDS_COLUMNS.functions);
  const conditions = fieldAt(raw, DDS_COLUMNS.conditions);

  const next = (ordinals.get(record) ?? 0) + 1;
  ordinals.set(record, next);

  const base = {
    id: `${record}#${next}`,
    record,
    lineIndex,
    length: numberAt(raw, DDS_COLUMNS.length),
    dataType: orUndefined(fieldAt(raw, DDS_COLUMNS.dataType)),
    decimals: orUndefined(fieldAt(raw, DDS_COLUMNS.decimals)),
    usage: orUndefined(fieldAt(raw, DDS_COLUMNS.usage)),
    line: numberAt(raw, DDS_COLUMNS.line),
    pos: numberAt(raw, DDS_COLUMNS.pos),
    conditions: orUndefined(conditions),
    keywords: functions.trimEnd()
  } as const;

  if (name !== "") {
    return { ...base, kind: "field", name };
  }

  return { ...base, kind: "constant", text: literalFromFunctions(functions) };
}

function orUndefined(text: string): string | undefined {
  return text === "" ? undefined : text;
}

/**
 * DDS の名前として妥当かを判定する。
 *
 * 先頭は英字または `#$@`、以降は英数字と `#$@_`、最大 10 文字。
 * **判定を緩めると壊れた行を取り込んでしまう**ので、疑わしいものは弾く
 * （弾かれた行は `opaque` として素通しされ、失われない）。
 */
function isValidDdsName(name: string): boolean {
  return /^[A-Z#$@][A-Z0-9#$@_]{0,9}$/i.test(name);
}
