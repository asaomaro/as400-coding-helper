import * as vscode from "vscode";
import { lintFile } from "../lint/engine";
import { defaultResourcesDir, loadDefinitions, type DefinitionSet } from "../lint/defsLoader";
import { defaultEnabledRules } from "../lint/rules";
import type { LintFinding, RuleId } from "../lint/types";

/**
 * 桁位置検査の vscode 側の殻。
 *
 * 検査そのものは `lint/engine.ts`（vscode 非依存）にあり、ここは
 * 設定を読んで結果を `vscode.Diagnostic` に写すだけ。CLI と同じロジックが
 * 動くので「エディタでは出ないが CI で落ちる」食い違いが起きない。
 */

const CONFIG_SECTION = "rpgClSupport";

// 同梱の定義は動かないので一度読んだら使い回す。
let definitions: DefinitionSet | undefined;

function getDefinitions(): DefinitionSet {
  // out/language/ から見た resources の位置は out/lint/ と同じ深さ。
  definitions ??= loadDefinitions(defaultResourcesDir(__dirname));
  return definitions;
}

/** 設定 `rpgClSupport.lint.rules` で規則ごとに上書きする。 */
function resolveEnabledRules(): RuleId[] {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const overrides = config.get<Record<string, unknown>>("lint.rules") ?? {};
  const enabled = new Set<RuleId>(defaultEnabledRules());

  for (const [id, value] of Object.entries(overrides)) {
    if (typeof value !== "boolean") continue;
    if (value) enabled.add(id as RuleId);
    else enabled.delete(id as RuleId);
  }

  return [...enabled];
}

function isEnabled(): boolean {
  return (
    vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<boolean>("lint.enable") !== false
  );
}

function toDiagnostic(finding: LintFinding): vscode.Diagnostic {
  const range = new vscode.Range(
    new vscode.Position(finding.line - 1, finding.startColumn - 1),
    new vscode.Position(finding.line - 1, finding.endColumn - 1)
  );
  const diagnostic = new vscode.Diagnostic(
    range,
    finding.message,
    finding.severity === "error"
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Warning
  );
  diagnostic.source = "rpgClSupport";
  diagnostic.code = finding.ruleId;
  return diagnostic;
}

export function lintDocument(document: vscode.TextDocument): vscode.Diagnostic[] {
  if (!isEnabled()) {
    return [];
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const lines: string[] = [];
  for (let index = 0; index < document.lineCount; index += 1) {
    lines.push(document.lineAt(index).text);
  }

  const findings = lintFile({
    fsPath: document.uri.fsPath,
    lines,
    definitions: getDefinitions(),
    options: {
      enabledRules: resolveEnabledRules(),
      dialectOverrides: config.get<Record<string, unknown>>("rpgDialectByExtension")
    }
  });

  return findings.map(toDiagnostic);
}
