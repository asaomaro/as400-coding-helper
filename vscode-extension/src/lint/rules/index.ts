import type { FileRule, Rule, RuleId, Severity } from "../types";
import { layoutRule } from "./layout";
import { lineLengthRule } from "./lineLength";
import { numericAlignmentRule, numericFieldRule } from "./numericField";
import { requiredFieldRule } from "./requiredField";
import { restrictedValueRule } from "./restrictedValue";

/**
 * 規則の一覧と既定の有効／無効。
 *
 * 既定 ON にしてよいのは「原典で裏が取れ、実機コンパイル確認済みのソースに
 * 当てて偽陽性が 0 件だったもの」だけ。4 規則をそのまま当てると検証済みの
 * ソースに 30 件の指摘が出ることを実測してある（research.md）。
 */

interface RuleSpecBase {
  readonly id: RuleId;
  readonly enabledByDefault: boolean;
  readonly severity: Severity;
  /** SARIF の規則説明に出す一文。 */
  readonly description: string;
}

/**
 * 規則には 2 種類ある。
 *
 * - `line`: 1 行ずつ見る（既存の 5 規則）。
 * - `file`: ファイル全体を解決してから見る（レイアウト）。項目の重なりや
 *   画面サイズは 1 行だけでは決まらないため、行単位では書けない。
 */
export type RuleSpec =
  | (RuleSpecBase & {
      readonly kind: "line";
      readonly rule: Rule;
      /**
       * 定位置の欄を見る規則か。
       *
       * false の規則（行長など）は**行の種類を問わず適用する**。注記行や継続記入行、
       * 種別が決まらない行でも桁あふれは起こるため。true の規則は欄が存在する行
       * （前処理が "checked" と判定した行）でだけ回す。
       */
      readonly positional: boolean;
    })
  | (RuleSpecBase & {
      readonly kind: "file";
      readonly rule: FileRule;
    });

/**
 * レイアウトの規則表。
 *
 * **`severity` をここ 1 か所にしか書かない**。`RuleSpec.severity` は SARIF の
 * `defaultConfiguration.level` に、`LintFinding.severity` は結果の `level` になり、
 * 別経路で使われる。2 か所に書くと、片方だけ変えても型は通りテストも落ちないまま
 * 「宣言は warning なのに結果は error」という状態になる。
 *
 * 既定 ON にしてよいのは「実機で作成できないソースでしか出ない」と原典で
 * 言い切れるものだけ（根拠は types.ts の RuleId に引用つきで書いてある）。
 */
const LAYOUT_RULES = [
  {
    code: "invalid-position",
    id: "layout-invalid-position",
    severity: "error",
    enabledByDefault: true,
    description: "位置欄（39-44 桁）に数字以外が入っていないか。実機では作成できない。"
  },
  {
    code: "column-one-reserved",
    id: "layout-column-one-reserved",
    severity: "error",
    enabledByDefault: true,
    description:
      "表示装置ファイルで 1 桁目に項目を置いていないか。" +
      "原典「最初の桁は属性文字のために予約されています」。"
  },
  {
    code: "invalid-screen-size",
    id: "layout-invalid-screen-size",
    severity: "error",
    enabledByDefault: true,
    description: "DSPSIZ の書式・値が正しいか。原典の有効値は 24x80 と 27x132 だけ。"
  },
  {
    code: "spacing-with-line-number",
    id: "layout-spacing-with-line-number",
    severity: "error",
    enabledByDefault: true,
    description:
      "印刷装置ファイルで、行番号のある項目に SPACE/SKIP を使っていないか（実機では CPD7860）。"
  },
  {
    code: "overflow",
    id: "layout-overflow",
    severity: "warning",
    enabledByDefault: false,
    description:
      "項目が画面／紙面をはみ出していないか。**既定で無効**。" +
      "原典によりはみ出した項目は *NOLOC になるだけでファイルは作成されるため、" +
      "有効なソースでも出る。"
  },
  {
    code: "overlap",
    id: "layout-overlap",
    severity: "warning",
    enabledByDefault: false,
    description:
      "項目が重なっていないか。**既定で無効**。" +
      "原典が「オーバーラップするように定義することができます」と認めており、" +
      "有効なソースでも出る。"
  }
] as const satisfies readonly {
  readonly code: string;
  readonly id: RuleId;
  readonly severity: Severity;
  readonly enabledByDefault: boolean;
  readonly description: string;
}[];

export const RULE_SPECS: readonly RuleSpec[] = [
  {
    kind: "line",
    id: "line-length",
    rule: lineLengthRule,
    enabledByDefault: true,
    severity: "error",
    description:
      "行が 100 桁を超えていないか。81-100 桁は原典が注記域と規定しているため、" +
      "80 桁超過は指摘しない。",
    positional: false
  },
  {
    kind: "line",
    id: "numeric-field",
    rule: numericFieldRule,
    enabledByDefault: true,
    severity: "error",
    description:
      "右寄せ必須の数値欄に数字以外が入っていないか（実機では CPF7311）。",
    positional: true
  },
  {
    kind: "line",
    id: "numeric-alignment",
    rule: numericAlignmentRule,
    enabledByDefault: true,
    severity: "warning",
    description: "数値欄が右寄せで書かれているか。",
    positional: true
  },
  {
    kind: "line",
    id: "required-field",
    rule: requiredFieldRule,
    enabledByDefault: false,
    severity: "error",
    description:
      "必須欄が空でないか。**既定で無効**。DDS は定義の required が生成時に " +
      "false 固定で材料が無く、RPG は継続記入行やオペランドを取らない命令で " +
      "偽陽性が出る（実測 64 件）。",
    positional: true
  },
  {
    kind: "line",
    id: "restricted-value",
    rule: restrictedValueRule,
    enabledByDefault: false,
    severity: "error",
    description:
      "定義済み値以外が入っていないか。**既定で無効**。値集合が原典の注記を " +
      "取りこぼしており（DBCS のデータ・タイプ）、原典自体も実機より狭い箇所がある。",
    positional: true
  },
  // --- レイアウト（ファイル単位）---
  ...LAYOUT_RULES.map(
    (entry): RuleSpec => ({
      kind: "file",
      id: entry.id,
      // severity は表の 1 か所だけ。ここで両方に配るので食い違いようがない。
      rule: layoutRule(entry.code, entry.id, entry.severity),
      enabledByDefault: entry.enabledByDefault,
      severity: entry.severity,
      description: entry.description
    })
  )
];

export function defaultEnabledRules(): RuleId[] {
  return RULE_SPECS.filter(spec => spec.enabledByDefault).map(spec => spec.id);
}
