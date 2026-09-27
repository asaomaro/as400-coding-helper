import dspfDefinition from "../../../resources/prompter/dds/ja/DDS-DSPF.json";
import prtfDefinition from "../../../resources/prompter/dds/ja/DDS-PRTF.json";

/**
 * フィールドを置くときに聞く**型（35 桁）と使用（38 桁）の選択肢**。
 *
 * 置くときに名前と桁数しか聞かず、数値の出力項目は置いたあとにプロパティで直す 2 段になっていた
 * （実操作調査の D6。2026-09-27 に利用者が「型・小数・使用も聞く」と決めた）。
 * 値の一覧は F4 プロンプターの定義（原典から生成した `DDS-DSPF.json` / `DDS-PRTF.json` の 35・38 桁）をそのまま使う
 * ——同じ一覧をもう 1 か所に書かない。既定は今までと同じ（型 A、使用は画面 B・帳票は書かない）。
 *
 * このモジュールは **vscode を import しない**（VS Code 版と単独起動の両方のホストが使う）。
 */
export interface FieldChoice {
  readonly value: string;
  readonly label: string;
}

export interface FieldPlacementChoices {
  readonly dataTypes: readonly FieldChoice[];
  readonly usages: readonly FieldChoice[];
  readonly defaultDataType: string;
  readonly defaultUsage: string;
  /** 小数点以下の桁数を聞く型（数値の型）。 */
  readonly decimalTypes: ReadonlySet<string>;
}

interface PositionalDefinition {
  readonly parameters: readonly { readonly name: string; readonly options?: readonly FieldChoice[] }[];
}

const optionsAt = (definition: PositionalDefinition, name: string): FieldChoice[] =>
  (definition.parameters.find(parameter => parameter.name === name)?.options ?? []).map(option => ({
    value: option.value,
    label: option.label
  }));

export function fieldPlacementChoices(ddsType: "DDS-DSPF" | "DDS-PRTF"): FieldPlacementChoices {
  const definition = (ddsType === "DDS-PRTF" ? prtfDefinition : dspfDefinition) as PositionalDefinition;
  return {
    dataTypes: optionsAt(definition, "C35"),
    usages: optionsAt(definition, "C38"),
    defaultDataType: "A",
    defaultUsage: ddsType === "DDS-PRTF" ? "" : "B",
    decimalTypes: new Set(ddsType === "DDS-PRTF" ? ["S", "F"] : ["S", "Y", "N", "D", "F"])
  };
}
