#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { lintFile } from "../lint/engine";
import { defaultResourcesDir, loadDefinitions } from "../lint/defsLoader";
import { RULE_SPECS, defaultEnabledRules } from "../lint/rules";
import { DEFAULT_C_NEW_OPCODES } from "../core/rpgSpec";
import { toSarif, type FileFindings } from "../lint/sarif";
import type { LintFinding, RuleId, Severity } from "../lint/types";

/**
 * 固定長ソース（RPG / DDS）の桁位置 lint。
 *
 * VSCode を必要としないので CI から素の node で叩ける。
 *   node out/cli/lint.js docs/src/CUSTMST.pf
 *
 * 終了コード: 0=閾値以上の指摘なし / 1=閾値以上の指摘あり / 2=使用法・内部エラー
 */

const USAGE = `使い方: node out/cli/lint.js [オプション] <ファイル…>

  --format <sarif|text>            出力形式（既定 sarif）
  --output <path>                  出力先（既定 標準出力）
  --rule <id>                      有効にする規則。指定すると既定を置き換える（繰り返し可）
  --no-rule <id>                   個別に無効化する（繰り返し可）
  --fail-on <error|warning|never>  終了コード 1 にする閾値（既定 error）
  --c-new-opcode <名前>            C 仕様を新形式とみなすオペコードを足す（繰り返し可）
  --help

VSCode の設定 rpgClSupport.cNewOpcodes を使っている場合は、同じ値を
--c-new-opcode で渡す。渡さないとエディタと CI で C 仕様の新旧判定が食い違い、
CI 側だけ FIELDLEN(64-68) / DECPOS(69-70) を数値欄として検査してしまう。

規則:
${RULE_SPECS.map(
  spec =>
    `  ${spec.id.padEnd(18)} ${spec.enabledByDefault ? "既定 ON " : "既定 OFF"} ` +
    `${spec.severity}`
).join("\n")}
`;

interface CliOptions {
  format: "sarif" | "text";
  output?: string;
  rules?: RuleId[];
  disabled: RuleId[];
  failOn: Severity | "never";
  cNewOpcodes: string[];
  files: string[];
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    format: "sarif",
    disabled: [],
    failOn: "error",
    cNewOpcodes: [],
    files: []
  };
  const knownRules = new Set<string>(RULE_SPECS.map(spec => spec.id));

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new UsageError(`${arg} に値がありません`);
      i += 1;
      return value;
    };

    switch (arg) {
      case "--help":
      case "-h":
        throw new UsageError("");
      case "--format": {
        const value = next();
        if (value !== "sarif" && value !== "text") {
          throw new UsageError(`--format は sarif か text です: ${value}`);
        }
        options.format = value;
        break;
      }
      case "--output":
        options.output = next();
        break;
      case "--rule": {
        const value = next();
        if (!knownRules.has(value)) throw new UsageError(`知らない規則です: ${value}`);
        (options.rules ??= []).push(value as RuleId);
        break;
      }
      case "--no-rule": {
        const value = next();
        if (!knownRules.has(value)) throw new UsageError(`知らない規則です: ${value}`);
        options.disabled.push(value as RuleId);
        break;
      }
      case "--c-new-opcode":
        options.cNewOpcodes.push(next().trim().toUpperCase());
        break;
      case "--fail-on": {
        const value = next();
        if (value !== "error" && value !== "warning" && value !== "never") {
          throw new UsageError(`--fail-on は error / warning / never です: ${value}`);
        }
        options.failOn = value;
        break;
      }
      default:
        if (arg.startsWith("-")) throw new UsageError(`知らないオプションです: ${arg}`);
        options.files.push(arg);
    }
  }

  if (options.files.length === 0) {
    throw new UsageError("検査するファイルを指定してください");
  }
  return options;
}

function formatText(files: readonly FileFindings[], baseDir: string): string {
  const lines: string[] = [];
  let total = 0;
  for (const file of files) {
    for (const finding of file.findings) {
      total += 1;
      lines.push(
        `${relative(baseDir, file.fsPath)}:${finding.line}:${finding.startColumn}: ` +
          `${finding.severity}: ${finding.message} [${finding.ruleId}]`
      );
    }
  }
  lines.push(
    total === 0 ? "指摘はありません" : `${total} 件の指摘（${files.length} ファイル）`
  );
  return lines.join("\n");
}

function shouldFail(findings: readonly LintFinding[], failOn: CliOptions["failOn"]): boolean {
  if (failOn === "never") return false;
  if (failOn === "warning") return findings.length > 0;
  return findings.some(finding => finding.severity === "error");
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

  const resourcesDir = defaultResourcesDir(__dirname);
  if (!existsSync(resourcesDir)) {
    console.error(`✗ 定義が見つかりません: ${resourcesDir}`);
    console.error("  npm run compile を実行してから叩いてください。");
    return 2;
  }
  const definitions = loadDefinitions(resourcesDir);

  const enabled = (options.rules ?? defaultEnabledRules()).filter(
    id => !options.disabled.includes(id)
  );

  const baseDir = process.cwd();
  const results: FileFindings[] = [];
  const all: LintFinding[] = [];

  for (const file of options.files) {
    const fsPath = resolve(baseDir, file);
    let text: string;
    try {
      text = readFileSync(fsPath, "utf8");
    } catch {
      console.error(`✗ 読めません: ${file}`);
      return 2;
    }

    const findings = lintFile({
      fsPath,
      lines: text.split(/\r?\n/),
      definitions,
      options: {
        enabledRules: enabled,
        ...(options.cNewOpcodes.length > 0
          ? {
              cNewOpcodes: new Set([
                ...DEFAULT_C_NEW_OPCODES,
                ...options.cNewOpcodes
              ])
            }
          : {})
      }
    });
    results.push({ fsPath, findings });
    all.push(...findings);
  }

  const output =
    options.format === "sarif"
      ? `${JSON.stringify(toSarif(results, { baseDir }), null, 2)}\n`
      : `${formatText(results, baseDir)}\n`;

  if (options.output) {
    try {
      writeFileSync(resolve(baseDir, options.output), output, "utf8");
    } catch (error) {
      // 読み込み側と同じく、終了コードの規約（0/1/2）から外れないようにする。
      console.error(`✗ 書き込めません: ${options.output}（${String(error)}）`);
      return 2;
    }
  } else {
    process.stdout.write(output);
  }

  return shouldFail(all, options.failOn) ? 1 : 0;
}

// require された場合（テスト）は実行しない。
if (require.main === module) {
  process.exit(run(process.argv.slice(2)));
}
