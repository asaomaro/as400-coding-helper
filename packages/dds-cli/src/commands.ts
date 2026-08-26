/**
 * 各コマンドの実装。
 *
 * **すべて `dds-core` を呼ぶだけ。** CLI 独自の解釈や編集経路は持たない。
 * GUI も同じコアを通るので、「CLI が GUI と同等」（requirement AC4）が
 * 努力目標ではなく構造で保たれる。
 */

import { readFileSync } from "node:fs";
import {
  parse,
  serialize,
  renderAscii,
  validate,
  applyOps,
  PatchRejectedError,
  DEFAULT_SCREEN,
  type DdsDoc,
  type ItemLine,
  type PatchOp,
  type ScreenSize
} from "@as400/dds-core";
import { loadSource, saveSource, EncodingError } from "./io.js";

/** 終了コード。エージェントはこれで成否を判断する。 */
export const EXIT = {
  ok: 0,
  usage: 1,
  parseFailed: 2,
  validationFailed: 3
} as const;

/** コマンドが受け取る解析済みの引数。 */
export interface Args {
  readonly positional: readonly string[];
  readonly flags: ReadonlyMap<string, string | true>;
}

function out(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
}

function err(text: string): void {
  process.stderr.write(text.endsWith("\n") ? text : text + "\n");
}

/** `load` が失敗したときの終了コード。ファイルが読めなければ 1、解釈できなければ 2。 */
let lastLoadFailure: number = EXIT.usage;

function requireFile(args: Args, command: string): string | undefined {
  const file = args.positional[0];
  if (file === undefined) {
    err(`dds ${command}: ファイルを指定してください`);
    return undefined;
  }
  return file;
}

function screenFrom(args: Args): ScreenSize {
  const rows = args.flags.get("rows");
  const cols = args.flags.get("cols");
  return {
    rows: typeof rows === "string" ? Number(rows) : DEFAULT_SCREEN.rows,
    cols: typeof cols === "string" ? Number(cols) : DEFAULT_SCREEN.cols
  };
}

/**
 * 何も解釈できなかったか（レコード様式もアイテムも 0 件で、内容が空でない）。
 *
 * パーサは解釈できない行を `opaque` にするので**決して失敗しない**。
 * そのままだと **DDS ですらないファイルが黙って成功する**——
 * エージェントは終了コードで成否を判断するので、その前提が崩れる。
 *
 * 実機も同じ状況を `CPD5238 No valid record found in source` としてエラーにしている。
 */
function nothingRecognized(doc: DdsDoc): boolean {
  const hasItem = doc.lines.some(line => line.kind === "item");
  const hasContent = doc.lines.some(line => line.raw.trim() !== "");
  return doc.records.length === 0 && !hasItem && hasContent;
}

/** 読み込みと警告の表示をまとめる。 */
function load(
  file: string
): { doc: DdsDoc; encoding: "utf8" | "shift_jis"; bom: boolean } | undefined {
  let loaded;
  try {
    loaded = loadSource(file);
  } catch (error) {
    lastLoadFailure = EXIT.usage;
    err(`dds: ファイルを読めません: ${file}`);
    return undefined;
  }
  if (loaded.warning !== undefined) {
    err(`警告: ${loaded.warning}`);
  }
  const doc = parse(loaded.text, {
    encoding: loaded.encoding,
    bom: loaded.bom
  });

  if (nothingRecognized(doc)) {
    lastLoadFailure = EXIT.parseFailed;
    err(
      `dds: DDS として解釈できる内容がありません（レコード様式が 1 つも見つかりません）: ${file}`
    );
    return undefined;
  }

  return { doc, encoding: loaded.encoding, bom: loaded.bom };
}

function items(doc: DdsDoc): ItemLine["item"][] {
  return doc.lines
    .filter((line): line is ItemLine => line.kind === "item")
    .map(line => line.item);
}

/**
 * `dds parse <file> [--json]`
 *
 * **出力に必ずアイテム ID を含める。** `patch` は ID で対象を指すので、
 * ID が無いと CLI だけでは編集を始められない。
 */
export function cmdParse(args: Args): number {
  const file = requireFile(args, "parse");
  if (file === undefined) return EXIT.usage;

  const loaded = load(file);
  if (loaded === undefined) return lastLoadFailure;

  const { doc } = loaded;

  if (args.flags.has("json")) {
    out(
      JSON.stringify(
        {
          encoding: doc.encoding,
          eol: doc.eol === "\r\n" ? "crlf" : "lf",
          bom: doc.bom,
          lineWidth: doc.lineWidth,
          records: doc.records.map(record => ({
            name: record.name,
            lineIndex: record.lineIndex,
            itemIds: record.itemIds
          })),
          items: items(doc).map(item => ({
            id: item.id,
            kind: item.kind,
            record: item.record,
            lineIndex: item.lineIndex,
            name: item.name,
            text: item.text,
            length: item.length,
            dataType: item.dataType,
            usage: item.usage,
            line: item.line,
            pos: item.pos,
            keywords: item.keywords
          }))
        },
        null,
        2
      )
    );
    return EXIT.ok;
  }

  out(`${file}  [${doc.encoding}, ${doc.eol === "\r\n" ? "CRLF" : "LF"}, ${doc.lines.length} 行]`);
  for (const record of doc.records) {
    out(`\nR ${record.name}`);
    for (const item of items(doc).filter(i => i.record === record.name)) {
      const where =
        item.line !== undefined && item.pos !== undefined
          ? `${item.line} 行 ${item.pos} 桁`
          : "(位置なし)";
      const what =
        item.kind === "field"
          ? `${item.name} ${item.length ?? "?"}${item.dataType ?? ""} ${item.usage ?? ""}`
          : JSON.stringify(item.text ?? "(解釈不能)");
      out(`  ${item.id.padEnd(16)} ${item.kind.padEnd(9)} ${where.padEnd(14)} ${what}`);
    }
  }
  return EXIT.ok;
}

/** `dds render <file> [--record NAME] [--all] [--rows N] [--cols N]` */
export function cmdRender(args: Args): number {
  const file = requireFile(args, "render");
  if (file === undefined) return EXIT.usage;

  const loaded = load(file);
  if (loaded === undefined) return lastLoadFailure;

  const record = args.flags.get("record");
  process.stdout.write(
    renderAscii(loaded.doc, {
      record: typeof record === "string" ? record : undefined,
      allRecords: args.flags.has("all"),
      screen: screenFrom(args)
    })
  );
  return EXIT.ok;
}

/**
 * `dds validate <file>`
 *
 * **警告だけなら 0 で終わる。** 実機の `CRTDSPF` も隣接違反を severity 10 の警告として
 * コンパイルを通す（spec D7）。エディタ側が実機より厳しくしない。
 */
export function cmdValidate(args: Args): number {
  const file = requireFile(args, "validate");
  if (file === undefined) return EXIT.usage;

  const loaded = load(file);
  if (loaded === undefined) return lastLoadFailure;

  const diagnostics = validate(loaded.doc, screenFrom(args));

  if (diagnostics.length === 0) {
    out("問題は見つかりませんでした。");
    return EXIT.ok;
  }

  for (const d of diagnostics) {
    const mark = d.severity === "error" ? "エラー" : "警告  ";
    out(`${mark} ${d.code} ${d.itemId} (行 ${d.sourceLine + 1}): ${d.message}`);
  }

  const errors = diagnostics.filter(d => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  out(`\nエラー ${errors} 件 / 警告 ${warnings} 件`);

  return errors > 0 ? EXIT.validationFailed : EXIT.ok;
}

/**
 * `dds patch <file> --ops <file|-> [--write | --stdout]`
 *
 * 既定は `--stdout`。**破壊的な操作は明示させる。**
 */
export function cmdPatch(args: Args): number {
  const file = requireFile(args, "patch");
  if (file === undefined) return EXIT.usage;

  // **矛盾する指定は受け付けない。** `--stdout` は「書き換えない」という意思表示なので、
  // `--write` に黙って負けると、非破壊のつもりの指定が無視されて破壊される。
  if (args.flags.has("write") && args.flags.has("stdout")) {
    err("dds patch: --write と --stdout は同時に指定できません");
    return EXIT.usage;
  }

  const opsPath = args.flags.get("ops");
  if (typeof opsPath !== "string") {
    err("dds patch: --ops <file|-> を指定してください（- で標準入力）");
    return EXIT.usage;
  }

  let opsText: string;
  try {
    opsText = opsPath === "-"
      ? readFileSync(0, "utf8")
      : readFileSync(opsPath, "utf8");
  } catch {
    err(`dds patch: 操作を読めません: ${opsPath}`);
    return EXIT.usage;
  }

  let ops: PatchOp[];
  try {
    const parsed = JSON.parse(opsText);
    ops = Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    err(`dds patch: 操作が JSON として読めません: ${(error as Error).message}`);
    return EXIT.usage;
  }

  const loaded = load(file);
  if (loaded === undefined) return lastLoadFailure;

  let result;
  try {
    result = applyOps(loaded.doc, ops, screenFrom(args));
  } catch (error) {
    if (error instanceof PatchRejectedError) {
      err(`dds patch: ${error.message}`);
      for (const d of error.diagnostics) {
        err(`  ${d.code} ${d.itemId}: ${d.message}`);
      }
      return EXIT.validationFailed;
    }
    err(`dds patch: ${(error as Error).message}`);
    return EXIT.usage;
  }

  for (const d of result.diagnostics.filter(x => x.severity === "warning")) {
    err(`警告 ${d.code} ${d.itemId}: ${d.message}`);
  }

  if (args.flags.has("write")) {
    try {
      saveSource(file, result.text, loaded.encoding, loaded.bom);
    } catch (error) {
      if (error instanceof EncodingError) {
        err(`dds patch: ${error.message}`);
        return EXIT.usage;
      }
      throw error;
    }
    out(
      `${file} を更新しました（${result.changedLines.start + 1}〜${result.changedLines.end} 行）`
    );
    return EXIT.ok;
  }

  process.stdout.write(result.text);
  return EXIT.ok;
}

/**
 * `dds init <file> --record NAME [--rows N] [--cols N]`
 *
 * **これは編集操作ではなく足場作り。** GUI で言えば「新規ファイル」に当たる。
 * `PatchOp` は 4 種（move / resize / add / remove）のまま保ちたいので、
 * 「空から様式を作る」だけをここに置いた。
 *
 * **AC4（CLI が GUI と同等）の対象外**である点に注意。AC4 が言う同等は
 * L1 の編集能力についてであり、足場作りは別物。
 */
export function cmdInit(args: Args): number {
  const file = requireFile(args, "init");
  if (file === undefined) return EXIT.usage;

  const record = args.flags.get("record");
  if (typeof record !== "string" || record === "") {
    err("dds init: --record <NAME> を指定してください");
    return EXIT.usage;
  }
  if (!/^[A-Z#$@][A-Z0-9#$@_]{0,9}$/i.test(record)) {
    err(`dds init: レコード様式名として不正です: ${record}`);
    return EXIT.usage;
  }

  const screen = screenFrom(args);
  const size = screen.rows === 27 && screen.cols === 132 ? "*DS4" : "*DS3";

  const lines = [
    column({ func: `DSPSIZ(${screen.rows} ${screen.cols} ${size})` }),
    column({ record: record.toUpperCase() })
  ];

  try {
    saveSource(file, lines.join("\n") + "\n", "utf8", false);
  } catch (error) {
    err(`dds init: 書き込めません: ${(error as Error).message}`);
    return EXIT.usage;
  }

  out(`${file} を作成しました（様式 ${record.toUpperCase()}）`);
  return EXIT.ok;
}

/** DDS の 1 行を桁どおりに組み立てる（`init` 専用の最小実装）。 */
function column(spec: { record?: string; func?: string }): string {
  const cells = new Array<string>(80).fill(" ");
  const put = (start: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      cells[start - 1 + i] = text[i];
    }
  };
  put(6, "A");
  if (spec.record !== undefined) {
    put(17, "R");
    put(19, spec.record);
  }
  if (spec.func !== undefined) {
    put(45, spec.func);
  }
  return cells.join("").trimEnd();
}

/** `serialize` を CLI から使えるように（テスト用の再エクスポート）。 */
export { serialize };
