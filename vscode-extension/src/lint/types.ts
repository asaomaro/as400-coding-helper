import type { Dialect, PrompterDefinition } from "../prompter/types";
import type { DdsType } from "../core/sourceKind";

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
  | "restricted-value"
  // --- レイアウト（ファイル全体を解決してから出る診断）---
  //
  // 既定 ON にしてよいのは「**実機で作成できないソースでしか出ない**」と
  // 原典で言い切れるものだけ。実測が 0 件でも十分条件にはならない
  // （リポジトリ内の DSPF / PRTF は 2 本しか無く、母数として薄い）。
  /** 既定 ON。位置欄が数字でない。実機で作成できない。 */
  | "layout-invalid-position"
  /**
   * 既定 ON。1 桁目に項目を置いた。原典（表示装置ファイルの `桁数 (30 - 34 桁目)`）:
   * > フィールドは、表示画面の最初の桁を占めることはできません。
   * > 最初の桁は属性文字のために予約されています。
   */
  | "layout-column-one-reserved"
  /** 既定 ON。DSPSIZ の書式・値が不正。原典の有効値は 24x80 と 27x132 だけ。 */
  | "layout-invalid-screen-size"
  /** 既定 ON。行番号のある様式で SPACE/SKIP。実機で CPD7860（docs/src/CHECKLIST.md に実例）。 */
  | "layout-spacing-with-line-number"
  /**
   * 既定 OFF。画面／紙面をはみ出す。
   * **有効なソースでも出る**ため。原典（表示装置ファイルの `DSPSIZ` 例 1）:
   * > FIELDB は 80 桁目を超えており…拡張ソース印刷出力で *NOLOC の位置を
   * > この 2 つのフィールドに割り当てます。
   * はみ出した項目は *NOLOC になるだけで、ファイルは作成される。
   */
  | "layout-overflow"
  /**
   * 既定 OFF。項目の重なり。
   * **有効なソースでも出る**ため。原典（表示装置ファイルの `位置 (39 - 44 桁目)`）:
   * > 1 つのレコード様式内で、フィールドを他のフィールドまたは属性文字と
   * > オーバーラップ（重複）するように定義することができます。
   */
  | "layout-overlap";

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

/**
 * ファイル全体を見る規則の文脈。
 *
 * 行単位の `Rule` と別立てにしているのは、レイアウトの診断が
 * **ファイルを解決し切ってからでないと出ない**ため（項目の重なりや
 * 画面サイズは 1 行だけでは決まらない）。
 */
export interface FileRuleContext {
  /** 種別の判定に使う。読み込みはしない。 */
  readonly fsPath: string;
  readonly lines: readonly string[];
  /** DDS の種別。レイアウト規則はこれで振り分ける（PF/LF には回さない）。 */
  readonly ddsType?: DdsType;
}

export type FileRule = (context: FileRuleContext) => readonly LintFinding[];
