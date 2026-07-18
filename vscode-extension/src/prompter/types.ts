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
  // 原典の定義済み値ごとの説明（パラメータ節の <dd>）。
  readonly help?: string;
}

export type ParameterInputType = "text" | "dropdown" | "number" | "group";

// group パラメータの連結方式。CL では修飾名と要素リストで区切り文字が異なる。
//   qualified … LIB/OBJ 形式。例: PGM(MYLIB/MYPGM)
//   elements  … ELEM の要素リスト。例: POSITION(*AFTER REFLIB)
// 未指定時は既存定義との互換のため qualified として扱う。
export type GroupKind = "qualified" | "elements";

// 依存関係の判定条件。equalsAny / notEqualsAny の双方を指定した場合は AND。
export interface ParameterCondition {
  readonly parameter: string;
  readonly equalsAny?: readonly string[];
  readonly notEqualsAny?: readonly string[];
}

/**
 * 「他パラメータの値に応じて表示/必須/入力可否/選択肢が変わる」を宣言的に表す。
 *
 * 条件の書き方は2通り（どちらか一方を使う）:
 *   - 単一条件: parameter ＋ equalsAny / notEqualsAny
 *   - 複数条件の AND: all: [{parameter, equalsAny}, ...]
 *
 * effect:
 *   visible       … 条件成立時のみ表示
 *   required      … 条件成立時のみ必須
 *   disabled      … 条件成立時は入力不可（相関チェックの「入力できない」側）
 *   allowedValues … 条件成立時は allowedValues の値だけ入力可（選択肢の絞り込み）
 */
export interface ParameterDependency extends Partial<ParameterCondition> {
  readonly all?: readonly ParameterCondition[];
  readonly effect: "visible" | "required" | "disabled" | "allowedValues";
  readonly allowedValues?: readonly string[];
}

/**
 * コマンド単位の相関制約。単一パラメータに属さないため定義のトップに置く。
 *   exclusive … 列挙したうち同時に指定できるのは1つまで（排他）
 *   together  … いずれかを指定するなら全て指定しなければならない（相互必須）
 */
export interface CommandConstraint {
  readonly kind: "exclusive" | "together";
  readonly parameters: readonly string[];
  readonly note?: string;
}

export interface CommandExample {
  readonly code: string;
  readonly note?: string;
}

export interface CommandMessage {
  readonly id: string;
  readonly text: string;
}

// 定義の出典（IBM Documentation の原典）。再生成・検証時の追跡に使う。
export interface OriginReference {
  readonly url?: string;
  readonly version?: string;
  readonly updated?: string;
}

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
  // CL の定位置指定 (定位置 N)。原典のパラメータ表「ノーツ」欄に対応。
  readonly positional?: number;
  /**
   * 実機の F4 基本プロンプトに現れるパラメータか。
   * false/未設定は「F10 追加パラメータ」側。
   * この情報は原典(IBM i 7.4 ドキュメント)には無く、実機(pub400 / 7.5)の
   * F4・F10 実測から取り込んでいる（docs/origin/cl-prompt-groups.json）。
   */
  readonly basic?: boolean;
  // group のときの連結方式。既定は qualified。
  readonly groupKind?: GroupKind;
  // group が単一値としても指定できる場合の、その単一値の一覧。
  // 例: ADDLIBLE POSITION は *FIRST/*LAST を単一値として取り、
  //     *AFTER/*BEFORE/*REPLACE のときのみ参照ライブラリーを伴う要素リストになる。
  readonly singleValues?: readonly string[];

  /**
   * 値そのものが CL コマンドであるパラメータ（SBMJOB の CMD、IF の THEN など）。
   * SEU ではこの欄でさらに F4 が押せる。原典のパラメータ表で選択項目が
   * 「コマンド・ストリング」/「Command string」と書かれているものが該当する。
   */
  readonly valueKind?: "command";
  readonly dependsOn?: readonly ParameterDependency[];
}

export interface PrompterDefinition {
  readonly keyword: string;
  readonly description: string;
  readonly help?: string;
  readonly parameters: ParameterDefinition[];
  // 以下は原典（IBM Documentation）由来のコマンド単位メタ情報。
  readonly threadSafe?: boolean;
  readonly environment?: string;
  readonly examples?: readonly CommandExample[];
  readonly errorMessages?: readonly CommandMessage[];
  readonly source?: OriginReference;
  // 原典の「制約事項」節。
  readonly restrictions?: readonly string[];
  readonly constraints?: readonly CommandConstraint[];
}
