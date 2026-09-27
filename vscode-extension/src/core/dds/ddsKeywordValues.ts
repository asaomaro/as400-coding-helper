/**
 * キーワードの**値を選んで書く**（`COLOR(RED)` / `DSPATR(HI RI)` をドロップダウン・チェックボックスで。
 * 2026-09-27 利用者の依頼）。**vscode を import しない**（WebView にも束ねる）。
 *
 * 値の一覧（スロット）は原典から生成したもの（`docs/origin/generate-dds-keyword-values.mjs` →
 * `dds-keywords*.json` の `values`）。ここは「今の引数をスロットに読む」と「選んだ値から引数を書く」だけ。
 */

export interface KeywordValueChoice {
  readonly value: string;
  readonly label?: string;
}

/** 引数の 1 つの位置。 */
export interface KeywordValueSlot {
  /** 複数並べられる（チェックボックス）。 */
  readonly multiple?: boolean;
  /** 省ける。 */
  readonly optional?: boolean;
  /** 一覧に無い値も書ける（`CLRL(nn)` の行数、`DATSEP('/')` の区切り記号、`COMP` の比較する値）。 */
  readonly other?: boolean;
  readonly choices: readonly KeywordValueChoice[];
}

/** 引数を区切る（引用符の中の空白では切らない。`''` は引用符の中のエスケープ）。 */
function tokens(parameters: string): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < parameters.length; index += 1) {
    const character = parameters[index];
    if (character === "'") {
      if (quoted && parameters[index + 1] === "'") {
        current += "''";
        index += 1;
        continue;
      }
      quoted = !quoted;
      current += character;
      continue;
    }
    if (!quoted && /\s/u.test(character)) {
      if (current.length > 0) result.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current.length > 0) result.push(current);
  return result;
}

const matches = (slot: KeywordValueSlot, token: string): boolean =>
  slot.choices.some(choice => choice.value.toUpperCase() === token.toUpperCase());

/**
 * 今の引数を、スロットごとに選ばれている値へ読む。**読み切れなければ undefined**
 * （条件つきの形・P フィールド・並びの違うものなど。そのときは選ばせず、生テキストで直してもらう）。
 *
 * 値は一覧の綴り（大文字）にそろえる。一覧に無い値（`other`）は書かれたまま。
 */
export function readKeywordValues(
  slots: readonly KeywordValueSlot[],
  parameters: string | undefined
): string[][] | undefined {
  const rest = tokens(parameters ?? "");
  const selections: string[][] = [];
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const next = slots[index + 1];
    const taken: string[] = [];
    if (slot.multiple) {
      while (rest.length > 0 && matches(slot, rest[0])) taken.push(canonical(slot, rest.shift()!));
    } else if (rest.length > 0 && matches(slot, rest[0])) {
      taken.push(canonical(slot, rest.shift()!));
    } else if (rest.length > 0 && slot.other && !(next !== undefined && matches(next, rest[0]))) {
      taken.push(rest.shift()!);
    }
    if (taken.length === 0 && !slot.optional && rest.length > 0) return undefined;
    selections.push(taken);
  }
  return rest.length > 0 ? undefined : selections;
}

function canonical(slot: KeywordValueSlot, token: string): string {
  return slot.choices.find(choice => choice.value.toUpperCase() === token.toUpperCase())?.value ?? token;
}

/**
 * 選んだ値からキーワードを書く。複数の値は**一覧の順**に並べる（チェックの順に依らない）。
 * 何も選ばれていなければ名前だけ（括弧ごと省けるキーワードのとき）。
 */
export function buildKeywordWithValues(
  name: string,
  slots: readonly KeywordValueSlot[],
  selections: readonly (readonly string[])[]
): string {
  const parts = slots.map((slot, index) => {
    const selected = (selections[index] ?? []).map(value => value.trim()).filter(value => value.length > 0);
    if (!slot.multiple) return selected[0] ?? "";
    const order = slot.choices.map(choice => choice.value);
    return [...selected]
      .sort((a, b) => rank(order, a) - rank(order, b))
      .join(" ");
  }).filter(part => part.length > 0);
  return parts.length === 0 ? name : `${name}(${parts.join(" ")})`;
}

function rank(order: readonly string[], value: string): number {
  const at = order.indexOf(value);
  return at < 0 ? order.length : at;
}

/** 選び終わっているか（省けない位置が空なら、まだ書けない。`COLOR()` は実機が通さない: CPD7512）。 */
export function missingKeywordValue(
  slots: readonly KeywordValueSlot[],
  selections: readonly (readonly string[])[]
): number | undefined {
  const at = slots.findIndex((slot, index) => !slot.optional && (selections[index] ?? []).every(value => value.trim().length === 0));
  return at < 0 ? undefined : at;
}
