import * as assert from "assert";
import {
  applyDdsEdits,
  validateDdsEdits,
  type DdsEdit,
  type DdsEditResult
} from "../../src/core/dds/ddsEdit";

/**
 * 編集操作。**ここで守るのは「触った範囲の外が 1 文字も変わらない」こと。**
 *
 * 削除は論理単位ごと行う必要がある（キーワード継続行は直前に付き、条件付け行は次に付く）。
 * 代表行だけ消すと継続行が孤児として残る——別実装で実際に踏んだ欠陥なので、
 * 継続行つき・条件行つきの両方を固定する。
 */

/** DDS の 1 行を桁どおりに組み立てる。 */
function ln(spec: {
  record?: string;
  name?: string;
  length?: number;
  dataType?: string;
  usage?: string;
  row?: number;
  column?: number;
  keywords?: string;
  conditioning?: string;
}): string {
  const cells = new Array<string>(80).fill(" ");
  const put = (start: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      cells[start - 1 + index] = text[index];
    }
  };
  put(6, "A");
  if (spec.conditioning !== undefined) put(7, spec.conditioning);
  if (spec.record !== undefined) {
    put(17, "R");
    put(19, spec.record);
  }
  if (spec.name !== undefined) put(19, spec.name);
  if (spec.length !== undefined) put(30, String(spec.length).padStart(5));
  if (spec.dataType !== undefined) put(35, spec.dataType);
  if (spec.usage !== undefined) put(38, spec.usage);
  if (spec.row !== undefined) put(39, String(spec.row).padStart(3));
  if (spec.column !== undefined) put(42, String(spec.column).padStart(3));
  if (spec.keywords !== undefined) put(45, spec.keywords);
  return cells.join("").trimEnd();
}

const SOURCE: readonly string[] = [
  ln({ keywords: "DSPSIZ(24 80 *DS3)" }),
  ln({ record: "HEADER" }),
  ln({ row: 1, column: 25, keywords: "'顧客保守'" }),
  "     A* 触ってはいけない注記行",
  ln({ record: "DETAIL" }),
  ln({ name: "CUSTNO", length: 6, dataType: "S", usage: "B", row: 5, column: 20 }),
  ln({ name: "CUSTNM", length: 20, dataType: "A", usage: "B", row: 6, column: 20, keywords: "CHECK(RZ)" }),
  ln({ keywords: "COLOR(BLU)" }),
  ln({ conditioning: "  50" }),
  ln({ name: "MSGTXT", length: 50, dataType: "A", usage: "O", row: 23, column: 2 })
];

/** 置き換え指示を実際に当てて、適用後の行を得る。 */
function applied(edits: readonly DdsEdit[]): string[] {
  const lines = [...SOURCE];
  for (const result of applyDdsEdits(SOURCE, edits)) {
    lines.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
  }
  return lines;
}

/** 変わった行の添字（旧ソースとの単純比較ではなく、差分の位置）。 */
function changedIndexes(after: readonly string[]): number[] {
  const changed: number[] = [];
  const max = Math.max(after.length, SOURCE.length);
  for (let index = 0; index < max; index += 1) {
    if (after[index] !== SOURCE[index]) changed.push(index);
  }
  return changed;
}

suite("DDS 編集: 移動と長さ変更", () => {
  test("移動は代表行 1 行だけを置き換える", () => {
    const results = applyDdsEdits(SOURCE, [
      { kind: "move", sourceLine: 6, row: 9, column: 30 }
    ]);
    assert.strictEqual(results.length, 1);
    assert.deepStrictEqual(
      { from: results[0].replaceFrom, to: results[0].replaceTo },
      { from: 5, to: 6 }
    );
  });

  test("移動で 39-44 桁だけが変わる", () => {
    const after = applied([{ kind: "move", sourceLine: 6, row: 9, column: 30 }]);
    const line = after[5];
    assert.strictEqual(line.slice(38, 41), "  9");
    assert.strictEqual(line.slice(41, 44), " 30");
    assert.strictEqual(line.slice(0, 38), SOURCE[5].slice(0, 38));
    assert.deepStrictEqual(changedIndexes(after), [5]);
  });

  test("長さ変更で 30-34 桁だけが変わる", () => {
    const after = applied([{ kind: "resize", sourceLine: 7, length: 25 }]);
    const line = after[6];
    assert.strictEqual(line.slice(29, 34), "   25");
    assert.strictEqual(line.slice(0, 29), SOURCE[6].slice(0, 29));
    assert.strictEqual(line.slice(34), SOURCE[6].slice(34), "35 桁目以降が変わった");
    assert.deepStrictEqual(changedIndexes(after), [6]);
  });
});

suite("DDS 編集: 削除は論理単位ごと", () => {
  test("キーワード継続行を持つ項目は、継続行ごと消える", () => {
    // 7 行目 CUSTNM の継続行は 8 行目（COLOR(BLU)）。
    const after = applied([{ kind: "remove", sourceLine: 7 }]);
    assert.strictEqual(after.length, SOURCE.length - 2, "2 行減っていない");
    assert.ok(!after.some(line => line.includes("CUSTNM")), "代表行が残っている");
    assert.ok(!after.some(line => line.includes("COLOR(BLU)")), "継続行が孤児として残っている");
  });

  test("先行する条件付け行を持つ項目は、条件行ごと消える", () => {
    // 10 行目 MSGTXT の条件行は 9 行目。
    const after = applied([{ kind: "remove", sourceLine: 10 }]);
    assert.strictEqual(after.length, SOURCE.length - 2);
    assert.ok(!after.some(line => line.includes("MSGTXT")));
    assert.ok(!after.some(line => line.trim() === "A  50"), "条件行が残っている");
  });

  test("継続行を持たない項目は 1 行だけ消える", () => {
    const after = applied([{ kind: "remove", sourceLine: 6 }]);
    assert.strictEqual(after.length, SOURCE.length - 1);
    assert.ok(!after.some(line => line.includes("CUSTNO")));
  });

  test("注記行は消さない（他の行はバイト不変）", () => {
    const after = applied([{ kind: "remove", sourceLine: 3 }]);
    assert.ok(after.includes("     A* 触ってはいけない注記行"), "注記行が消えた");
    const expected = SOURCE.filter((_, index) => index !== 2);
    assert.deepStrictEqual(after, expected, "削除以外の行が変わった");
  });
});

suite("DDS 編集: 追加", () => {
  test("様式の最後の論理単位の直後に入る", () => {
    const after = applied([
      {
        kind: "add",
        recordName: "HEADER",
        item: { kind: "constant", text: "顧客番号", row: 2, column: 5 }
      }
    ]);
    assert.strictEqual(after.length, SOURCE.length + 1);
    // HEADER の最後の項目は 3 行目なので、4 行目（添字 3）に入る。
    assert.ok(after[3].includes("'顧客番号'"), `入った位置が違う: ${JSON.stringify(after[3])}`);
    assert.strictEqual(after[4], SOURCE[3], "注記行が押し出されずに壊れた");
  });

  test("フィールドを追加すると定位置欄が桁どおりに入る", () => {
    const after = applied([
      {
        kind: "add",
        recordName: "DETAIL",
        item: {
          kind: "field",
          name: "NEWFLD",
          length: 7,
          dataType: "A",
          usage: "B",
          row: 12,
          column: 30
        }
      }
    ]);
    const line = after.find(text => text.includes("NEWFLD"));
    assert.ok(line, "追加されていない");
    assert.strictEqual(line.slice(18, 28), "NEWFLD    ");
    assert.strictEqual(line.slice(29, 34), "    7");
    assert.strictEqual(line.slice(34, 35), "A");
    assert.strictEqual(line.slice(37, 38), "B");
    assert.strictEqual(line.slice(38, 44), " 12 30");
  });

  test("既存の行は 1 行も変わらない", () => {
    const after = applied([
      {
        kind: "add",
        recordName: "DETAIL",
        item: { kind: "constant", text: "計", row: 20, column: 2 }
      }
    ]);
    const withoutNew = after.filter(line => !line.includes("'計'"));
    assert.deepStrictEqual(withoutNew, [...SOURCE]);
  });
});

suite("DDS 編集: 書けないものだけ拒否する", () => {
  const reject = (edit: DdsEdit): string[] =>
    validateDdsEdits(SOURCE, [edit]).map(rejection => rejection.code);

  test("宛先の行に項目が無い", () => {
    assert.deepStrictEqual(reject({ kind: "move", sourceLine: 4, row: 1, column: 1 }), [
      "line-not-found"
    ]);
  });

  test("長さが桁数欄に収まらない", () => {
    assert.deepStrictEqual(reject({ kind: "resize", sourceLine: 7, length: 123456 }), [
      "length-out-of-range"
    ]);
    assert.deepStrictEqual(reject({ kind: "resize", sourceLine: 7, length: 0 }), [
      "length-out-of-range"
    ]);
  });

  test("定数に長さは書けない", () => {
    assert.deepStrictEqual(reject({ kind: "resize", sourceLine: 3, length: 5 }), [
      "constant-has-length"
    ]);
  });

  test("行・桁が位置欄に収まらない", () => {
    assert.deepStrictEqual(reject({ kind: "move", sourceLine: 6, row: 1000, column: 1 }), [
      "position-out-of-range"
    ]);
  });

  test("様式が見つからない", () => {
    assert.deepStrictEqual(
      reject({
        kind: "add",
        recordName: "NOSUCH",
        item: { kind: "constant", text: "x", row: 1, column: 1 }
      }),
      ["record-not-found"]
    );
  });

  test("フィールドに名前が無い", () => {
    assert.deepStrictEqual(
      reject({
        kind: "add",
        recordName: "DETAIL",
        item: { kind: "field", length: 5, row: 1, column: 1 }
      }),
      ["field-needs-name"]
    );
  });

  test("**規則違反（重なり・はみ出し・1 桁目）は拒否しない**", () => {
    // 判定は dspfLayout の診断が担う。編集は止めない（直すために動かせる必要がある）。
    assert.deepStrictEqual(reject({ kind: "move", sourceLine: 6, row: 5, column: 1 }), []);
    assert.deepStrictEqual(reject({ kind: "resize", sourceLine: 7, length: 99 }), []);
  });

  test("1 つでも書けない操作があれば、何も適用しない", () => {
    const results = applyDdsEdits(SOURCE, [
      { kind: "move", sourceLine: 6, row: 9, column: 30 },
      { kind: "resize", sourceLine: 7, length: 999999 }
    ]);
    assert.deepStrictEqual(results, []);
  });
});

suite("DDS 編集: 複数の指示", () => {
  test("行番号の降順で返る（順に当てても行番号がずれない）", () => {
    const results = applyDdsEdits(SOURCE, [
      { kind: "move", sourceLine: 6, row: 9, column: 30 },
      { kind: "remove", sourceLine: 10 }
    ]);
    const froms = results.map((result: DdsEditResult) => result.replaceFrom);
    assert.deepStrictEqual(froms, [...froms].sort((a, b) => b - a));
  });

  test("複数を当てても、対象外の行はバイト不変", () => {
    const after = applied([
      { kind: "move", sourceLine: 6, row: 9, column: 30 },
      { kind: "resize", sourceLine: 7, length: 25 }
    ]);
    assert.strictEqual(after.length, SOURCE.length);
    assert.deepStrictEqual(changedIndexes(after), [5, 6]);
  });
});
