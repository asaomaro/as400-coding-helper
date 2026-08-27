#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyDdsEdits, validateDdsEdits, type DdsEdit } from "../core/dds/ddsEdit";
import { buildDspfOutline } from "../core/dds/dspfOutline";
import { buildDspfRenderModel, type RenderModel } from "../core/dds/dspfRenderModel";
import { buildPrtfRenderModel } from "../core/dds/prtfRenderModel";
import { DEFAULT_PAGE } from "../core/dds/prtfLayout";
import { resolveDdsType, type DdsType } from "../core/sourceKind";

/**
 * DDS（画面 / 帳票）を**読む・描く・直す** CLI。
 *
 * VSCode を必要としない。判断はすべて `src/core/dds/` にあり、
 * **ここは「ファイルを読む → コアを呼ぶ → 形にする」だけ**。CLI に規則を持たない。
 *
 *   node out/cli/dds.js render --format text docs/src/CUSTMNT.dspf
 *
 * ## `validate` が無い理由
 *
 * 桁位置と配置の検査は **`lint` が既に同じ判定を出している**
 * （`src/lint/rules/layout.ts` が `resolveDspfLayout` / `resolvePrtfLayout` を
 * そのまま包んでいる）。同じ判定に 2 つ目の入口を作ると、どちらが正か分からなくなる
 * （AGENTS.md「同じ概念集合を複数箇所で列挙しない」）。
 * 編集が当てられるかの検査は `patch`（`--write` を付けなければ書かない）が兼ねる。
 *
 * 終了コード: 0=成功 / 1=編集が拒否された / 2=使用法・入出力エラー
 */

const USAGE = `使い方: node out/cli/dds.js <コマンド> [オプション] <ファイル>

コマンド:
  parse     様式と項目を JSON で出す
  render    描画モデルを出す（--format json|text）
  patch     編集を当てる（--edits <path|-> [--write]）

オプション:
  --format <json|text>   出力形式（既定 json。parse は json のみ）
  --output <path>        出力先（既定 標準出力）
  --edits <path|->       patch が読む編集の JSON（- は標準入力）
  --write                patch の結果を元のファイルに書く
  --allow-new-issues     patch: 配置の指摘が増えても止めない
  --page-rows <n>        帳票: 1 ページの行数（既定 ${DEFAULT_PAGE.rows}）
  --page-columns <n>     帳票: 1 行の桁数（既定 ${DEFAULT_PAGE.columns}）
  --overflow <n>         帳票: オーバーフロー行（既定 ${DEFAULT_PAGE.overflowLine}）
  --help

対象は画面（.dspf / .mnudds）と帳票（.prtf）。物理/論理ファイル（.pf / .lf）は
配置の概念が無いので対象外。

桁位置の検査は lint が受け持つ:  node out/cli/lint.js <ファイル>
`;

type Command = "parse" | "render" | "patch";

interface CliOptions {
  command: Command;
  format: "json" | "text";
  output?: string;
  edits?: string;
  write: boolean;
  allowNewIssues: boolean;
  page: { rows: number; columns: number; overflowLine: number };
  file: string;
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): CliOptions {
  const first = argv[0];
  if (first === undefined || first === "--help" || first === "-h") {
    throw new UsageError("");
  }
  if (first !== "parse" && first !== "render" && first !== "patch") {
    throw new UsageError(`知らないコマンドです: ${first}`);
  }

  const options: CliOptions = {
    command: first,
    format: "json",
    write: false,
    allowNewIssues: false,
    page: { ...DEFAULT_PAGE },
    file: ""
  };
  const files: string[] = [];

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new UsageError(`${arg} に値がありません`);
      i += 1;
      return value;
    };
    const number = (): number => {
      const value = Number(next());
      if (!Number.isInteger(value) || value <= 0) {
        throw new UsageError(`${arg} は正の整数です`);
      }
      return value;
    };

    switch (arg) {
      case "--help":
      case "-h":
        throw new UsageError("");
      case "--format": {
        const value = next();
        if (value !== "json" && value !== "text") {
          throw new UsageError(`--format は json か text です: ${value}`);
        }
        options.format = value;
        break;
      }
      case "--output":
        options.output = next();
        break;
      case "--edits":
        options.edits = next();
        break;
      case "--write":
        options.write = true;
        break;
      case "--allow-new-issues":
        options.allowNewIssues = true;
        break;
      case "--page-rows":
        options.page.rows = number();
        break;
      case "--page-columns":
        options.page.columns = number();
        break;
      case "--overflow":
        options.page.overflowLine = number();
        break;
      default:
        if (arg.startsWith("-")) throw new UsageError(`知らないオプションです: ${arg}`);
        files.push(arg);
    }
  }

  if (files.length === 0) throw new UsageError("ファイルを指定してください");
  if (files.length > 1) {
    throw new UsageError(`ファイルは 1 つだけです: ${files.join(" ")}`);
  }
  options.file = files[0];

  if (options.command === "parse" && options.format === "text") {
    throw new UsageError("parse は --format json だけです");
  }
  if (options.command === "patch" && options.edits === undefined) {
    throw new UsageError("patch には --edits が要ります");
  }
  if (options.command !== "patch" && (options.write || options.allowNewIssues)) {
    throw new UsageError("--write / --allow-new-issues は patch だけのオプションです");
  }
  return options;
}

/** 改行コードと末尾改行を保つための情報。 */
interface SourceText {
  readonly lines: string[];
  readonly newline: string;
  readonly trailingNewline: boolean;
}

function readSource(fsPath: string): SourceText {
  const text = readFileSync(fsPath, "utf8");
  // **元のファイルに合わせて書き戻す。** LF に揃えると差分が全行になる。
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = text.endsWith("\n");
  const lines = text.split(/\r?\n/u);
  if (trailingNewline) lines.pop();
  return { lines, newline, trailingNewline };
}

function joinSource(source: SourceText, lines: readonly string[]): string {
  return lines.join(source.newline) + (source.trailingNewline ? source.newline : "");
}

function modelOf(
  ddsType: DdsType,
  lines: readonly string[],
  page: CliOptions["page"]
): RenderModel {
  return ddsType === "DDS-PRTF"
    ? buildPrtfRenderModel(lines, { page })
    : buildDspfRenderModel(lines);
}

/**
 * 編集で**新しく出た**配置の指摘。
 *
 * 元から出ているものは数えない——直すのは別の話で、ここで止めると
 * 既に指摘のあるファイルが 1 か所も直せなくなる。
 *
 * 同じ指摘かどうかは `code` と本文で見る。行番号は編集で動くため鍵にしない。
 */
function newIssues(
  before: RenderModel,
  after: RenderModel
): RenderModel["diagnostics"] {
  const seen = new Set(before.diagnostics.map(issue => `${issue.code}\u0000${issue.message}`));
  return after.diagnostics.filter(
    issue => !seen.has(`${issue.code}\u0000${issue.message}`)
  );
}

/**
 * 画面の絵。**1 桁 = 1 文字**で並べる。
 *
 * 幅は `RenderSegment.cols` をそのまま使う——ここで `printWidth` を呼び直すと
 * 桁の真実源が 2 つになる。全角は 2 桁を占めるので、2 桁目は空白で埋める。
 *
 * 非表示（`DSPATR(ND)`）は `·` を置く。**桁は占めるが文字が出ない**ことを
 * 絵の上でも区別できるようにするため（空白と見分けが付かないと桁を数え直すことになる）。
 */
function drawModel(model: RenderModel): string {
  const { rows, columns } = model.canvas;
  // `undefined` は「前の全角文字が占めている桁」。**何も出さない**——
  // 端末は全角を 2 桁幅で描くので、埋め草を入れると 1 桁ずつ右へずれる。
  const canvas: (string | undefined)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => " ")
  );

  const put = (line: (string | undefined)[], column: number, char: string, cols: number): void => {
    if (column >= 1 && column <= columns) line[column - 1] = char;
    for (let i = 1; i < cols; i += 1) {
      if (column + i >= 1 && column + i <= columns) line[column + i - 1] = undefined;
    }
  };

  for (const item of model.items) {
    if (item.row < 1 || item.row > rows) continue;
    const line = canvas[item.row - 1];
    let column = item.column;

    if (item.appearance.nonDisplay) {
      // 桁は占めるが文字が出ない。空白と見分けが付かないと桁を数え直すことになる。
      for (let i = 0; i < (item.widthCols ?? 0); i += 1) put(line, column + i, "·", 1);
      continue;
    }

    for (const segment of item.segments) {
      if (segment.shift !== undefined) {
        column += segment.cols;
        continue;
      }
      const chars = [...segment.text];
      const perChar = chars.length > 0 ? segment.cols / chars.length : 1;
      for (const char of chars) {
        put(line, column, char, perChar);
        column += perChar;
      }
    }
  }

  const ruler = columnRuler(columns);
  const width = String(rows).length;
  const out = [`${" ".repeat(width)}  ${ruler}`];
  canvas.forEach((line, index) => {
    out.push(
      `${String(index + 1).padStart(width)} |${line.filter(cell => cell !== undefined).join("")}|`
    );
  });
  if (model.diagnostics.length > 0) {
    out.push("");
    out.push(`指摘 ${model.diagnostics.length} 件:`);
    for (const diagnostic of model.diagnostics) {
      out.push(`  ${diagnostic.sourceLine} 行: ${diagnostic.message} [${diagnostic.code}]`);
    }
  }
  return out.join("\n");
}

/** `....+....1....+....2` の目盛り。ルーラーと同じ読み方にそろえる。 */
function columnRuler(columns: number): string {
  let ruler = "";
  for (let column = 1; column <= columns; column += 1) {
    // 10 桁ごとに十の位の数字、5 桁ごとに `+`、それ以外は `.`。
    ruler +=
      column % 10 === 0 ? String((column / 10) % 10) : column % 5 === 0 ? "+" : ".";
  }
  return ruler;
}

function readEdits(source: string): DdsEdit[] {
  const text =
    source === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(source), "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new UsageError("--edits の中身は編集の配列です");
  }
  return parsed as DdsEdit[];
}

export function run(argv: readonly string[]): number {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      if (error.message) console.error(`✗ ${error.message}\n`);
      console.error(USAGE);
      return error.message ? 2 : 0;
    }
    throw error;
  }

  const fsPath = resolve(process.cwd(), options.file);
  const ddsType = resolveDdsType(fsPath);
  if (ddsType !== "DDS-DSPF" && ddsType !== "DDS-PRTF") {
    console.error(`✗ 画面（.dspf / .mnudds）か帳票（.prtf）を指定してください: ${options.file}`);
    return 2;
  }

  let source: SourceText;
  try {
    source = readSource(fsPath);
  } catch {
    console.error(`✗ 読めません: ${options.file}`);
    return 2;
  }

  let output: string;
  let status = 0;

  try {
    switch (options.command) {
      case "parse":
        output = `${JSON.stringify(
          { file: options.file, ddsType, records: buildDspfOutline(source.lines) },
          null,
          2
        )}\n`;
        break;
      case "render": {
        const model = modelOf(ddsType, source.lines, options.page);
        output =
          options.format === "text"
            ? `${drawModel(model)}\n`
            : `${JSON.stringify({ file: options.file, ddsType, model }, null, 2)}\n`;
        break;
      }
      case "patch": {
        const edits = readEdits(options.edits as string);
        const rejections = validateDdsEdits(source.lines, edits);
        if (rejections.length > 0) {
          // **1 つでも拒否があれば何も書かない。** 一部だけ当たった状態は説明できない。
          const text =
            options.format === "text"
              ? rejections
                  .map(
                    rejection =>
                      `${rejection.sourceLine ?? "-"} 行: ${rejection.message} [${rejection.code}]`
                  )
                  .join("\n")
              : JSON.stringify({ rejections }, null, 2);
          write(options, `${text}\n`);
          return 1;
        }

        const lines = [...source.lines];
        // **後ろから当てる。** 前から当てると後続の行番号がずれる。
        const results = [...applyDdsEdits(source.lines, edits)].sort(
          (a, b) => b.replaceFrom - a.replaceFrom
        );
        for (const result of results) {
          lines.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
        }

        // **「書ける」と「正しい」は別物。** `validateDdsEdits` が見るのは
        // 「ソースに書けるか」（桁に収まるか・宛先があるか）だけで、書いた結果が
        // 妥当な画面になるかは見ない。実際、定数を 1 桁目へ動かす編集は通ってしまう
        // ——原典は「最初の桁は属性文字のために予約されています」と禁じており、
        // `resolveDspfLayout` は `column-one-reserved` として指摘する。
        //
        // 規則を CLI に写さず、**解決の指摘が増えたかどうか**で見る。
        // 元から出ている指摘は増分に数えない（直すのは別の話）。
        const introduced = newIssues(
          modelOf(ddsType, source.lines, options.page),
          modelOf(ddsType, lines, options.page)
        );
        if (introduced.length > 0 && !options.allowNewIssues) {
          const text =
            options.format === "text"
              ? [
                  `配置の指摘が ${introduced.length} 件増えるので書きません` +
                    "（承知のうえなら --allow-new-issues）:",
                  ...introduced.map(
                    issue => `  ${issue.sourceLine} 行: ${issue.message} [${issue.code}]`
                  )
                ].join("\n")
              : JSON.stringify({ newIssues: introduced }, null, 2);
          write(options, `${text}\n`);
          return 1;
        }

        output = joinSource(source, lines);
        if (options.write) {
          writeFileSync(fsPath, output, "utf8");
          console.error(`✓ ${options.file} を書き換えました（編集 ${edits.length} 件）`);
          return 0;
        }
        break;
      }
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`✗ ${error.message}`);
      return 2;
    }
    console.error(`✗ ${String(error)}`);
    return 2;
  }

  return write(options, output) ? status : 2;
}

function write(options: CliOptions, text: string): boolean {
  if (options.output === undefined) {
    process.stdout.write(text);
    return true;
  }
  try {
    writeFileSync(resolve(process.cwd(), options.output), text, "utf8");
    return true;
  } catch (error) {
    console.error(`✗ 書き込めません: ${options.output}（${String(error)}）`);
    return false;
  }
}

// require された場合（テスト）は実行しない。
if (require.main === module) {
  process.exit(run(process.argv.slice(2)));
}
