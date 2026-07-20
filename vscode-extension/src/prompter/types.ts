/**
 * プロンプターが扱う対象。
 * "cmd" は .cmd ソースに書くコマンド定義ステートメント（CMD/PARM/ELEM/QUAL/DEP/PMTCTL）。
 * CL コマンドではないが、構文は同じなので解析と書き戻しは CL と同じ経路を通る。
 */
export type LanguageId = "rpg-fixed" | "cl" | "cmd" | "dds";

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

/* ------------------------------------------------------------------ *
 * CDML(コマンド定義 XML) 由来の相関規則
 *
 * 実機の *CMD から QCDRCMDD API で取れる DEP(相関チェック) / PMTCTL(条件表示)
 * を写したもの。**独自の抽象に翻訳せず CDML の構造をそのまま持つ**。
 *
 * 理由: 散文の原典から起こした dependsOn / constraints では表せない形が実データに
 * ある。「指定されたか(SPCFD)」を条件に使う・「成立した条件がちょうど N 個」を
 * 数える・グループを AND/OR で連ねる、の 3 つ。翻訳しようとすると必ず落ちる。
 * 競合(bobcozzi/clPrompter)も CDML を 1:1 で持つ設計を採っている。
 *
 * 演算子の集合は実機の DTD(/QIBM/XML/DTD/QcdCLCmd.dtd) が正。実データに出て
 * こない値(UNSPCFD 等)も DTD にある限り残し、逸脱は検査で見張る。
 * ------------------------------------------------------------------ */

/** 値の比較演算子。DTD の共通部分。 */
export type CdmlRelation = "EQ" | "NE" | "GT" | "GE" | "LT" | "LE";

/** 成立した条件の個数に対する演算子。ALL は「全て成立」。 */
export type CdmlCountRelation = CdmlRelation | "ALL";

/** <Dep CtlKwdRel>。SPCFD は「指定された」、ALWAYS は「無条件に適用」。 */
export type CdmlDepControlRelation = CdmlRelation | "SPCFD" | "ALWAYS";

/** <DepParm Rel>。 */
export type CdmlDepTermRelation = CdmlRelation | "SPCFD";

/** <PmtCtlCond Rel>。UNSPCFD は「指定されていない」。 */
export type CdmlPromptControlRelation = CdmlRelation | "SPCFD" | "UNSPCFD";

/** <DepParm> — 相関チェックで数え上げる個々の条件。 */
export interface CommandDependencyTerm {
  readonly parameter: string;
  readonly relation: CdmlDepTermRelation;
  // 比較先。定数(内部値)と他パラメータのどちらか。SPCFD ではどちらも無い。
  readonly compareValue?: string;
  readonly compareParameter?: string;
}

/**
 * <Dep> — コマンド単位の相関チェック。
 *
 * 意味: 制御条件(controlParameter/controlRelation)が成立するとき、
 * terms のうち成立している個数が `count countRelation` を満たさなければ
 * ならない。満たさなければ messageId のエラーになる。
 *
 * 例: SNDPGMMSG の「MSGID を指定したら MSGF が必須」
 *   { controlRelation: "SPCFD", controlParameter: "MSGID",
 *     countRelation: "EQ", count: 1, messageId: "CPD2441",
 *     terms: [{ parameter: "MSGF", relation: "SPCFD" }] }
 */
export interface CommandDependency {
  readonly controlRelation: CdmlDepControlRelation;
  // ALWAYS のときは無い。
  readonly controlParameter?: string;
  readonly controlCompareValue?: string;
  readonly controlCompareParameter?: string;
  readonly countRelation: CdmlCountRelation;
  readonly count?: number;
  // 違反時に実機が出すメッセージ ID（CPD2441 など）。
  readonly messageId?: string;
  // 利用者に見せる文。未設定なら messageId をそのまま出す。
  readonly message?: string;
  readonly terms: readonly CommandDependencyTerm[];
}

/** <PmtCtlCond> — 条件表示の個々の条件。制御パラメータの値と比較する。 */
export interface PromptControlCondition {
  readonly relation: CdmlPromptControlRelation;
  readonly compareValue?: string;
}

/**
 * <PmtCtl> — 「他パラメータの値に応じて、この欄を表示するか」の 1 グループ。
 *
 * 意味: conditions のうち成立している個数が `count countRelation` を満たせば
 * このグループは真。複数グループは logicalRelation で**左から順に**連ねる
 * （先頭のグループには logicalRelation が無い）。
 *
 * 例: SAVOBJ の「DEV(*SAVF) のときだけ SAVF 欄を表示」
 *   { controlParameter: "DEV", countRelation: "EQ", count: 1,
 *     conditions: [{ relation: "EQ", compareValue: "*SAVF" }] }
 */
export interface PromptControlGroup {
  readonly controlParameter: string;
  readonly countRelation: CdmlCountRelation;
  readonly count?: number;
  readonly logicalRelation?: "AND" | "OR";
  readonly conditions: readonly PromptControlCondition[];
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
  /**
   * 列挙した値以外を書けないか（CDML の `Rstd`）。
   *
   * **false のとき options は「候補」であって制限ではない。** 原典の定義済み値だけを
   * options に持つと、実機が受け付ける値を弾いてしまう（`ADDPFM` の SRCTYPE は
   * `*NONE` しか選べず `RPGLE` が入力できなかった。実機は Rstd=NO で任意の
   * ソース・タイプを受ける）。実測で 86 欄がこの状態だった。
   *
   * 未設定のときは従来どおり options を制限として扱う（CDML を採っていない
   * RPG / DDS の定義があるため、既定の挙動は変えない）。
   */
  readonly restricted?: boolean;
  readonly characterSet?: "alpha" | "alnum" | "upper" | "any";
  readonly numericOnly?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  /**
   * 数値の下限・上限（CDML の `RangeMinVal` / `RangeMaxVal`）。
   * 定義済み値(`*SAME` など)は範囲の対象外。
   */
  readonly minValue?: number;
  readonly maxValue?: number;
  /**
   * CL 変数(&NAME)を書けるか（CDML の `AlwVar`）。
   * 既定は「書ける」。実機の 2500 欄のうち 26 欄だけが NO。
   */
  readonly allowsVariable?: boolean;
  /**
   * 値そのものへの制約（CDML の `Rel` / `RelVal`）。範囲とは別に
   * 「0 以外」「1 以上」のような条件が付く欄がある。
   */
  readonly valueRelation?: {
    readonly relation: "EQ" | "NE" | "GT" | "GE" | "LT" | "LE";
    readonly value: string;
  };
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
  /**
   * CDML の PMTCTL 由来の条件表示規則。dependsOn の effect:"visible" と併用でき、
   * 両方あるときは AND（どちらの条件も満たしたときだけ表示）。
   */
  readonly promptControl?: readonly PromptControlGroup[];
  /**
   * 書く値 → 内部値の対応（CDML `<Value Val MapTo>` が食い違うものだけ）。
   *
   * DEP / PMTCTL の CmpVal は**内部値**と比較する（`*CHAR` に対し `C` など）。
   * 変換せずに比較すると規則が黙って成立しない。
   *
   * options ではなくパラメータに持たせているのは、対象の 7 割強が
   * `inputType:"text"` で options を持たない欄だから（`ADDMSGD` の TYPE など）。
   * options 側にも同じ対応を置くと二重管理になるため、ここ 1 箇所に集約する。
   */
  readonly valueMap?: Readonly<Record<string, string>>;
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
  /**
   * CDML の DEP 由来の相関チェック。散文から起こした constraints と併存する
   * （constraints は「排他/相互必須」の 2 種類しか表せないため置き換えではない）。
   */
  readonly dependencies?: readonly CommandDependency[];
}
