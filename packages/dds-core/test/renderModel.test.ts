import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../src/dds/parse.js";
import { renderAscii } from "../src/render/ascii.js";
import { buildRenderModel, type RenderItem } from "../src/render/model.js";
import { ln, dds } from "./helpers.js";

const FIXTURES = join(__dirname, "..", "..", "test", "fixtures");

function model(...lines: string[]) {
  return buildRenderModel(parse(dds(ln({ rec: "R1" }), ...lines)));
}

function items(...lines: string[]): readonly RenderItem[] {
  return model(...lines).records[0]?.items ?? [];
}

describe("RenderModel の骨格（design DD5 の拡張点）", () => {
  test("skeleton では kind=dspf・lineMode=absolute・canvas は 24×80", () => {
    const built = model(ln({ row: 1, col: 2, func: "'ABC'" }));
    assert.equal(built.kind, "dspf");
    assert.equal(built.canvas.lineMode, "absolute");
    assert.deepEqual(
      { rows: built.canvas.rows, cols: built.canvas.cols },
      { rows: 24, cols: 80 }
    );
  });

  test("records は配列だが skeleton では 1 件で、それが activeRecordId", () => {
    const built = model(ln({ row: 1, col: 2, func: "'ABC'" }));
    assert.equal(built.records.length, 1);
    assert.equal(built.records[0].name, "R1");
    assert.equal(built.activeRecordId, "R1");
  });

  test("skeleton ではすべてのアイテムが editable", () => {
    const built = items(
      ln({ row: 1, col: 2, func: "'ABC'" }),
      ln({ name: "FLD1", len: 5, type: "A", usage: "B", row: 2, col: 2 })
    );
    assert.ok(built.every(item => item.editable));
  });

  test("画面サイズは指定で上書きできる（DSPSIZ は opaque なので既定値のまま）", () => {
    const built = buildRenderModel(parse(dds(ln({ rec: "R1" }))), {
      screen: { rows: 27, cols: 132 }
    });
    assert.deepEqual(
      { rows: built.canvas.rows, cols: built.canvas.cols },
      { rows: 27, cols: 132 }
    );
  });

  test("様式が無い DDS は records 0 件・activeRecordId 空文字", () => {
    const built = buildRenderModel(parse("     A* comment only\n"));
    assert.deepEqual(built.records, []);
    assert.equal(built.activeRecordId, "");
  });

  test("様式を指定するとその様式のアイテムだけが載る", () => {
    const doc = parse(
      dds(
        ln({ rec: "R1" }),
        ln({ row: 1, col: 2, func: "'AAA'" }),
        ln({ rec: "R2" }),
        ln({ row: 2, col: 2, func: "'BBB'" })
      )
    );
    const second = buildRenderModel(doc, { record: "R2" });
    assert.equal(second.activeRecordId, "R2");
    assert.deepEqual(
      second.records[0].items.map(item => item.text),
      ["BBB"]
    );
  });
});

describe("widthCols は core が計算する（design DD3）", () => {
  test("定数はリテラルの表示桁数", () => {
    const [constant] = items(ln({ row: 1, col: 2, func: "'ABCDE'" }));
    assert.equal(constant.widthCols, 5);
    assert.equal(constant.text, "ABCDE");
    assert.equal(constant.kind, "constant");
  });

  test("英数字フィールドは長さぶんの X", () => {
    const [field] = items(
      ln({ name: "FLD1", len: 5, type: "A", usage: "B", row: 1, col: 2 })
    );
    assert.equal(field.widthCols, 5);
    assert.equal(field.text, "XXXXX");
  });

  test("数値フィールドは 9。符号位置は見える幅に含めない（06 D4）", () => {
    // 6S 0 の入力可フィールドは画面上 7 桁を占めるが、符号位置は空白。
    // 描画幅は「見える内容」の 6 桁（itemContentWidth）。
    const [field] = items(
      ln({ name: "EMPNO", len: 6, type: "S", dec: 0, usage: "B", row: 1, col: 2 })
    );
    assert.equal(field.widthCols, 6);
    assert.equal(field.text, "999999");
  });

  test("DBCS 定数は SO/SI 込みの表示桁数（実機の Expanded Source と一致）", () => {
    // '社員番号' = SO(1) + 全角 4 文字 × 2 + SI(1) = 10 桁（spec D7 の追記）。
    const [constant] = items(ln({ row: 1, col: 2, func: "'社員番号'" }));
    assert.equal(constant.widthCols, 10);
    assert.equal(constant.text, "社員番号");
  });
});

describe("置けないアイテムは items に入らず、診断に残る", () => {
  test("行・桁が無いアイテムは載らない", () => {
    const built = items(ln({ name: "FLD1", len: 5, type: "A", usage: "B" }));
    assert.deepEqual(built, []);
  });

  test("画面外の行は載らないが、診断で分かる", () => {
    const built = model(
      ln({ name: "FLD1", len: 5, type: "A", usage: "B", row: 99, col: 2 })
    );
    assert.deepEqual(built.records[0].items, []);
    const diagnostic = built.diagnostics.find(d => d.code === "DDS7104");
    assert.ok(diagnostic, "画面外の診断が出ること");
    assert.equal(diagnostic?.severity, "error");
  });

  test("幅を判定できないアイテムは載らないが、診断で分かる（05 should-1）", () => {
    const built = model(ln({ name: "FLD1", usage: "B", row: 1, col: 2 }));
    assert.deepEqual(built.records[0].items, []);
    assert.ok(built.diagnostics.some(d => d.code === "DDS7107"));
  });
});

describe("診断はコードとソース行を保って載る", () => {
  test("隣接違反（実機 CPD7866 相当）は警告として載り、ソース行を持つ", () => {
    const built = model(
      ln({ row: 1, col: 2, func: "'ABCDE'" }),
      ln({ name: "FLD1", len: 5, type: "A", usage: "B", row: 1, col: 7 })
    );
    const diagnostic = built.diagnostics.find(d => d.code === "DDS7103");
    assert.ok(diagnostic, "隣接違反が載ること");
    assert.equal(diagnostic?.severity, "warning");
    assert.equal(typeof diagnostic?.sourceLine, "number");
    assert.ok(diagnostic?.itemId);
  });

  test("アクティブ様式の外の違反も隠さない", () => {
    // 見えていない様式の違反を落とすと、「GUI で開いている限り問題が見えない」状態になる。
    const doc = parse(
      dds(
        ln({ rec: "R1" }),
        ln({ row: 1, col: 2, func: "'AAA'" }),
        ln({ rec: "R2" }),
        ln({ name: "FLD1", len: 5, type: "A", usage: "B", row: 99, col: 2 })
      )
    );
    const built = buildRenderModel(doc, { record: "R1" });
    assert.equal(built.records[0].items.length, 1);
    assert.ok(built.diagnostics.some(d => d.code === "DDS7104"));
  });
});

describe("配置は ASCII レンダラと同じ計算を通る（05 のゴールデンが GUI にも効く）", () => {
  /** ASCII の 1 行を配列にして返す。 */
  function grid(source: string, record?: string): string[][] {
    return renderAscii(parse(source), { record })
      .split("\n")
      .map(row => [...row]);
  }

  /**
   * model のアイテム占有範囲と ASCII の非空白セルが整合することを検査する。
   *
   * - ASCII に描かれた非空白セルは、**すべて**どれかのアイテムの占有範囲に入る。
   * - フィールドの占有範囲は、ASCII 上もプレースホルダで埋まっている。
   */
  function assertConsistent(source: string, record?: string): void {
    const doc = parse(source);
    const built = buildRenderModel(doc, record ? { record } : {});
    const rows = grid(source, record);
    const covered = new Set<string>();

    for (const item of built.records[0]?.items ?? []) {
      for (let offset = 0; offset < item.widthCols; offset += 1) {
        const col = item.pos + offset;
        if (col >= 1 && col <= built.canvas.cols) {
          covered.add(`${item.line}:${col}`);
        }
      }
      if (item.kind === "field") {
        const drawn = rows[item.line - 1]
          .slice(item.pos - 1, item.pos - 1 + item.widthCols)
          .join("");
        assert.equal(
          drawn,
          item.text,
          `${item.id} の占有範囲が ASCII と一致しません`
        );
      }
    }

    for (let row = 0; row < built.canvas.rows; row += 1) {
      for (let col = 0; col < built.canvas.cols; col += 1) {
        if (rows[row][col] !== " ") {
          assert.ok(
            covered.has(`${row + 1}:${col + 1}`),
            `${row + 1} 行 ${col + 1} 桁に描かれた文字が、どのアイテムの範囲にも入っていません`
          );
        }
      }
    }
  }

  test("SBCS の定数とフィールド", () => {
    assertConsistent(
      dds(
        ln({ rec: "R1" }),
        ln({ row: 3, col: 2, func: "'NAME'" }),
        ln({ name: "FLD1", len: 10, type: "A", usage: "B", row: 3, col: 10 }),
        ln({ name: "NUM1", len: 5, type: "S", dec: 0, usage: "B", row: 5, col: 10 })
      )
    );
  });

  test("DBCS を含むフィクスチャ（AC6 と同じ材料）", () => {
    assertConsistent(
      readFileSync(join(FIXTURES, "dbcs-const.dspf"), "utf8"),
      "EMPMNT"
    );
  });

  test("実機由来の複雑な様式", () => {
    assertConsistent(readFileSync(join(FIXTURES, "real-gridtst3.dspf"), "utf8"));
  });

  test("解釈できない行が混ざったフィクスチャ", () => {
    assertConsistent(readFileSync(join(FIXTURES, "messy.dspf"), "utf8"));
  });
});

describe("segments（DOM で描くための区切り・design DD3）", () => {
  test("cols の合計は widthCols と一致する", () => {
    const built = items(
      ln({ row: 1, col: 2, func: "'社員番号:'" }),
      ln({ name: "FLD1", len: 8, type: "A", usage: "B", row: 2, col: 2 })
    );
    assert.ok(built.length > 0);
    for (const item of built) {
      const total = item.segments.reduce((sum, seg) => sum + seg.cols, 0);
      assert.equal(total, item.widthCols, `${item.id} の区切りが幅と食い違う`);
    }
  });

  test("SO / SI は空文字の 1 桁として現れる（可視文字にならない）", () => {
    const [constant] = items(ln({ row: 1, col: 2, func: "'社員'" }));
    assert.deepEqual(constant.segments, [
      { text: "", cols: 1 },
      { text: "社員", cols: 4 },
      { text: "", cols: 1 }
    ]);
  });

  test("全角と半角が混ざると種別ごとに区切られる", () => {
    const [constant] = items(ln({ row: 1, col: 2, func: "'ID:社員'" }));
    assert.deepEqual(constant.segments, [
      { text: "ID:", cols: 3 },
      { text: "", cols: 1 },
      { text: "社員", cols: 4 },
      { text: "", cols: 1 }
    ]);
  });

  test("フィールドは 1 区切り", () => {
    const [field] = items(
      ln({ name: "FLD1", len: 4, type: "A", usage: "B", row: 1, col: 2 })
    );
    assert.deepEqual(field.segments, [{ text: "XXXX", cols: 4 }]);
  });
});
