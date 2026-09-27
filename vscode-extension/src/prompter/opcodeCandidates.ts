import rpgCompletionJa from "../../resources/completion/rpg-completion.json";
import rpgCompletionEn from "../../resources/completion/rpg-completion.en.json";
import { DEFAULT_C_NEW_OPCODES } from "../core/rpgSpec";
import type { Dialect, PrompterDefinition } from "./types";

/**
 * ILE RPG の C 仕様書（C-SPEC / C-NEW）の命令コードの欄に**候補**を付ける。
 *
 * 命令コードの欄は自由入力で候補が無く、何を書けるか分からなかった（2026-09-27 の実操作調査の P18）。
 * 命令の一覧は補完データ（原典の索引から生成した `rpg-completion.json`）にあり、新旧（拡張演算項目 2 を取るか）の
 * 分け方は行の分類（`DEFAULT_C_NEW_OPCODES`）と**同じ集合**を使う——定義の JSON に命令をもう一度並べない
 * （同じ概念集合を複数箇所で列挙しない。AGENTS.md）。
 *
 * 候補は制限ではない（`restricted: false`）。演算拡張つき（`EVAL(H)`）や設定で足した命令も書ける。
 * 綴りに小文字を含む総称（`ANDxx` / `IFxx`）は、そのままでは書けないので候補に入れない。
 *
 * このモジュールは **vscode を import しない**。
 */
export function withOpcodeCandidates(
  definition: PrompterDefinition,
  dialect: Dialect | undefined,
  lang: "ja" | "en"
): PrompterDefinition {
  if ((dialect ?? "ile") !== "ile") return definition;
  const keyword = definition.keyword.toUpperCase();
  if (keyword !== "C-SPEC" && keyword !== "C-NEW") return definition;

  const opcodes = ((lang === "en" ? rpgCompletionEn : rpgCompletionJa).opcodes ?? []) as { name: string; title?: string }[];
  const wanted = opcodes.filter(opcode => {
    if (opcode.name !== opcode.name.toUpperCase()) return false;
    const isNew = DEFAULT_C_NEW_OPCODES.has(opcode.name.toUpperCase());
    return keyword === "C-NEW" ? isNew : !isNew;
  });
  // C-NEW の集合には補完データに個別の名前で無いもの（`ENDIF` / `ENDSL`。原典は `ENDyy` とまとめる）も入る。
  const options = wanted.map(opcode => ({ label: `${opcode.name} ${opcode.title ?? ""}`.trim(), value: opcode.name }));
  if (keyword === "C-NEW") {
    const known = new Set(options.map(option => option.value));
    for (const name of DEFAULT_C_NEW_OPCODES) {
      if (!known.has(name)) options.push({ label: name, value: name });
    }
  }
  if (options.length === 0) return definition;

  return {
    ...definition,
    parameters: definition.parameters.map(parameter =>
      parameter.name.toUpperCase() !== "OPCODE" || (parameter.options?.length ?? 0) > 0
        ? parameter
        : {
            ...parameter,
            inputType: "dropdown",
            attributes: { ...(parameter.attributes ?? {}), restricted: false },
            options
          }
    )
  };
}

/** 欄 → 補完データの固定形式の列（日英の見出しの先頭）。 */
const COLUMN_PREFIX: Readonly<Record<string, readonly string[]>> = {
  FACTOR1: ["演算項目 1", "Factor 1"],
  FACTOR2: ["演算項目 2", "Factor 2"],
  COND: ["拡張演算項目 2", "Extended Factor 2"],
  RESULT: ["結果フィールド", "Result Field"]
};
const INDICATOR_OFFSET: Readonly<Record<string, number>> = { RESIND_HI: 0, RESIND_LO: 1, RESIND_EQ: 2 };

/**
 * その命令で**この欄に何を書くか**（F1 のヘルプに足す）。命令が分からない・その欄を使わないなら undefined。
 *
 * 演算項目の欄のヘルプは命令によらない一般の説明（「右オペランド」）だけで、入れた命令と無関係だった
 * （2026-09-27 の実操作調査の P18）。原典の索引から生成した補完データの固定形式（`fixedForm`：列ごとの意味、
 * 標識は高・低・等しいの 3 つ）から引く。
 */
export function opcodeFieldHelp(
  keyword: string,
  parameterName: string,
  opcode: string | undefined,
  lang: "ja" | "en"
): string | undefined {
  const upperKeyword = keyword.toUpperCase();
  if (upperKeyword !== "C-SPEC" && upperKeyword !== "C-NEW") return undefined;
  const name = (opcode ?? "").trim().replace(/\(.*$/u, "").toUpperCase();
  if (name.length === 0) return undefined;
  const opcodes = ((lang === "en" ? rpgCompletionEn : rpgCompletionJa).opcodes ?? []) as {
    name: string;
    fixedForm?: { columns?: string[]; values?: string[] };
  }[];
  const form = opcodes.find(entry => entry.name.toUpperCase() === name)?.fixedForm;
  const columns = form?.columns ?? [];
  const values = form?.values ?? [];
  const indicatorOffset = INDICATOR_OFFSET[parameterName.toUpperCase()];
  let value: string | undefined;
  let label: string | undefined;
  if (indicatorOffset !== undefined) {
    const at = columns.findIndex(column => column === "標識" || column === "Indicators");
    if (at < 0) return undefined;
    value = values[at + indicatorOffset];
    label = lang === "en" ? ["High", "Low", "Equal"][indicatorOffset] : ["高", "低", "等しい"][indicatorOffset];
  } else {
    const prefixes = COLUMN_PREFIX[parameterName.toUpperCase()];
    if (!prefixes) return undefined;
    const at = columns.findIndex(column => prefixes.some(prefix => column.startsWith(prefix)));
    if (at < 0) return undefined;
    value = values[at];
    label = columns[at];
  }
  if (value === undefined || value.trim().length === 0 || value === "_") {
    return lang === "en" ? `${name}: not used in this position.` : `${name} ではこの欄を使いません。`;
  }
  return lang === "en" ? `${name}: ${label} = ${value}` : `${name} の${label}: ${value}`;
}
