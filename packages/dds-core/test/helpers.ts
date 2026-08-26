/**
 * テスト用のヘルパ。
 *
 * ファイル名が `*.test.ts` ではないので、テストランナーの走査対象にならない
 * （`scripts/run-node-tests.mjs` は `*.test.js` だけを集める）。
 */

/** DDS の 1 行を桁どおりに組み立てる。 */
export function ln(spec: {
  rec?: string;
  name?: string;
  len?: number;
  type?: string;
  dec?: number;
  usage?: string;
  row?: number;
  col?: number;
  func?: string;
}): string {
  const cells = new Array<string>(80).fill(" ");
  const put = (start: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      cells[start - 1 + i] = text[i];
    }
  };
  put(6, "A");
  if (spec.rec !== undefined) {
    put(17, "R");
    put(19, spec.rec);
  }
  if (spec.name !== undefined) put(19, spec.name);
  if (spec.len !== undefined) put(30, String(spec.len).padStart(5));
  if (spec.type !== undefined) put(35, spec.type);
  if (spec.dec !== undefined) put(36, String(spec.dec).padStart(2));
  if (spec.usage !== undefined) put(38, spec.usage);
  if (spec.row !== undefined) put(39, String(spec.row).padStart(3));
  if (spec.col !== undefined) put(42, String(spec.col).padStart(3));
  if (spec.func !== undefined) put(45, spec.func);
  return cells.join("").trimEnd();
}

/** 行を組み立てて 1 本の DDS テキストにする。 */
export function dds(...lines: string[]): string {
  return [...lines, ""].join("\n");
}
