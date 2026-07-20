import { RULE_SPECS } from "./rules";
import type { LintFinding } from "./types";

/**
 * SARIF 2.1.0 への変換。
 *
 * 外部バリデータや SDK は使わない（ランタイム依存を増やさない方針）。
 * 必要なプロパティだけを素の JSON で組み立て、形は単体テストで固定する。
 */

const SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json";

export interface SarifOptions {
  /** 結果の uri をこのディレクトリからの相対パスにする。 */
  readonly baseDir?: string;
  readonly toolName?: string;
  readonly toolVersion?: string;
}

export interface FileFindings {
  readonly fsPath: string;
  readonly findings: readonly LintFinding[];
}

export function toSarif(
  files: readonly FileFindings[],
  options: SarifOptions = {}
): unknown {
  const toolName = options.toolName ?? "as400-lint";

  return {
    $schema: SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: toolName,
            informationUri:
              "https://github.com/asaomaro/as400-coding-helper",
            ...(options.toolVersion ? { version: options.toolVersion } : {}),
            // 無効な規則も出す。「その規則が存在し、既定でどう扱われるか」が
            // 結果を読む側に伝わるようにするため。
            rules: RULE_SPECS.map(spec => ({
              id: spec.id,
              shortDescription: { text: spec.description },
              defaultConfiguration: {
                level: spec.enabledByDefault ? toSarifLevel(spec.severity) : "none"
              }
            }))
          }
        },
        results: files.flatMap(file =>
          file.findings.map(finding => ({
            ruleId: finding.ruleId,
            level: toSarifLevel(finding.severity),
            message: { text: finding.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: {
                    uri: toUri(file.fsPath, options.baseDir)
                  },
                  region: {
                    startLine: finding.line,
                    startColumn: finding.startColumn,
                    endColumn: finding.endColumn
                  }
                }
              }
            ]
          }))
        )
      }
    ]
  };
}

function toSarifLevel(severity: LintFinding["severity"]): "error" | "warning" {
  return severity === "error" ? "error" : "warning";
}

/**
 * SARIF の artifactLocation.uri は POSIX 区切りの相対パスにする
 * （Windows の `\` をそのまま入れると CI 側で解決できない）。
 */
function toUri(fsPath: string, baseDir?: string): string {
  const posix = fsPath.replace(/\\/gu, "/");
  if (!baseDir) {
    return posix;
  }

  // 区切りの境界まで見る。単純な startsWith だと baseDir="/repo" が
  // "/repository/x.pf" にも一致して先頭を削ってしまう。
  const base = baseDir.replace(/\\/gu, "/").replace(/\/+$/u, "");
  if (posix === base) {
    return posix;
  }
  if (posix.startsWith(`${base}/`)) {
    return posix.slice(base.length + 1);
  }

  // baseDir の外にあるファイルは絶対パスのまま返す。先頭の "/" を落とすと
  // 相対パスに見えるのに絶対、という紛らわしい uri になる。
  return posix;
}
