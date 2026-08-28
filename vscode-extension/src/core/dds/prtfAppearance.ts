import appearanceData from "../../../resources/completion/dds-print-appearance.json";
import { parseKeywordEntries } from "./ddsKeywords";
import { activeKeywordGroups, type KeywordGroup } from "./ddsConditioning";
import type { IndicatorStates } from "./ddsConditioning";

/**
 * 帳票（PRTF）での**見え方**。画面（DSPF）の `ScreenAppearance` とは別物。
 *
 * ## なぜ分けるか
 *
 * 帳票に `DSPATR` は無く、実機は書くと**コンパイルを通さない**（IBM i 7.3 で確認。
 * `.aidev/works/20260828-dds-prtf-emphasis/verify/probe-prtf-appearance.mjs`）。
 * `COLOR` はどちらにもあるが**名前の集合が違う**——帳票には `BLK` / `BRN` があり
 * `WHT` が無い（実機で `COLOR(WHT)` は通らない）。画面の表を当てると
 * 帳票にしかない色が読めず、帳票に無い色を読めてしまう。
 *
 * ## 表は原典から生成する
 *
 * `resources/completion/dds-print-appearance.json`
 * （`docs/origin/generate-dds-print-appearance.mjs` / `verify-dds-print-appearance.mjs`）。
 * 検査は原典との一致だけでなく、**実機で確かめた 8 件**とも突き合わせる。
 */
export interface PrintAppearance {
  /** 太字（`HIGHLIGHT`）。 */
  readonly bold: boolean;
  /** 下線（`UNDERLINE`）。 */
  readonly underline: boolean;
  /**
   * カラー名（原典の 8 つ）。指定が無ければ既定の `BLK`（原典: 黒）。
   */
  readonly color: string;
  /**
   * 名前**以外**の形（`*RGB` / `*CMYK` / `*CIELAB` / `*HIGHLIGHT`）で
   * 指定されている。
   *
   * **色は決めない。** 原典自身が「他の値は、黒と白の中間のカラーになります
   * (出力装置によって異なります)」「ハイライト・カラーは装置に依存します」と
   * 書いており、決め打ちすると実機と違う絵になる。指定があることだけを伝える。
   */
  readonly deviceColor: boolean;
}

const COLOR_NAMES: ReadonlySet<string> = new Set(
  appearanceData.color.names.map(entry => entry.name.toUpperCase())
);
const COLOR_LABELS: ReadonlyMap<string, string> = new Map(
  appearanceData.color.names.map(entry => [entry.name.toUpperCase(), entry.label])
);
const DEVICE_FORMS: readonly string[] = appearanceData.color.deviceForms.map(form =>
  form.toUpperCase()
);
const DEFAULT_COLOR = appearanceData.color.default.toUpperCase();

export const DEFAULT_PRINT_APPEARANCE: PrintAppearance = {
  bold: false,
  underline: false,
  color: DEFAULT_COLOR,
  deviceColor: false
};

/** カラー名の和名（原典の表）。知らない名前なら undefined。 */
export function printColorLabel(color: string): string | undefined {
  return COLOR_LABELS.get(color.toUpperCase());
}

/** 帳票で使えるカラー名の一覧（原典の順）。 */
export function printColorNames(): readonly string[] {
  return appearanceData.color.names.map(entry => entry.name.toUpperCase());
}

/**
 * キーワード欄から帳票の見え方を求める。
 *
 * `recordKeywords` は様式のキーワード欄。**`HIGHLIGHT` は様式に書くと
 * その中の全項目に効く**（原典）ので、項目だけを見ると太字を取りこぼす。
 * 原典は「どちらか一方の標識条件が満たされていれば」効くとしており、
 * ここでは**両方を OR で足す**。
 */
export function resolvePrintAppearance(
  keywords: string,
  recordKeywords = ""
): PrintAppearance {
  const own = scan(keywords);
  const record = scan(recordKeywords);
  return {
    // 様式の HIGHLIGHT は全項目に効く（原典）。UNDERLINE / COLOR は項目レベルだけ
    // なので、様式側は見ない（実機も様式に書くと通さない）。
    bold: own.bold || record.bold,
    underline: own.underline,
    color: own.color,
    deviceColor: own.deviceColor
  };
}

/** 標識の状態を踏まえて解く（条件つきのキーワードを倒せるように）。 */
export function resolvePrintAppearanceUnder(
  groups: readonly KeywordGroup[],
  states: IndicatorStates,
  recordGroups: readonly KeywordGroup[] = []
): PrintAppearance {
  const flatten = (list: readonly KeywordGroup[]): string =>
    activeKeywordGroups(list, states)
      .map(group => group.keywords)
      .join(" ")
      .trim();
  return resolvePrintAppearance(flatten(groups), flatten(recordGroups));
}

function scan(keywords: string): PrintAppearance {
  let bold = false;
  let underline = false;
  let color = DEFAULT_COLOR;
  let deviceColor = false;
  let colorSeen = false;

  for (const entry of parseKeywordEntries(keywords)) {
    if (entry.kind !== "keyword") continue;
    const name = entry.name.toUpperCase();
    if (name === "HIGHLIGHT") {
      bold = true;
      continue;
    }
    if (name === "UNDERLINE") {
      underline = true;
      continue;
    }
    if (name !== "COLOR") continue;

    // **最初の COLOR が効く**（画面の COLOR と同じ原典の書き方）。
    if (colorSeen) continue;
    colorSeen = true;

    const inner = /\(([^)]*)\)/u.exec(entry.raw)?.[1]?.trim() ?? "";
    const first = inner.split(/\s+/u)[0]?.toUpperCase() ?? "";
    if (DEVICE_FORMS.includes(first)) {
      deviceColor = true;
      continue;
    }
    if (COLOR_NAMES.has(first)) color = first;
  }

  return { bold, underline, color, deviceColor };
}
