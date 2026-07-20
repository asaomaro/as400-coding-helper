import type { Dialect, PrompterDefinition } from "../prompter/types";
import { createRpgSpecContext } from "../core/rpgSpec";
import { resolveSourceKind } from "../core/sourceKind";
import type { DefinitionSet } from "./defsLoader";
import { classifyLine, type LintLanguage } from "./preprocess";
import { RULE_SPECS, defaultEnabledRules, ruleSpec } from "./rules";
import type { LintFinding, LintOptions, RuleId } from "./types";

/**
 * ファイル 1 本を検査する。
 *
 * **ファイル単位にしている理由**: ILE の I/O 仕様書は変種が F 仕様書 22 桁目に
 * 依存するため、判定に先行行が要る。行単位 API では成立しない。
 * 先行行は `RpgSpecContext` が蓄積するので、走査は 1 度きり（O(n)）。
 */

export interface LintRequest {
  /** 種別・方言の判定に使う。読み込みはしない。 */
  readonly fsPath: string;
  /** ソース行（改行を含まない）。 */
  readonly lines: readonly string[];
  readonly definitions: DefinitionSet;
  readonly options?: LintOptions;
}

export function lintFile(request: LintRequest): readonly LintFinding[] {
  const kind = resolveSourceKind(request.fsPath, request.options?.dialectOverrides);

  // 対象外の拡張子はエラーにしない（指摘ゼロで正常終了）。
  if (!kind) return [];
  if (kind.language !== "rpg-fixed" && kind.language !== "dds") return [];
  // `.dds` は種別が決まらない（既存の resolveDdsType と同じ扱い）。
  if (kind.language === "dds" && !kind.ddsType) return [];

  const language: LintLanguage = kind.language;
  const enabled = resolveEnabledRules(request.options?.enabledRules);
  if (enabled.length === 0) return [];

  const rpgContext =
    language === "rpg-fixed"
      ? createRpgSpecContext(request.options?.cNewOpcodes)
      : undefined;

  const findings: LintFinding[] = [];

  request.lines.forEach((line, index) => {
    // DDS は種別がファイル単位で決まるので行ごとの判定をしない。
    const specKeyword =
      language === "dds" ? kind.ddsType : rpgContext?.classify(line, kind.dialect);

    const lineKind = classifyLine(line, language, specKeyword);
    if (lineKind === "comment" || lineKind === "skipped") {
      return;
    }

    const definition = specKeyword
      ? lookupDefinition(request.definitions, language, kind.dialect, specKeyword)
      : undefined;

    const context = {
      line,
      lineNumber: index + 1,
      definition,
      specKeyword,
      dialect: kind.dialect
    };

    for (const spec of enabled) {
      // 継続記入行には定位置の欄が無いので、桁数の上限だけを見る。
      if (lineKind === "continuation" && !spec.appliesToContinuation) {
        continue;
      }
      findings.push(...spec.rule(context));
    }
  });

  findings.sort(
    (a, b) => a.line - b.line || a.startColumn - b.startColumn
  );
  return findings;
}

function lookupDefinition(
  definitions: DefinitionSet,
  language: LintLanguage,
  dialect: Dialect | undefined,
  keyword: string
): PrompterDefinition | undefined {
  // 方言でディレクトリが分かれるのは RPG だけ。
  return definitions.get(
    language,
    language === "rpg-fixed" ? dialect : undefined,
    keyword
  );
}

function resolveEnabledRules(enabledRules: readonly RuleId[] | undefined) {
  const ids = enabledRules ?? defaultEnabledRules();
  const seen = new Set(ids);
  return RULE_SPECS.filter(spec => seen.has(spec.id));
}
