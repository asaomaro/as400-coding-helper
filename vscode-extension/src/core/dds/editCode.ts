import editCodeData from "../../../resources/completion/dds-editcodes.json";

/**
 * `EDTCDE`（編集コード）による**印刷桁数**を求める。
 *
 * 属性の表は原典から生成したもの（`docs/origin/generate-dds-editcodes.mjs`）で、
 * ここが持つのは**属性から幅を導く式**だけ。表を手で持たない（AGENTS.md）。
 *
 * このモジュールは **vscode を import しない**。
 *
 * ■ 幅だけを出す
 *   実際に印刷される文字列（コンマの挿入位置・`CR` の付加）までは作らない。
 *   帳票プレビューは箱を描ければよく、中身の桁揃えまでは要らない。
 *
 * ■ ユーザー定義の編集コード 5-9 は解決できない
 *   実機の `*EDTD` オブジェクトなので、ソースからは桁数が決まらない。
 */

export interface EditCodeAttributes {
  /** 3 桁ごとの区切り（コンマ）を入れるか。 */
  readonly commas: boolean;
  /** 小数点を印刷するか。 */
  readonly decimalPoint: boolean;
  /** 負数のときの符号。`CR` は 2 桁、`minus` は 1 桁を占める。 */
  readonly negativeSign: "none" | "CR" | "minus";
  /** ゼロ残高の印刷。`blank` はゼロのとき全桁ブランク。 */
  readonly zeroBalance: "zero" | "blank";
  readonly suppressLeadingZero: boolean;
}

export type EditedWidth =
  | { readonly kind: "width"; readonly width: number }
  | {
      readonly kind: "unknown";
      readonly reason: "user-defined" | "not-numeric" | "unknown-code";
    };

interface EditCodeFile {
  readonly declaredCodes: readonly string[];
  readonly userDefinedCodes: readonly string[];
  readonly editCodes: Readonly<Record<string, EditCodeAttributes>>;
}

const data = editCodeData as unknown as EditCodeFile;

/** 原典が宣言している編集コード（`1`-`4` / `A`-`D` / `J`-`Q` / `W`-`Z`）。 */
export const DECLARED_EDIT_CODES: readonly string[] = data.declaredCodes;

/** ユーザー定義（実機の `*EDTD`）。オフラインでは解決できない。 */
export const USER_DEFINED_EDIT_CODES: readonly string[] = data.userDefinedCodes;

export function editCodeAttributes(code: string): EditCodeAttributes | undefined {
  return data.editCodes[code.trim().toUpperCase()];
}

/**
 * 編集後の印刷桁数。
 *
 * @param length   長さ欄（30-34 桁）の値。数字の総桁数。
 * @param decimals 小数点以下の桁数（36-37 桁）。
 * @param code     編集コード 1 文字。
 * @param option   `*`（アスタリスク充てん）または浮動通貨記号。
 * @param dataType データ・タイプ（35 桁目）。`S` かブランク以外には効かない。
 */
export function editedWidth(
  length: number,
  decimals: number,
  code: string,
  option?: string,
  dataType?: string
): EditedWidth {
  const normalized = code.trim().toUpperCase();

  // 原典: EDTCDE は 35 桁目に S またはブランクが入っているフィールドにのみ有効。
  const type = (dataType ?? "").trim().toUpperCase();
  if (type !== "" && type !== "S") {
    return { kind: "unknown", reason: "not-numeric" };
  }

  if (USER_DEFINED_EDIT_CODES.includes(normalized)) {
    return { kind: "unknown", reason: "user-defined" };
  }

  const attributes = editCodeAttributes(normalized);
  if (!attributes) {
    return { kind: "unknown", reason: "unknown-code" };
  }

  if (!Number.isFinite(length) || length <= 0) {
    return { kind: "unknown", reason: "unknown-code" };
  }

  const integerDigits = Math.max(0, length - Math.max(0, decimals));
  let width = length;

  // 3 桁ごとの区切り。整数部にだけ入る（1,234.56 の "," は 1 つ）。
  if (attributes.commas && integerDigits > 3) {
    width += Math.floor((integerDigits - 1) / 3);
  }

  // 小数点。小数部があるときだけ印字される。
  if (attributes.decimalPoint && decimals > 0) {
    width += 1;
  }

  // 負数の符号は右端に付く。CR は 2 桁、マイナスは 1 桁。
  if (attributes.negativeSign === "CR") {
    width += 2;
  } else if (attributes.negativeSign === "minus") {
    width += 1;
  }

  // アスタリスク充てん / 浮動通貨記号。原典では 1-4 / A-D / J-Q に指定できる。
  // 通貨記号は最初の有効数字の左に 1 桁入る。アスタリスク充てんは桁を増やさない
  // （抑制されたゼロの位置を * で埋めるだけ）。
  const trimmedOption = (option ?? "").trim();
  if (trimmedOption.length > 0 && trimmedOption !== "*") {
    width += 1;
  }

  return { kind: "width", width };
}
