export type LanguageId = "rpg-fixed" | "cl";

// RPG 固定長の方言。languageId(`rpg-fixed`) とは直交する別次元で、
// 拡張子から導出する（.rpgle→ile / .rpg→rpg3、設定で上書き可）。
export type Dialect = "ile" | "rpg3";

export interface WorkspaceConfig {
  readonly workspaceRoot: string;
  readonly rules?: {
    readonly namingConventions?: Record<string, unknown>;
    readonly warningLevel?: "info" | "warning" | "error";
    readonly maxLineLength?: number;
  };
  readonly jsonDefinitionPaths: {
    readonly rpgSpecDir: string;
    readonly clCommandsDir: string;
  };
}

export interface ParameterOption {
  readonly label: string;
  readonly value: string;
}

export type ParameterInputType = "text" | "dropdown" | "number" | "group";

export interface ParameterAttributes {
  readonly characterSet?: "alpha" | "alnum" | "upper" | "any";
  readonly numericOnly?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
}

export interface ParameterDefinition {
  readonly name: string;
  readonly description: string;
  readonly help?: string;
  readonly inputType: ParameterInputType;
  readonly required: boolean;
  // RPG 固定長ソース上の桁位置 (1 始まり)。
  // JSON 側で指定されている場合は、この範囲を使って
  // 初期値の取得および書き戻しを行う。
  readonly sourceStart?: number;
  readonly sourceLength?: number;
  readonly defaultValue?: string;
  readonly attributes?: ParameterAttributes;
  readonly length?: number;
  readonly placeholder?: string;
  readonly maxOccurrences?: number;
  readonly visibleByDefault?: boolean;
  readonly options?: ParameterOption[];
  readonly children?: ParameterDefinition[];
}

export interface PrompterDefinition {
  readonly keyword: string;
  readonly description: string;
  readonly help?: string;
  readonly parameters: ParameterDefinition[];
}
