/**
 * dds CLI のエントリポイント。
 *
 * **AI エージェントから使われることを前提に設計している。**
 * したがって次の 2 つを守る:
 *
 * - **終了コードで成否が判断できる**（0=OK / 1=使用法・入出力 / 2=パース失敗 / 3=検証違反）。
 * - **`parse --json` が ID を返す**。`patch` は ID で対象を指すので、
 *   ID が出ないと CLI だけでは編集を始められない。
 *
 * 実装はすべて `dds-core` を呼ぶだけで、CLI 独自の編集経路を持たない。
 * GUI も同じコアを通るため、「CLI が GUI と同等」（requirement AC4）が構造で保たれる。
 */

import { DDS_CORE_VERSION } from "@as400/dds-core";
import {
  cmdParse,
  cmdRender,
  cmdValidate,
  cmdPatch,
  cmdInit,
  EXIT,
  type Args
} from "./commands.js";

const USAGE = `使用法: dds <command> [options]

コマンド:
  init     <file> --record NAME [--rows N] [--cols N]
             新しい DDS を作る（足場作り。編集操作ではない）

  parse    <file> [--json]
             構造化モデルに変換する。**出力にアイテム ID が含まれる**（patch の対象指定に使う）

  render   <file> [--record NAME] [--all] [--rows N] [--cols N]
             様式を ASCII で描画する。既定は最初の様式（--all で全様式を重ねる）

  validate <file> [--rows N] [--cols N]
             配置を検証する。**警告だけなら 0 で終わる**（実機もコンパイルを通すため）

  patch    <file> --ops <file|-> [--write | --stdout]
             構造化操作で編集する。--ops - で標準入力から読む。既定は --stdout

  --help, -h     この使用法を表示する
  --version, -V  版数を表示する

終了コード: 0=OK / 1=使用法・入出力エラー / 2=パース失敗 / 3=検証違反

操作の形（patch の --ops に渡す JSON。配列でも単体でも可）:
  {"op":"moveItem",   "id":"REC1#3", "line":7, "pos":30}
  {"op":"resizeItem", "id":"REC1#3", "length":12}
  {"op":"addItem",    "record":"REC1", "item":{"kind":"field","name":"FLD1",
                       "length":10,"dataType":"A","usage":"O","line":5,"pos":2}}
  {"op":"addItem",    "record":"REC1", "item":{"kind":"constant","text":"NAME","line":4,"pos":2}}
  {"op":"removeItem", "id":"REC1#3"}

注意: **addItem / removeItem の後は ID が振り直される。**
      構造を変えたら parse し直して ID を取り直すこと。
      moveItem / resizeItem では ID は変わらない。`;

/** `--key value` と `--flag` を解析する。 */
function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }

  return { positional, flags };
}

export function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;

  if (command === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return EXIT.usage;
  }

  if (command === "--help" || command === "-h") {
    process.stdout.write(`${USAGE}\n`);
    return EXIT.ok;
  }

  if (command === "--version" || command === "-V") {
    process.stdout.write(`dds ${DDS_CORE_VERSION}\n`);
    return EXIT.ok;
  }

  const args = parseArgs(rest);

  switch (command) {
    case "init":
      return cmdInit(args);
    case "parse":
      return cmdParse(args);
    case "render":
      return cmdRender(args);
    case "validate":
      return cmdValidate(args);
    case "patch":
      return cmdPatch(args);
    default:
      process.stderr.write(`dds: 未知のコマンド: ${command}\n\n${USAGE}\n`);
      return EXIT.usage;
  }
}

/* c8 ignore start */
if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
/* c8 ignore stop */
