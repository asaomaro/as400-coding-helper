import { DDS_COLUMNS, ddsField } from "../ddsLayout";
import { indexExceedingWidth } from "../dbcs";
import { resolveKeywordGroups } from "./ddsConditioning";
import { keywordsRequiringConditioning, type ConditionableDdsType } from "./ddsConditionable";
import type { LogicalUnit } from "./ddsLogicalUnits";
import { DDS_POSITION_COLUMN, DDS_POSITION_ROW } from "./ddsPositionColumns";

/**
 * **ソースの形だけで分かる、実機が作成しない誤り。**
 *
 * エディタの検証は重なり・レベルしか見ておらず、実機で重大度 20 以上になる誤りを
 * 1 つも指摘しなかった（2026-09-27 の実操作調査の D18）。どれも位置欄・使用・条件の有無・
 * 行の長さを見れば判定できる。各診断は実機で作成できないことを確かめてある
 * （`.aidev/works/20260927-dds-validation-machine-errors/verify/`）。
 *
 * このモジュールは **vscode を import しない**。
 */

export type DdsSourceDiagnosticCode =
  /** 条件（オプション標識）が必須のキーワードに条件が無い。実機 CPD7490。 */
  | "keyword-needs-indicator"
  /** 位置を持てない使用（画面 H・P・M、帳票 P）に位置がある。実機 CPD7443 / CPD7436。 */
  | "position-not-allowed"
  /** 帳票の使用が 空白・O・P 以外。実機 CPD7410。 */
  | "invalid-usage"
  /** リテラルが 80 桁目までに閉じていない（継続も無い）。実機 CPD7508。 */
  | "unclosed-literal";

export interface DdsSourceDiagnostic {
  readonly code: DdsSourceDiagnosticCode;
  readonly message: string;
  /** 1 始まり。 */
  readonly sourceLine: number;
}

/** 実機が読むのは 80 桁目まで。81-100 桁は注記域（原典）なので、行が長いこと自体は誤りではない。 */
const MAX_COLUMNS = 80;
/** キーワード欄は 45 桁目から。 */
const KEYWORD_AREA_INDEX = 44;

const PRTF_USAGES: ReadonlySet<string> = new Set(["", "O", "P"]);

export function ddsSourceDiagnostics(
  lines: readonly string[],
  units: readonly LogicalUnit[],
  ddsType: ConditionableDdsType
): DdsSourceDiagnostic[] {
  const diagnostics: DdsSourceDiagnostic[] = [];

  diagnostics.push(...unclosedLiterals(lines));

  for (const unit of units) {
    for (const group of resolveKeywordGroups(unit)) {
      if (group.conditioning.kind === "indicators") continue;
      const names = keywordsRequiringConditioning(ddsType, group.keywords);
      if (names.length === 0) continue;
      diagnostics.push({
        code: "keyword-needs-indicator",
        message:
          `${names.join(" / ")} には条件標識が必要です` +
          "（原典: このキーワードにはオプション標識を指定しなければなりません。実機 CPD7490）",
        sourceLine: group.sourceLine
      });
    }

    if (unit.kind !== "item") continue;
    const usage = ddsField(unit.line, DDS_COLUMNS.usage).trim().toUpperCase();
    const hasPosition =
      ddsField(unit.line, DDS_POSITION_ROW).trim().length > 0 ||
      ddsField(unit.line, DDS_POSITION_COLUMN).trim().length > 0;
    const positionless = ddsType === "PRTF" ? usage === "P" : usage === "H" || usage === "P" || usage === "M";
    if (positionless && hasPosition) {
      diagnostics.push({
        code: "position-not-allowed",
        message:
          `使用が ${usage} の項目は位置（39-44 桁）を持てません` +
          `（原典: 位置を指定することはできません。実機 ${usage === "M" ? "CPD7436" : "CPD7443"}）`,
        sourceLine: unit.sourceLine
      });
    }
    if (ddsType === "PRTF" && !PRTF_USAGES.has(usage)) {
      diagnostics.push({
        code: "invalid-usage",
        message: `印刷装置ファイルの使用は 空白・O・P のいずれかです（"${usage}"。実機 CPD7410）`,
        sourceLine: unit.sourceLine
      });
    }
  }

  return diagnostics;
}

/**
 * **80 桁目までに閉じず、次の行にも続かないリテラル**。実機は 81 桁目以降を注記として読まないので、
 * 1 行に書いた長い定数は閉じないまま次の項目・様式の行を飲み込み、CPD7508「引用符つきストリングの
 * 終わりにアポストロフィがない」で作成できない（実操作調査の D16。エディタは以前これを 1 行に書いていた）。
 *
 * **閉じないこと自体は誤りではない。** 次の行がキーワードだけの行（7-44 桁が空白）なら、
 * 継続記号が無くても空白 1 つを挟んで続く（実機で確認済み。`.aidev/works/20260827-dds-keyword-continuation/`
 * の research.md）。`-` / `+` の継続も同じく次の行へ続く。咎めるのは、続く先が無いときだけ。
 * 81 桁目以降に何か書いてあっても、注記域なので見ない。
 */
function unclosedLiterals(lines: readonly string[]): DdsSourceDiagnostic[] {
  const diagnostics: DdsSourceDiagnostic[] = [];
  let openedAt: number | undefined; // 開いたままのリテラルが始まった行（1 始まり）

  const isComment = (line: string): boolean => line.charAt(6) === "*";
  const continuesKeywords = (line: string): boolean => line.slice(6, KEYWORD_AREA_INDEX).trim().length === 0;
  const report = (sourceLine: number): void => {
    diagnostics.push({
      code: "unclosed-literal",
      message:
        "リテラルが 80 桁目までに閉じず、次の行にも続いていません（実機は 81 桁目以降を読まず、CPD7508 で作成できません）。" +
        "長い定数は `-` で継続行に分けます",
      sourceLine
    });
  };

  lines.forEach((line, index) => {
    if (isComment(line)) return;
    if (openedAt !== undefined && !continuesKeywords(line)) {
      // 続く先がキーワード行ではない（次の項目・様式）。ここでは閉じていない。
      report(openedAt);
      openedAt = undefined;
    }
    const cut = indexExceedingWidth(line, MAX_COLUMNS);
    const area = (cut === undefined ? line : line.slice(0, cut)).slice(KEYWORD_AREA_INDEX);
    let inLiteral = openedAt !== undefined;
    for (const character of area) {
      if (character === "'") inLiteral = !inLiteral;
    }
    if (inLiteral) openedAt ??= index + 1;
    else openedAt = undefined;
  });
  if (openedAt !== undefined) report(openedAt);

  return diagnostics;
}
