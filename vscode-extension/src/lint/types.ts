import type { Dialect, PrompterDefinition } from "../prompter/types";

/**
 * lint core が扱う型。vscode にも実機にも依存しない。
 *
 * 規則の既定 ON/OFF は「原典で裏が取れ、実機コンパイル確認済みのソースで
 * 偽陽性が出ないこと」を基準に決めている（research.md の実測）。
 */

export type RuleId =
  /** 既定 ON。100 桁超過。81-100 桁は原典が注記域と規定するので 80 桁超は見ない。 */
  | "line-length"
  /** 既定 ON。数値欄（右寄せ必須の欄）に数字以外。 */
  | "numeric-field"
  /** 既定 ON（warning）。数値欄が右寄せでない。 */
  | "numeric-alignment"
  /**
   * 既定 OFF。必須欄の未入力。
   * DDS 側は定義の `required` が生成時にハードコードで false のため材料が無く、
   * RPG 側は継続記入行とオペランドを取らない命令で偽陽性が出る（research F2）。
   */
  | "required-field"
  /**
   * 既定 OFF。定義済み値以外。
   * 値集合が原典の注記を取りこぼしており（DBCS のデータ・タイプなど）、
   * 原典自体も実機より狭い箇所がある（research F1）。
   */
  | "restricted-value";

export type Severity = "error" | "warning";

export interface LintFinding {
  readonly ruleId: RuleId;
  readonly severity: Severity;
  readonly message: string;
  /** 1 始まり。 */
  readonly line: number;
  /** 1 始まりの桁。 */
  readonly startColumn: number;
  /** 1 始まりの桁。終端を含まない。 */
  readonly endColumn: number;
  /** 例 "D-SPEC" / "DDS-PF"。 */
  readonly specKeyword?: string;
  /** 例 "LEN" / "C30"。 */
  readonly parameterName?: string;
}

export interface LintOptions {
  /** 未指定なら既定 ON の規則。 */
  readonly enabledRules?: readonly RuleId[];
  /** 拡張子→方言の上書き（VSCode 設定と同じ形）。 */
  readonly dialectOverrides?: Record<string, unknown>;
  /** C 仕様の新形式オペコード集合。未指定なら既定集合。 */
  readonly cNewOpcodes?: ReadonlySet<string>;
}

/** 規則に渡す 1 行分の文脈。**行の分類は渡さない**（規則側で再判定させないため）。 */
export interface RuleContext {
  readonly line: string;
  /** 1 始まり。 */
  readonly lineNumber: number;
  /** その行に対応する定義。種別が決まらなければ undefined。 */
  readonly definition?: PrompterDefinition;
  readonly specKeyword?: string;
  readonly dialect?: Dialect;
}

export type Rule = (context: RuleContext) => readonly LintFinding[];
