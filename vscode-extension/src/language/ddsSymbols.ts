import * as vscode from "vscode";
import { DDS_EXTENSIONS, toDocumentSelector } from "../utils/fileScope";
import {
  DDS_COLUMNS,
  ddsField,
  ddsName,
  isDdsCommentLine,
  levelOfLine
} from "./ddsLayout";
import {
  expandToChildren,
  toDocumentSymbols,
  type LineReader,
  type OutlineKind,
  type OutlineNode,
  type OutlineRange
} from "./outlineTypes";

/**
 * DDS のアウトライン（レコード様式 → フィールド / キー / 選択・省略）。
 *
 * 桁と 17 桁目の意味は ddsLayout に集約している（キーワード補完と共有＝ドリフト防止）。
 *
 * 種別（PF / LF / DSPF / PRTF）で桁の意味は変わるが、**アウトラインが見る欄は共通**
 * （名前・長さ・タイプ・使用目的・位置）。位置欄は PF / LF では空なので分岐は要らない。
 * そのため種別が判別できない `.dds` でもアウトラインは出せる（キーワード補完と違う点）。
 */

/** DDS の使用レベル → アウトラインの種別。file レベルはシンボルにならない。 */
const LEVEL_KIND: Readonly<Record<string, OutlineKind>> = {
  record: "record",
  field: "field",
  key: "key",
  select: "select",
  join: "join",
  help: "help"
};

/**
 * detail を組み立てる。参照 / 長さ・タイプ・小数 / 使用目的 / 位置 のうち
 * 値のあるものだけを空白区切りで連結する。
 *
 * 例: `5S 0`（PF の数値）/ `30A`（PF の文字）/ `R B 5 20`（DSPF の参照フィールド）
 */
function buildDetail(text: string): string {
  const parts: string[] = [];

  if (ddsField(text, DDS_COLUMNS.reference).trim() === "R") {
    parts.push("R");
  }

  const length = ddsField(text, DDS_COLUMNS.length).trim();
  const dataType = ddsField(text, DDS_COLUMNS.dataType).trim();
  const decimals = ddsField(text, DDS_COLUMNS.decimals).trim();
  if (length || dataType) {
    const head = `${length}${dataType}`;
    parts.push(decimals ? `${head} ${decimals}` : head);
  }

  const usage = ddsField(text, DDS_COLUMNS.usage).trim();
  if (usage) {
    parts.push(usage);
  }

  // 位置は表示装置・印刷装置でのみ意味を持つ。「5 20」のように行と桁が並ぶので
  // 内部の空白は 1 つに詰める。
  const position = ddsField(text, DDS_COLUMNS.position).trim().replace(/\s+/gu, " ");
  if (position) {
    parts.push(position);
  }

  return parts.join(" ");
}

function lineRange(lineIndex: number, text: string): OutlineRange {
  return {
    startLine: lineIndex,
    startChar: 0,
    endLine: lineIndex,
    endChar: text.length
  };
}

/**
 * 名前そのものの範囲。名前が空なら 17 桁目の 1 文字、それも無ければ行全体。
 * どの場合も行の範囲に収まるので `selectionRange ⊆ range` が保たれる。
 */
function nameRange(lineIndex: number, text: string): OutlineRange {
  const raw = ddsField(text, DDS_COLUMNS.name);
  const trimmed = raw.trim();
  if (trimmed.length > 0) {
    const offset = DDS_COLUMNS.name[0] - 1 + raw.indexOf(trimmed);
    return {
      startLine: lineIndex,
      startChar: offset,
      endLine: lineIndex,
      endChar: offset + trimmed.length
    };
  }

  if (ddsField(text, DDS_COLUMNS.nameType).trim().length > 0) {
    const offset = DDS_COLUMNS.nameType[0] - 1;
    return {
      startLine: lineIndex,
      startChar: offset,
      endLine: lineIndex,
      endChar: offset + 1
    };
  }

  return lineRange(lineIndex, text);
}

/** 組み立て中のノード。range の終端は後続行を取り込むために書き換える。 */
interface Building {
  readonly name: string;
  readonly detail: string;
  readonly kind: OutlineKind;
  readonly startLine: number;
  readonly selectionRange: OutlineRange;
  endLine: number;
  endChar: number;
  readonly children: Building[];
}

function begin(
  lineIndex: number,
  text: string,
  kind: OutlineKind,
  name: string
): Building {
  return {
    name,
    detail: buildDetail(text),
    kind,
    startLine: lineIndex,
    selectionRange: nameRange(lineIndex, text),
    endLine: lineIndex,
    endChar: text.length,
    children: []
  };
}

function finish(node: Building): OutlineNode {
  return {
    name: node.name,
    detail: node.detail,
    kind: node.kind,
    range: {
      startLine: node.startLine,
      startChar: 0,
      endLine: node.endLine,
      endChar: node.endChar
    },
    selectionRange: node.selectionRange,
    children: node.children.map(finish)
  };
}

/**
 * DDS のアウトラインを組み立てる。
 *
 * - 注記行（7 桁目が `*`）は飛ばす
 * - 17 桁目が `R` ならレコード様式（新しい親）
 * - 17 桁目が `K`/`S`/`O`/`J`/`H` なら直近のレコード様式の子
 * - 17 桁目が空で名前欄（19-28 桁）に値があればフィールド（直近のレコード様式の子）
 * - 17 桁目も名前欄も空なら、シンボルを作らず直前のシンボルの範囲を延ばす
 *   （キーワード継続行・表示装置の定数行）
 *
 * レコード様式がまだ無い位置のフィールドはトップレベルに置く（不完全なソースへの耐性）。
 * **どんな入力でも例外を投げない**。provider が throw するとアウトラインが固まるため。
 */
export function buildDdsOutline(
  lineAt: LineReader,
  lineCount: number
): OutlineNode[] {
  const roots: Building[] = [];
  let record: Building | undefined;
  let child: Building | undefined;

  const attach = (node: Building): void => {
    if (record) {
      record.children.push(node);
      record.endLine = node.endLine;
      record.endChar = node.endChar;
    } else {
      roots.push(node);
    }
  };

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const text = lineAt(lineIndex);

    if (isDdsCommentLine(text)) {
      continue;
    }

    const level = levelOfLine(text);
    const name = ddsName(text);

    if (level === "record") {
      record = begin(lineIndex, text, "record", name || "R");
      child = undefined;
      roots.push(record);
      continue;
    }

    if (level) {
      // K / S / O / J / H。名前が空でもシンボルは作る（不完全なソースでも落ちないため）。
      const kind = LEVEL_KIND[level] ?? "field";
      child = begin(
        lineIndex,
        text,
        kind,
        name || ddsField(text, DDS_COLUMNS.nameType).trim()
      );
      attach(child);
      continue;
    }

    if (name.length > 0) {
      child = begin(lineIndex, text, "field", name);
      attach(child);
      continue;
    }

    // 空行は誰にも属さない。取り込むと末尾の空行までシンボルが伸びる。
    if (text.trim().length === 0) {
      continue;
    }

    // 名前も種別も無い行＝キーワード継続行、または表示装置の定数行。
    // シンボルは作らず、今開いているものの範囲を延ばす。
    const target = child ?? record;
    if (target) {
      target.endLine = lineIndex;
      target.endChar = text.length;
      if (child && record) {
        record.endLine = lineIndex;
        record.endChar = text.length;
      }
    }
  }

  // 親の range が子を覆うことを保証する（VSCode の containment 要件）。
  return roots.map(finish).map(expandToChildren);
}

/**
 * DDS 用の DocumentSymbolProvider を登録する。
 *
 * DDS は言語登録していない（表示系と同じく拡張子で扱う方針）ため、languageId ではなく
 * scheme+pattern で対象を絞る。拡張子は fileScope.ts の DDS_EXTENSIONS が単一の真実源。
 */
export function registerDdsSymbols(): vscode.Disposable {
  const provider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(document) {
      const nodes = buildDdsOutline(
        index => document.lineAt(index).text,
        document.lineCount
      );
      return toDocumentSymbols(nodes);
    }
  };

  return vscode.languages.registerDocumentSymbolProvider(
    toDocumentSelector(DDS_EXTENSIONS),
    provider
  );
}
