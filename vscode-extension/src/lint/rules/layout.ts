import { DDS_COLUMNS } from "../../core/ddsLayout";
import { DDS_KEYWORD_AREA_START } from "../../core/dds/ddsLogicalUnits";
import { resolveDspfLayout } from "../../core/dds/dspfLayout";
import { resolvePrtfLayout } from "../../core/dds/prtfLayout";
import type { FileRule, FileRuleContext, LintFinding, RuleId, Severity } from "../types";

/**
 * レイアウト解決の診断を lint の指摘に写す。
 *
 * **診断そのものは作らない**。`dspfLayout` / `prtfLayout` が既に出しているものを
 * 読んで写すだけ（同じ計算を 2 か所に持たない）。
 *
 * ■ なぜファイル単位か
 *   項目の重なり・画面サイズ・はみ出しは、**ファイルを解決し切らないと決まらない**。
 *   行単位の `Rule` では書けないため `FileRule` として別立てにしている。
 *
 * ■ 種別の振り分けは仕様（最適化ではない）
 *   物理／論理ファイルに位置欄は無いので、DSPF のリゾルバを当てると
 *   **全フィールドに `missing-position` が出る**（調査中に実測 15 件）。
 *   `ddsType` を見て、表示装置・印刷装置のときだけ回す。
 */

/** レイアウト解決の結果のうち、lint が使う部分だけ。 */
interface ResolvedDiagnostics {
  readonly diagnostics: readonly {
    readonly code: string;
    readonly message: string;
    readonly sourceLine: number;
  }[];
}

/**
 * 直前の解決結果。
 *
 * 6 つの規則が同じファイルを個別に解決すると 6 回走る。`lintFile` は 1 ファイルを
 * 同期的に処理し切るので、**直前の 1 件だけ**覚えておけば足りる。
 * キーは `lines` 配列の同一性（内容比較はしない）。
 */
let cachedLines: readonly string[] | undefined;
let cachedType: string | undefined;
let cachedResult: ResolvedDiagnostics | undefined;

function resolve(context: FileRuleContext): ResolvedDiagnostics | undefined {
  const { ddsType, lines } = context;
  if (ddsType !== "DDS-DSPF" && ddsType !== "DDS-PRTF") return undefined;

  if (cachedLines === lines && cachedType === ddsType && cachedResult) {
    return cachedResult;
  }

  const result: ResolvedDiagnostics =
    ddsType === "DDS-DSPF" ? resolveDspfLayout(lines) : resolvePrtfLayout(lines);

  cachedLines = lines;
  cachedType = ddsType;
  cachedResult = result;
  return result;
}

/** 指摘が指す桁の範囲。診断の性質で使い分ける。 */
type Span = "position" | "keywords";

/**
 * ここに載せるのは `RuleId` を持つ診断コードだけ。
 * 採っていないコード（`missing-position` / `out-of-range` 等）は `layoutRule` が
 * 作られないので到達しない。載せると「対応済み」に見えて読み手を誤らせる。
 */
const SPAN_BY_CODE: ReadonlyMap<string, Span> = new Map([
  // 位置欄（39-44 桁）を直せば解決するもの。
  ["invalid-position", "position"],
  ["column-one-reserved", "position"],
  ["overflow", "position"],
  ["overlap", "position"],
  ["spacing-with-line-number", "position"],
  // キーワード欄（45 桁以降）の記述を指すもの。
  ["invalid-screen-size", "keywords"]
]);

function spanOf(line: string, span: Span): { start: number; end: number } {
  const [positionStart, positionEnd] = DDS_COLUMNS.position;
  const wholeLine = { start: 1, end: line.length + 1 };

  if (span === "position") {
    // 欄に届かない短い行では、指す場所が無いので行全体に落とす。
    if (line.length < positionStart) return wholeLine;
    return { start: positionStart, end: Math.min(line.length, positionEnd) + 1 };
  }

  if (line.length < DDS_KEYWORD_AREA_START) return wholeLine;
  return { start: DDS_KEYWORD_AREA_START, end: line.length + 1 };
}

/**
 * 診断コード 1 つを担当する規則を作る。
 *
 * 規則を診断コードごとに分けているのは、**既定 ON/OFF が診断ごとに違う**ため
 * （実機で作成できないものだけ ON。`types.ts` の `RuleId` に根拠を書いてある）。
 */
export function layoutRule(
  code: string,
  ruleId: RuleId,
  severity: Severity
): FileRule {
  return (context: FileRuleContext): readonly LintFinding[] => {
    const resolved = resolve(context);
    if (!resolved) return [];

    const findings: LintFinding[] = [];
    for (const diagnostic of resolved.diagnostics) {
      if (diagnostic.code !== code) continue;

      const line = context.lines[diagnostic.sourceLine - 1] ?? "";
      const { start, end } = spanOf(line, SPAN_BY_CODE.get(code) ?? "position");

      findings.push({
        ruleId,
        severity,
        message: diagnostic.message,
        line: diagnostic.sourceLine,
        startColumn: start,
        endColumn: end,
        ...(context.ddsType ? { specKeyword: context.ddsType } : {})
      });
    }
    return findings;
  };
}
