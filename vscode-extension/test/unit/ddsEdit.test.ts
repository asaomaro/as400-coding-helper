import * as assert from "assert";
import {
  applyDdsEdits,
  validateDdsEdits,
  type DdsEdit,
  type DdsEditResult
} from "../../src/core/dds/ddsEdit";
import { buildItemLines } from "../../src/core/dds/ddsEditWriteBack";
import { buildDspfOutline } from "../../src/core/dds/dspfOutline";
import { printWidth } from "../../src/core/dbcs";
import { fieldPlacementChoices } from "../../src/core/dds/fieldChoices";
import { resolveDspfLayout } from "../../src/core/dds/dspfLayout";
import { readKeywordConstant } from "../../src/core/dds/ddsLogicalUnits";

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
  for (const result of applyDdsEdits(SOURCE, edits, "DDS-DSPF")) {
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
    ], "DDS-DSPF");
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
    validateDdsEdits(SOURCE, [edit], "DDS-DSPF").map(rejection => rejection.code);

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
        item: { kind: "constant", text: "x", row: 3, column: 5 }
      }),
      ["record-not-found"]
    );
  });

  test("フィールドに名前が無い", () => {
    assert.deepStrictEqual(
      reject({
        kind: "add",
        recordName: "DETAIL",
        item: { kind: "field", length: 5, row: 3, column: 5 }
      }),
      ["field-needs-name"]
    );
  });

  /**
   * **実機が通すものは拒否しない。** 重なり・はみ出しは実機でコンパイルが通る
   * （2026-08-27 / IBM i 7.3 で確認）ので、編集は止めない
   * ——直すために一度重ねる、といった動かし方ができなくなる。
   *
   * 1 桁目も**行が 1 でなければ通る**（属性文字は前の行の 80 桁目に入る）。
   */
  test("**実機が通す形（重なり・はみ出し・2 行以降の 1 桁目）は拒否しない**", () => {
    assert.deepStrictEqual(reject({ kind: "move", sourceLine: 6, row: 5, column: 1 }), []);
    assert.deepStrictEqual(reject({ kind: "resize", sourceLine: 7, length: 99 }), []);
  });

  /**
   * **1 行 1 桁だけは拒否する。** 開始属性文字を置く手前の桁が無く、
   * 実機が `CPF7311` でコンパイルを通さない（2026-08-27 / IBM i 7.3 で確認）。
   * 書けてしまうと、壊れたと気付くのは実機に持っていったときになる。
   */
  test("**1 行 1 桁は拒否する（実機が通さない）**", () => {
    assert.deepStrictEqual(
      reject({ kind: "move", sourceLine: 6, row: 1, column: 1 }),
      ["column-one-reserved"]
    );
    assert.deepStrictEqual(
      reject({
        kind: "add",
        recordName: "DETAIL",
        item: { kind: "constant", text: "x", row: 1, column: 1 }
      }),
      ["column-one-reserved"]
    );
  });

  /** 帳票には属性文字が無いので、1 行 1 桁でも置ける。 */
  test("帳票では 1 行 1 桁を拒否しない", () => {
    assert.deepStrictEqual(
      validateDdsEdits(
        SOURCE,
        [{ kind: "move", sourceLine: 6, row: 1, column: 1 }],
        "DDS-PRTF"
      ).map(rejection => rejection.code),
      []
    );
  });

  test("1 つでも書けない操作があれば、何も適用しない", () => {
    const results = applyDdsEdits(SOURCE, [
      { kind: "move", sourceLine: 6, row: 9, column: 30 },
      { kind: "resize", sourceLine: 7, length: 999999 }
    ], "DDS-DSPF");
    assert.deepStrictEqual(results, []);
  });
});

suite("DDS 編集: 複数の指示", () => {
  test("行番号の降順で返る（順に当てても行番号がずれない）", () => {
    const results = applyDdsEdits(SOURCE, [
      { kind: "move", sourceLine: 6, row: 9, column: 30 },
      { kind: "remove", sourceLine: 10 }
    ], "DDS-DSPF");
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

// 1 行（80 桁）に収まらない定数を 1 行に書くと、実機は 81 桁目以降を読まずリテラルが閉じないまま後続の行を飲み込む
// （CPD7508 / CPD7596。docs/research/20260927-dds-editor-exploration/findings.md の D16）。置く経路でも生テキストと同じく折る。
suite("DDS 編集: 長い定数は継続行に折って置く", () => {
  const longSbcs = "-".repeat(80);
  const longDbcs = "─".repeat(38);

  test("36 桁を超える定数は代表行と - の継続行に分かれ、どの行も 80 桁以内（実機の桁）", () => {
    for (const text of [longSbcs, longDbcs, "IT''S " + "X".repeat(40)]) {
      const lines = buildItemLines({ kind: "constant", text, row: 5, column: 2 });
      assert.ok(lines.length >= 2, `${text.length} 文字で折れていない`);
      assert.strictEqual(lines[0].slice(38, 44), "  5  2", "位置は代表行に");
      for (const line of lines) {
        assert.ok(printWidth(line) <= 80, `80 桁を超える: ${JSON.stringify(line)} (${printWidth(line)})`);
      }
      for (const line of lines.slice(0, -1)) assert.ok(line.endsWith("-"), `継続記号が無い: ${line}`);
      for (const line of lines.slice(1)) assert.strictEqual(line.slice(0, 44).trim(), "A", "継続行の 1-44 桁は空白");
    }
  });

  test("36 桁以内の定数はこれまでどおり 1 行", () => {
    assert.deepStrictEqual(buildItemLines({ kind: "constant", text: "-".repeat(34), row: 1, column: 2 }).length, 1);
  });

  test("折った定数を読み直すと元の文字列の 1 つの定数に戻り、後続の様式は変わらない", () => {
    for (const text of [longSbcs, longDbcs]) {
      const after = applied([{ kind: "add", recordName: "HEADER", item: { kind: "constant", text, row: 5, column: 2 } }]);
      const outline = buildDspfOutline(after);
      assert.deepStrictEqual(outline.map(record => record.name), ["HEADER", "DETAIL"], "後続の様式が消えた");
      const header = outline.find(record => record.name === "HEADER")!;
      const placed = header.items.find(item => item.row === 5);
      assert.ok(placed, "置いた定数が読めない");
      assert.strictEqual(placed.label, text);
      const detail = outline.find(record => record.name === "DETAIL")!;
      assert.deepStrictEqual(detail.items.map(item => item.label), ["CUSTNO", "CUSTNM", "MSGTXT"]);
    }
  });
});


suite("DDS 編集: 帳票に置く項目（実操作調査の帳票 P1・P2）", () => {
  const PRTF: readonly string[] = [
    ln({ record: "PHEAD", keywords: "SKIPB(3)" }),
    ln({ column: 2, keywords: "'CMPLXP'" }),
    ln({ record: "PLINE" }),
    ln({ row: 10, column: 2, keywords: "'X'" })
  ];
  const place = (source: readonly string[], edit: DdsEdit, type: "DDS-PRTF" | "DDS-DSPF" = "DDS-PRTF"): string[] => {
    const lines = [...source];
    for (const result of applyDdsEdits(source, [edit], type)) {
      lines.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
    }
    return lines;
  };

  // 行番号と SPACE/SKIP は併用できない。実機は CPD7860 で作成しない。
  test("行送り（SKIPB）の様式には行番号を書かず、桁だけを書く", () => {
    const after = place(PRTF, { kind: "add", recordName: "PHEAD", item: { kind: "constant", text: "HEAD", row: 3, column: 40 } });
    const added = after.find(line => line.includes("'HEAD'")) ?? "";
    assert.strictEqual(added.slice(38, 44), "    40");
  });

  test("行番号で書いている様式には、これまでどおり行も書く", () => {
    const after = place(PRTF, { kind: "add", recordName: "PLINE", item: { kind: "constant", text: "Y", row: 12, column: 5 } });
    assert.strictEqual((after.find(line => line.includes("'Y'")) ?? "").slice(38, 44), " 12  5");
  });

  test("帳票に置くフィールドの使用は書かない（画面は B）", () => {
    const field = { kind: "field" as const, name: "AMT", length: 7, dataType: "A", row: 12, column: 5 };
    const prtf = place(PRTF, { kind: "add", recordName: "PLINE", item: field });
    assert.strictEqual((prtf.find(line => line.includes("AMT")) ?? "").slice(37, 38), " ");
    const dspf = place(SOURCE, { kind: "add", recordName: "DETAIL", item: field }, "DDS-DSPF");
    assert.strictEqual((dspf.find(line => line.includes(" AMT")) ?? "").slice(37, 38), "B");
  });

  test("帳票の使用に B・I・H は書けない（O・P・空白は書ける）", () => {
    const codes = (usage: string) =>
      validateDdsEdits(PRTF, [{ kind: "add", recordName: "PLINE", item: { kind: "field", name: "F", length: 1, usage, row: 12, column: 5 } }], "DDS-PRTF").map(r => r.code);
    assert.deepStrictEqual(codes("B"), ["invalid-column-value"]);
    assert.deepStrictEqual(codes("H"), ["invalid-column-value"]);
    assert.deepStrictEqual(codes("P"), []);
    assert.deepStrictEqual(codes("O"), []);
  });
});

suite("DDS 編集: 位置を持てない使用（実操作調査 D9）", () => {
  const apply = (source: readonly string[], edit: DdsEdit, type: "DDS-PRTF" | "DDS-DSPF" = "DDS-DSPF"): string[] => {
    const lines = [...source];
    for (const result of applyDdsEdits(source, [edit], type)) {
      lines.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
    }
    return lines;
  };

  // 実機は H・P に位置があると CPD7443、M は CPD7436 で作成しない。
  for (const usage of ["H", "P", "M"]) {
    test(`画面で使用を ${usage} にすると位置（39-44 桁）を空ける`, () => {
      const after = apply(SOURCE, { kind: "setAttributes", sourceLine: 6, attributes: { usage } });
      assert.strictEqual(after[5], ln({ name: "CUSTNO", length: 6, dataType: "S", usage }));
    });
  }

  test("使用を O にしても位置は残る", () => {
    const after = apply(SOURCE, { kind: "setAttributes", sourceLine: 6, attributes: { usage: "O" } });
    assert.strictEqual(after[5].slice(38, 44), "  5 20");
  });

  test("2 次画面サイズの位置の上書き行も消す", () => {
    const source = [
      ln({ keywords: "DSPSIZ(24 80 *DS3 27 132 *DS4)" }),
      ln({ record: "MAIN" }),
      ln({ name: "FLDA", length: 10, dataType: "A", usage: "B", row: 5, column: 2 }),
      ln({ conditioning: "  *DS4", row: 6, column: 6 }),
      ln({ name: "FLDB", length: 10, dataType: "A", usage: "B", row: 8, column: 2 })
    ];
    const after = apply(source, { kind: "setAttributes", sourceLine: 3, attributes: { usage: "H" } });
    assert.deepStrictEqual(after, [
      source[0],
      source[1],
      ln({ name: "FLDA", length: 10, dataType: "A", usage: "H" }),
      source[4]
    ]);
  });

  test("帳票は P で位置を空ける（O は残す）", () => {
    const prtf = [ln({ record: "PREC" }), ln({ name: "FLD", length: 5, dataType: "A", row: 3, column: 2 })];
    assert.strictEqual(apply(prtf, { kind: "setAttributes", sourceLine: 2, attributes: { usage: "P" } }, "DDS-PRTF")[1].slice(38, 44).trim(), "");
    assert.strictEqual(apply(prtf, { kind: "setAttributes", sourceLine: 2, attributes: { usage: "O" } }, "DDS-PRTF")[1].slice(38, 44), "  3  2");
  });
});

suite("DDS 編集: ファイル・レベルのキーワードを 1 つ目から足す（実操作調査 D1・D2・D3）", () => {
  const apply = (source: readonly string[], edit: DdsEdit, type: "DDS-PRTF" | "DDS-DSPF"): string[] => {
    const lines = [...source];
    for (const result of applyDdsEdits(source, [edit], type)) {
      lines.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
    }
    return lines;
  };

  test("行が 1 本も無い帳票に、最初の様式の前へ足す（注記行はそのまま）", () => {
    const source = ["     A* 帳票", ln({ record: "PREC", keywords: "SPACEB(1)" }), ln({ column: 2, keywords: "'X'" })];
    const after = apply(source, { kind: "addFileKeywords", keywords: "INDARA" }, "DDS-PRTF");
    assert.deepStrictEqual(after, [source[0], ln({ keywords: "INDARA" }), source[1], source[2]]);
  });

  test("様式が無ければ末尾に足す", () => {
    assert.deepStrictEqual(apply([], { kind: "addFileKeywords", keywords: "DSPSIZ(24 80 *DS3)" }, "DDS-DSPF"), [
      ln({ keywords: "DSPSIZ(24 80 *DS3)" })
    ]);
  });

  // 帳票の LPI / CPI はファイル・レベルに書けない（実機 CPD7486。backlog の例は誤りだった）。
  test("ファイル・レベルに書けないキーワードは足さない（実機 CPD7486）", () => {
    assert.deepStrictEqual(
      validateDdsEdits([], [{ kind: "addFileKeywords", keywords: "LPI(8)" }], "DDS-PRTF").map(r => r.code),
      ["keyword-wrong-level"]
    );
    assert.deepStrictEqual(
      validateDdsEdits([], [{ kind: "addFileKeywords", keywords: "OVERLAY" }], "DDS-DSPF").map(r => r.code),
      ["keyword-wrong-level"]
    );
  });
});

suite("DDS 編集: キーワードを条件つきの行へ移す（実操作調査 D10・D8）", () => {
  const apply = (source: readonly string[], edit: DdsEdit): string[] => {
    const lines = [...source];
    const results = applyDdsEdits(source, [edit], "DDS-DSPF");
    assert.ok(results.length > 0, JSON.stringify(validateDdsEdits(source, [edit], "DDS-DSPF")));
    for (const result of results) lines.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
    return lines;
  };
  const on = (indicator: string) => [[{ indicator, negated: false }]];
  const CONTROL = [
    ln({ keywords: "DSPSIZ(24 80 *DS3)" }),
    ln({ record: "SFL01", keywords: "SFL" }),
    ln({ name: "F1", length: 10, dataType: "A", usage: "O", row: 5, column: 2 }),
    ln({ record: "CTL01", keywords: "SFLCTL(SFL01)" }),
    ln({ keywords: "SFLSIZ(0010) SFLPAG(0005)" }),
    ln({ keywords: "SFLDSP SFLDSPCTL SFLCLR" }),
    ln({ row: 1, column: 2, keywords: "'X'" })
  ];

  test("様式のキーワード（SFLDSP）を条件つきの行へ移す。他のキーワードはそのまま", () => {
    // 様式のキーワードの並び: SFLCTL(SFL01) / SFLSIZ / SFLPAG / SFLDSP(3) / SFLDSPCTL / SFLCLR
    const after = apply(CONTROL, { kind: "conditionKeyword", sourceLine: 4, index: 3, condition: on("31") });
    assert.deepStrictEqual(after.slice(3, 7), [
      CONTROL[3],
      CONTROL[4],
      ln({ keywords: "SFLDSPCTL SFLCLR" }),
      ln({ conditioning: "  31", keywords: "SFLDSP" })
    ]);
    assert.strictEqual(after[7], CONTROL[6]);
  });

  test("項目のキーワード（COLOR）を条件つきの行へ移す", () => {
    const source = [ln({ record: "R1" }), ln({ name: "F1", length: 10, dataType: "A", usage: "O", row: 3, column: 2, keywords: "COLOR(RED) DSPATR(HI)" })];
    assert.deepStrictEqual(apply(source, { kind: "conditionKeyword", sourceLine: 2, index: 0, condition: on("40") }), [
      source[0],
      ln({ name: "F1", length: 10, dataType: "A", usage: "O", row: 3, column: 2, keywords: "DSPATR(HI)" }),
      ln({ conditioning: "  40", keywords: "COLOR(RED)" })
    ]);
  });

  test("条件を付けられないキーワード（EDTCDE）は移さない", () => {
    const source = [ln({ record: "R1" }), ln({ name: "F1", length: 7, dataType: "Y", usage: "O", row: 3, column: 2, keywords: "EDTCDE(1)" })];
    assert.deepStrictEqual(
      validateDdsEdits(source, [{ kind: "conditionKeyword", sourceLine: 2, index: 0, condition: on("40") }], "DDS-DSPF").map(r => r.code),
      ["keyword-not-conditionable"]
    );
  });
});

suite("DDS 編集: キーワード欄の書き換えで条件つきの行を平らにしない", () => {
  // 項目の「＋ 追加」は欄全体（全部の行を通した並び）を送る。以前はそれを代表行に折り直し、
  // `40 COLOR(RED)` の行が代表行へ吸い込まれて**条件が黙って消えていた**。
  const SOURCE_WITH_CONDITION = [
    ln({ record: "R1" }),
    ln({ name: "F1", length: 10, dataType: "A", usage: "O", row: 3, column: 2, keywords: "DSPATR(HI)" }),
    ln({ conditioning: "  40", keywords: "COLOR(RED)" }),
    ln({ name: "F2", length: 10, dataType: "A", usage: "O", row: 4, column: 2 })
  ];
  const apply = (keywords: string): string[] => {
    const lines = [...SOURCE_WITH_CONDITION];
    for (const result of applyDdsEdits(SOURCE_WITH_CONDITION, [{ kind: "setKeywords", sourceLine: 2, keywords }], "DDS-DSPF")) {
      lines.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
    }
    return lines;
  };

  test("キーワードを足しても条件つきの行はそのまま", () => {
    const after = apply("DSPATR(HI) COLOR(RED) CHECK(ER)");
    assert.deepStrictEqual(after, [
      SOURCE_WITH_CONDITION[0],
      ln({ name: "F1", length: 10, dataType: "A", usage: "O", row: 3, column: 2, keywords: "DSPATR(HI) CHECK(ER)" }),
      SOURCE_WITH_CONDITION[2],
      SOURCE_WITH_CONDITION[3]
    ]);
  });

  test("条件つきの行のキーワードを外すと、その行ごと消える", () => {
    assert.deepStrictEqual(apply("DSPATR(HI)"), [SOURCE_WITH_CONDITION[0], SOURCE_WITH_CONDITION[1], SOURCE_WITH_CONDITION[3]]);
  });

  test("代表行のキーワードを外しても条件つきの行は残る", () => {
    assert.deepStrictEqual(apply("COLOR(RED)"), [
      SOURCE_WITH_CONDITION[0],
      ln({ name: "F1", length: 10, dataType: "A", usage: "O", row: 3, column: 2 }),
      SOURCE_WITH_CONDITION[2],
      SOURCE_WITH_CONDITION[3]
    ]);
  });
});

suite("DDS: フィールドを置くときの型・使用の選択肢（D6）", () => {
  test("一覧は F4 の定義（35・38 桁）と同じで、既定はこれまでと同じ", () => {
    const definition = (type: string) =>
      JSON.parse(require("fs").readFileSync(require("path").join(__dirname, `../../../resources/prompter/dds/ja/${type}.json`), "utf8"));
    const dspf = fieldPlacementChoices("DDS-DSPF", definition("DDS-DSPF"));
    const prtf = fieldPlacementChoices("DDS-PRTF", definition("DDS-PRTF"));
    assert.ok(dspf.dataTypes.some(c => c.value === "Y") && dspf.usages.some(c => c.value === "B"));
    assert.deepStrictEqual(prtf.usages.map(c => c.value), ["", "O", "P"]);
    assert.strictEqual(dspf.defaultDataType, "A");
    assert.strictEqual(dspf.defaultUsage, "B");
    assert.strictEqual(prtf.defaultUsage, "");
  });
});

suite("出力先の構成を壊さない", () => {
  // src から resources/prompter の JSON を import すると、tsc がその一部だけを出力先（out/・out-test/）の
  // resources/prompter/ に写し、定義を相対パスで探すコードが**本物ではなくその一部を読む**（D6 で 40 件落ちた）。
  test("src は resources/prompter の JSON を import しない", () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const root = path.join(__dirname, "../../../src");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".ts") && /from\s+["'][^"']*resources\/prompter\//u.test(fs.readFileSync(full, "utf8"))) offenders.push(full);
      }
    };
    walk(root);
    assert.deepStrictEqual(offenders, []);
  });
});

suite("DDS 編集: 項目を別の様式へ移す（D15）・潜在フィールドを足す", () => {
  const apply = (source: readonly string[], edit: DdsEdit, type: "DDS-PRTF" | "DDS-DSPF" = "DDS-DSPF"): string[] => {
    const lines = [...source];
    const results = applyDdsEdits(source, [edit], type);
    assert.ok(results.length > 0, JSON.stringify(validateDdsEdits(source, [edit], type)));
    for (const result of results) lines.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
    return lines;
  };

  test("条件の行・キーワード行ごと、移し先の様式の末尾へ移す", () => {
    const source = [
      ln({ record: "REC1" }),
      ln({ conditioning: "  40" }),
      ln({ name: "F1", length: 10, dataType: "A", usage: "O", row: 3, column: 2, keywords: "DSPATR(HI)" }),
      ln({ keywords: "COLOR(RED)" }),
      ln({ name: "F2", length: 5, dataType: "A", usage: "O", row: 4, column: 2 }),
      ln({ record: "FOOT" }),
      ln({ row: 24, column: 2, keywords: "'F3=END'" })
    ];
    assert.deepStrictEqual(apply(source, { kind: "moveToRecord", sourceLine: 3, recordName: "FOOT" }), [
      source[0], source[4], source[5], source[6], source[1], source[2], source[3]
    ]);
  });

  test("同じ様式へは移さない・無い様式へは移さない", () => {
    const source = [ln({ record: "REC1" }), ln({ name: "F1", length: 10, dataType: "A", usage: "O", row: 3, column: 2 })];
    assert.strictEqual(validateDdsEdits(source, [{ kind: "moveToRecord", sourceLine: 2, recordName: "REC1" }], "DDS-DSPF").length, 1);
    assert.strictEqual(validateDdsEdits(source, [{ kind: "moveToRecord", sourceLine: 2, recordName: "NONE" }], "DDS-DSPF").length, 1);
  });

  test("帳票で行送りの様式へ移すと行番号を外す", () => {
    const source = [ln({ record: "PLINE" }), ln({ row: 10, column: 2, keywords: "'X'" }), ln({ record: "PHEAD", keywords: "SKIPB(3)" }), ln({ column: 2, keywords: "'H'" })];
    const after = apply(source, { kind: "moveToRecord", sourceLine: 2, recordName: "PHEAD" }, "DDS-PRTF");
    assert.strictEqual(after[after.length - 1].slice(38, 44), "     2");
  });

  test("潜在フィールドは位置なしで足せる。位置の要る使用で位置が無ければ足さない", () => {
    const source = [ln({ record: "REC1" })];
    const after = apply(source, { kind: "add", recordName: "REC1", item: { kind: "field", name: "KEY", length: 6, dataType: "A", usage: "H" } });
    assert.strictEqual(after[1], ln({ name: "KEY", length: 6, dataType: "A", usage: "H" }));
    assert.strictEqual(validateDdsEdits(source, [{ kind: "add", recordName: "REC1", item: { kind: "field", name: "X", length: 1, usage: "B" } }], "DDS-DSPF").length, 1);
  });

  test("キャンバスに使用 H で置いても位置は書かない", () => {
    const after = apply([ln({ record: "REC1" })], { kind: "add", recordName: "REC1", item: { kind: "field", name: "KEY", length: 6, dataType: "A", usage: "H", row: 5, column: 10 } });
    assert.strictEqual(after[1], ln({ name: "KEY", length: 6, dataType: "A", usage: "H" }));
  });
});

suite("DDS: 文字列の無い定数（DATE / TIME / SYSNAME / USER。D4）", () => {
  const LINES = [
    ln({ keywords: "DSPSIZ(24 80 *DS3)" }),
    ln({ record: "REC" }),
    ln({ row: 1, column: 70, keywords: "DATE EDTCDE(Y)" }),
    ln({ row: 2, column: 70, keywords: "TIME" }),
    ln({ row: 3, column: 70, keywords: "USER" })
  ];
  test("項目として読み、実機の桁数で描く（様式のキーワードと誤らない）", () => {
    const layout = resolveDspfLayout(LINES);
    assert.deepStrictEqual(layout.items.map(item => [item.row, item.occupancy.end - item.occupancy.start - 1]), [[1, 8], [2, 8], [3, 10]]);
    assert.deepStrictEqual(layout.diagnostics, []);
    assert.deepStrictEqual(buildDspfOutline(LINES)[0].items.map(item => item.label), ["DATE", "TIME", "USER"]);
  });
  test("実機で測った桁数（DATE 6/8/8/10・TIME 8・SYSNAME 8・USER 10）", () => {
    const width = (keywords: string) => readKeywordConstant(keywords)?.sample.length;
    assert.deepStrictEqual(
      ["DATE", "DATE EDTCDE(Y)", "DATE(*YY)", "DATE(*YY) EDTCDE(Y)", "TIME", "SYSNAME", "USER"].map(width),
      [6, 8, 8, 10, 8, 8, 10]
    );
  });
  test("置く・書き換える", () => {
    const lines = [...LINES];
    for (const r of applyDdsEdits(LINES, [{ kind: "add", recordName: "REC", item: { kind: "constant", keyword: "DATE(*YY) EDTCDE(Y)", row: 5, column: 60 } }], "DDS-DSPF")) {
      lines.splice(r.replaceFrom, r.replaceTo - r.replaceFrom, ...r.lines);
    }
    assert.strictEqual(lines[5], ln({ row: 5, column: 60, keywords: "DATE(*YY) EDTCDE(Y)" }));
    assert.deepStrictEqual(validateDdsEdits(LINES, [{ kind: "setKeywords", sourceLine: 3, keywords: "DATE(*YY)" }], "DDS-DSPF"), []);
    assert.strictEqual(
      validateDdsEdits([ln({ record: "P" })], [{ kind: "add", recordName: "P", item: { kind: "constant", keyword: "SYSNAME", column: 2 } }], "DDS-PRTF").length,
      1
    );
  });
});
