import * as assert from "assert";
import {
  applyDdsEdits,
  validateDdsEdits,
  type DdsEdit
} from "../../src/core/dds/ddsEdit";

/**
 * 属性の編集。**守るのは「与えた欄だけが変わる」こと**。
 *
 * 定数のリテラルは**キーワード欄の先頭**にあり、後ろにキーワードが続きうる。
 * 欄ごと置き換えると**キーワードが消える**——リポジトリのサンプルに実例が無いので、
 * 手で試しても気付けない。ここで先に固定する。
 */

function ln(spec: {
  record?: string;
  name?: string;
  length?: number;
  dataType?: string;
  decimals?: number;
  usage?: string;
  row?: number;
  column?: number;
  keywords?: string;
}): string {
  const cells = new Array<string>(80).fill(" ");
  const put = (start: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) cells[start - 1 + index] = text[index];
  };
  put(6, "A");
  if (spec.record !== undefined) {
    put(17, "R");
    put(19, spec.record);
  }
  if (spec.name !== undefined) put(19, spec.name);
  if (spec.length !== undefined) put(30, String(spec.length).padStart(5));
  if (spec.dataType !== undefined) put(35, spec.dataType);
  if (spec.decimals !== undefined) put(36, String(spec.decimals).padStart(2));
  if (spec.usage !== undefined) put(38, spec.usage);
  if (spec.row !== undefined) put(39, String(spec.row).padStart(3));
  if (spec.column !== undefined) put(42, String(spec.column).padStart(3));
  if (spec.keywords !== undefined) put(45, spec.keywords);
  return cells.join("").trimEnd();
}

const SOURCE: readonly string[] = [
  ln({ record: "R1" }),
  ln({ name: "FLD1", length: 10, dataType: "A", usage: "B", row: 3, column: 20 }),
  // **定数の後ろにキーワードが続く**（実サンプルには無い形。ここで作る）
  ln({ row: 5, column: 2, keywords: "'見出し'DSPATR(HI)" }),
  ln({ name: "NUM1", length: 5, dataType: "S", decimals: 0, usage: "O", row: 7, column: 20 }),
  "     A* 注記行"
];

function applied(edits: readonly DdsEdit[]): string[] {
  const lines = [...SOURCE];
  for (const result of applyDdsEdits(SOURCE, edits)) {
    lines.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
  }
  return lines;
}

function changed(after: readonly string[]): number[] {
  const indexes: number[] = [];
  for (let index = 0; index < Math.max(after.length, SOURCE.length); index += 1) {
    if (after[index] !== SOURCE[index]) indexes.push(index);
  }
  return indexes;
}

suite("属性編集: 与えた欄だけが変わる", () => {
  test("名前を変えると 19-28 桁だけが変わる（大文字に正規化）", () => {
    const after = applied([
      { kind: "setAttributes", sourceLine: 2, attributes: { name: "newfld" } }
    ]);
    assert.strictEqual(after[1].slice(18, 28), "NEWFLD    ");
    assert.strictEqual(after[1].slice(28), SOURCE[1].slice(28), "29 桁目以降が変わった");
    assert.deepStrictEqual(changed(after), [1]);
  });

  test("型・小数桁・使用をまとめて変えられる", () => {
    const after = applied([
      {
        kind: "setAttributes",
        sourceLine: 4,
        attributes: { dataType: "Y", decimals: 2, usage: "B" }
      }
    ]);
    assert.strictEqual(after[3].slice(34, 35), "Y");
    assert.strictEqual(after[3].slice(35, 37), " 2");
    assert.strictEqual(after[3].slice(37, 38), "B");
    assert.strictEqual(after[3].slice(0, 34), SOURCE[3].slice(0, 34), "名前・長さが変わった");
    assert.strictEqual(after[3].slice(38), SOURCE[3].slice(38), "位置欄が変わった");
  });

  test("長さだけを変えても他の欄に触らない", () => {
    const after = applied([
      { kind: "setAttributes", sourceLine: 2, attributes: { length: 25 } }
    ]);
    assert.strictEqual(after[1].slice(29, 34), "   25");
    assert.strictEqual(after[1].slice(0, 29), SOURCE[1].slice(0, 29));
    assert.strictEqual(after[1].slice(34), SOURCE[1].slice(34));
  });
});

suite("属性編集: 定数のリテラル", () => {
  test("**後ろに続くキーワードが残る**", () => {
    const after = applied([
      { kind: "setAttributes", sourceLine: 3, attributes: { text: "新しい見出し" } }
    ]);
    assert.ok(after[2].includes("'新しい見出し'"), `差し替わっていない: ${after[2]}`);
    assert.ok(after[2].includes("DSPATR(HI)"), `後続のキーワードが消えた: ${after[2]}`);
  });

  test("位置欄には触らない", () => {
    const after = applied([
      { kind: "setAttributes", sourceLine: 3, attributes: { text: "短い" } }
    ]);
    assert.strictEqual(after[2].slice(38, 44), SOURCE[2].slice(38, 44));
  });

  test("リテラル中の `'` は重ねて書く", () => {
    const after = applied([
      { kind: "setAttributes", sourceLine: 3, attributes: { text: "It's" } }
    ]);
    assert.ok(after[2].includes("'It''s'"), after[2]);
  });

  test("他の行はバイト不変", () => {
    const after = applied([
      { kind: "setAttributes", sourceLine: 3, attributes: { text: "別の見出し" } }
    ]);
    assert.deepStrictEqual(changed(after), [2]);
    assert.strictEqual(after[4], SOURCE[4], "注記行が変わった");
  });
});

suite("属性編集: 書けないものだけ拒否する", () => {
  const codes = (edit: DdsEdit): string[] =>
    validateDdsEdits(SOURCE, [edit]).map(rejection => rejection.code);

  test("名前が 10 桁を超える", () => {
    assert.deepStrictEqual(
      codes({ kind: "setAttributes", sourceLine: 2, attributes: { name: "TOOLONGNAME1" } }),
      ["name-too-long"]
    );
  });

  test("名前を空にはできない", () => {
    assert.deepStrictEqual(
      codes({ kind: "setAttributes", sourceLine: 2, attributes: { name: "  " } }),
      ["field-needs-name"]
    );
  });

  test("小数桁が 2 桁に収まらない", () => {
    assert.deepStrictEqual(
      codes({ kind: "setAttributes", sourceLine: 4, attributes: { decimals: 100 } }),
      ["decimals-out-of-range"]
    );
  });

  test("定数に名前や桁数は書けない", () => {
    assert.deepStrictEqual(
      codes({ kind: "setAttributes", sourceLine: 3, attributes: { name: "X" } }),
      ["field-column-on-constant"]
    );
  });

  test("フィールドにリテラルは書けない", () => {
    assert.deepStrictEqual(
      codes({ kind: "setAttributes", sourceLine: 2, attributes: { text: "x" } }),
      ["text-on-field"]
    );
  });

  test("型・使用は 1 桁", () => {
    assert.deepStrictEqual(
      codes({ kind: "setAttributes", sourceLine: 2, attributes: { dataType: "AB" } }),
      ["invalid-column-value"]
    );
  });

  test("書き換えて 100 桁を超えるなら拒否する", () => {
    // 上限は lint の `line-length` と同じ 100（**JS の文字数**で数える。
    // DBCS の表示桁ではない——数え方を lint と揃えるため）。
    assert.deepStrictEqual(
      codes({
        kind: "setAttributes",
        sourceLine: 3,
        attributes: { text: "X".repeat(60) }
      }),
      ["line-too-long"]
    );
  });

  test("**規則違反（重なり・はみ出し）は拒否しない**", () => {
    // 判定は dspfLayout の診断が担う。編集は止めない。
    assert.deepStrictEqual(
      codes({ kind: "setAttributes", sourceLine: 2, attributes: { length: 99 } }),
      []
    );
  });

  test("拒否されたら何も適用しない", () => {
    const results = applyDdsEdits(SOURCE, [
      { kind: "setAttributes", sourceLine: 2, attributes: { name: "OK" } },
      { kind: "setAttributes", sourceLine: 2, attributes: { name: "TOOLONGNAME1" } }
    ]);
    assert.deepStrictEqual(results, []);
  });
});
