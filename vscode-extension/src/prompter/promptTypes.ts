import { classifyRpgSpecKeyword } from "../core/rpgSpec";
import type { Dialect, PrompterDefinition } from "./types";

/**
 * **プロンプト・タイプ**（ACS / SEU と同じ切り替え）。
 *
 * ACS は空行で F4 するとプロンプト・タイプ `**` の「データ域」（桁の目盛りつきの 1 行）を出し、プロンプト・タイプの欄に
 * `C` / `CX` / `H` / `F` / `D` / `P` などを入れると、その仕様書のプロンプトに切り替わる。2026-09-27 に利用者がこれに揃えると決めた
 * （実操作調査の P15。以前は空行だと英語で断られ、空の `C` は必ず従来形式で開き、拡張演算項目 2 の形式で開く手段が無かった）。
 *
 * このモジュールは **vscode を import しない**。
 */

/** プロンプト・タイプの欄の名前（行には書かない。ホストが外して書き戻す）。 */
export const PROMPT_TYPE_PARAMETER = "PROMPT_TYPE";
/** データ域の定義のキーワード。 */
export const DATA_AREA_KEYWORD = "**";

/** データ域（プロンプト・タイプ `**`）の定義。1-80 桁をそのまま 1 つの欄にする。 */
export function dataAreaDefinition(lang: "ja" | "en" = "ja"): PrompterDefinition {
  return {
    keyword: DATA_AREA_KEYWORD,
    description: lang === "en" ? "Data area" : "データ域",
    help:
      lang === "en"
        ? "Enter the source line as is (positions 1-80). Change the prompt type to open the prompt for a specification."
        : "行をそのまま入力します（1-80 桁）。プロンプト・タイプを変えると、その仕様書のプロンプトに切り替わります。",
    parameters: [
      {
        name: "DATA",
        description: lang === "en" ? "Data area" : "データ域",
        inputType: "text",
        required: false,
        sourceStart: 1,
        sourceLength: 80,
        attributes: { ruler: true }
      }
    ]
  } as PrompterDefinition;
}

/** 表示する定義の先頭にプロンプト・タイプの欄を足す。 */
export function withPromptType(definition: PrompterDefinition, lang: "ja" | "en" = "ja"): PrompterDefinition {
  return {
    ...definition,
    parameters: [
      {
        name: PROMPT_TYPE_PARAMETER,
        description: lang === "en" ? "Prompt type" : "プロンプト・タイプ",
        help:
          lang === "en"
            ? "** = data area, H / F / D / I / C / O / P = that specification, CX = calculation with extended factor 2. Change it and press OK to switch the prompt."
            : "** = データ域、H / F / D / I / C / O / P = その仕様書、CX = 拡張演算項目 2 の演算。変えて OK を押すとプロンプトが切り替わります。",
        inputType: "text",
        required: false,
        attributes: { characterSet: "upper", maxLength: 2 }
      },
      ...definition.parameters
    ]
  } as PrompterDefinition;
}

/** 定義のキーワード → プロンプト・タイプ（`C-NEW` は `CX`、それ以外は仕様書の文字）。 */
export function promptTypeOf(keyword: string): string {
  if (keyword === DATA_AREA_KEYWORD) return DATA_AREA_KEYWORD;
  if (keyword.toUpperCase() === "C-NEW") return "CX";
  return keyword.charAt(0).toUpperCase();
}

/**
 * プロンプト・タイプ → 開く定義のキーワード。使えないタイプなら undefined。
 * I / O 仕様書は F 仕様書（22 桁目）と行の中身で定義が変わるので、仕様書の文字を置いた行を分類器に通して決める。
 */
export function keywordForPromptType(
  type: string,
  lineText: string,
  dialect: Dialect | undefined,
  precedingLines: readonly string[]
): string | undefined {
  const code = type.trim().toUpperCase();
  if (code === DATA_AREA_KEYWORD) return DATA_AREA_KEYWORD;
  const ile = (dialect ?? "ile") === "ile";
  const allowed = ile ? ["H", "F", "D", "I", "C", "CX", "O", "P"] : ["H", "F", "E", "L", "I", "C", "O"];
  if (!allowed.includes(code)) return undefined;
  if (code === "CX") return "C-NEW";
  if (code === "C") return "C-SPEC";
  const withLetter = lineText.padEnd(6, " ").slice(0, 5) + code + lineText.slice(6);
  return classifyRpgSpecKeyword(withLetter, { dialect, precedingLines: [...precedingLines] }) ?? undefined;
}
