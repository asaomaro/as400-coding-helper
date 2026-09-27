/**
 * フィールドを置くときに聞く**型（35 桁）と使用（38 桁）の選択肢**。
 *
 * 置くときに名前と桁数しか聞かず、数値の出力項目は置いたあとにプロパティで直す 2 段になっていた
 * （実操作調査の D6。2026-09-27 に利用者が「型・小数・使用も聞く」と決めた）。
 * 値の一覧は F4 プロンプターの定義（原典から生成した `DDS-DSPF.json` / `DDS-PRTF.json` の 35・38 桁）をそのまま使う
 * ——同じ一覧をもう 1 か所に書かない。既定は今までと同じ（型 A、使用は画面 B・帳票は書かない）。
 *
 * **定義は呼び出し側が渡す。** ここで JSON を import すると、tsc が `resources/prompter/` の一部だけを出力先に写し、
 * 定義を相対パスで探すコード（lint など）が本物の定義ではなくその一部を読んでしまう（実際にテストが 40 件落ちた）。
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

export interface PositionalDefinition {
  readonly parameters: readonly { readonly name: string; readonly options?: readonly FieldChoice[] }[];
}

const optionsAt = (definition: PositionalDefinition, name: string): FieldChoice[] =>
  (definition.parameters.find(parameter => parameter.name === name)?.options ?? []).map(option => ({
    value: option.value,
    label: option.label
  }));

export function fieldPlacementChoices(
  ddsType: "DDS-DSPF" | "DDS-PRTF",
  definition: PositionalDefinition
): FieldPlacementChoices {
  return {
    dataTypes: optionsAt(definition, "C35"),
    usages: optionsAt(definition, "C38"),
    defaultDataType: "A",
    defaultUsage: ddsType === "DDS-PRTF" ? "" : "B",
    decimalTypes: new Set(ddsType === "DDS-PRTF" ? ["S", "F"] : ["S", "Y", "N", "D", "F"])
  };
}

/**
 * 定数を置くときの**種類**。先頭の空文字は「文字列（リテラル）」、それ以外は文字列の無い定数のキーワード
 * （実操作調査の D4）。見本の桁数は実機で確かめたもの（`readKeywordConstant`）。
 */
export function constantKindChoices(ddsType: "DDS-DSPF" | "DDS-PRTF"): readonly FieldChoice[] {
  const common: FieldChoice[] = [
    { value: "", label: "文字列（'…'）" },
    { value: "DATE", label: "DATE 日付（MMDDYY）" },
    { value: "DATE EDTCDE(Y)", label: "DATE EDTCDE(Y) 日付（MM/DD/YY）" },
    { value: "DATE(*YY) EDTCDE(Y)", label: "DATE(*YY) EDTCDE(Y) 日付（MM/DD/YYYY）" },
    { value: "TIME", label: "TIME 時刻（HH:MM:SS）" }
  ];
  return ddsType === "DDS-PRTF"
    ? [...common, { value: "PAGNBR", label: "PAGNBR ページ番号" }]
    : [...common, { value: "SYSNAME", label: "SYSNAME システム名" }, { value: "USER", label: "USER ユーザー" }];
}
