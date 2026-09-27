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
