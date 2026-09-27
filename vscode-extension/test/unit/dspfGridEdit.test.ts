import * as assert from "assert";
import { applyDdsEdits, validateDdsEdits, type DdsEdit } from "../../src/core/dds/ddsEdit";
import { buildKeywordLine, foldKeywordArea } from "../../src/core/dds/ddsEditWriteBack";
import { buildGridKeyword, geometryFromCells, rewriteGridKeyword } from "../../src/core/dds/dspfGrid";
import { resolveDspfLayout } from "../../src/core/dds/dspfLayout";
import { resolveScreenSizes } from "../../src/core/dds/dspfScreenSize";

/**
 * 罫線をエディタで引く・直す（2026-09-27 利用者の決定）。キーワードの形は原典
 * `docs/origin/dds/detail/rzakc_rzakcmstdfgrd{b,l}.htm` の構文に合わせる。
 */

const keyword = (text: string, conditioning = ""): string => {
  const [first, ...rest] = foldKeywordArea(text).map(area => buildKeywordLine(area));
  return [`     A${conditioning.padEnd(38)}${first.slice(44)}`, ...rest].join("\n");
};
const record = (name: string, keywords = "") => `     A          R ${name}`.padEnd(44) + keywords;
const source = (...lines: string[]) => lines.join("\n").split("\n");

function apply(lines: readonly string[], edits: readonly DdsEdit[]): string[] {
  const after = [...lines];
  for (const result of applyDdsEdits(lines, edits, "DDS-DSPF")) {
    after.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
  }
  return after;
}

const primary = (lines: readonly string[]) => resolveScreenSizes(lines).sizes.primary;

suite("罫線: ドラッグした範囲から形を決める（利用者の決定: 形で自動判定）", () => {
  test("縦横とも 2 以上なら箱", () => {
    assert.deepStrictEqual(geometryFromCells({ row: 14, column: 61 }, { row: 5, column: 2 }), {
      kind: "box", row: 5, column: 2, depth: 10, width: 60, type: "PLAIN"
    });
  });
  test("1 行だけなら横線（下の境目）、1 桁だけなら縦線（右の境目）", () => {
    assert.deepStrictEqual(geometryFromCells({ row: 8, column: 2 }, { row: 8, column: 61 }), {
      kind: "line", row: 8, column: 2, length: 60, type: "LOWER"
    });
    assert.deepStrictEqual(geometryFromCells({ row: 5, column: 30 }, { row: 14, column: 30 }), {
      kind: "line", row: 5, column: 30, length: 10, type: "RIGHT"
    });
  });
});

suite("罫線: キーワードを作る・書き換える", () => {
  test("*TYPE は必須なので常に書く。色・線種は指定したときだけ", () => {
    assert.strictEqual(
      buildGridKeyword({ kind: "box", row: 5, column: 2, depth: 10, width: 60, type: "PLAIN" }),
      "GRDBOX((*POS (5 2 10 60)) (*TYPE PLAIN))"
    );
    assert.strictEqual(
      buildGridKeyword({ kind: "line", row: 8, column: 2, length: 60, type: "LOWER" }, { color: "RED", lineType: "DBL" }),
      "GRDLIN((*POS (8 2 60)) (*TYPE LOWER) (*COLOR RED) (*LINTYP DBL))"
    );
  });

  test("箱の罫線の間隔を書く（HRZVRT は横・縦の順）", () => {
    assert.strictEqual(
      buildGridKeyword({ kind: "box", row: 1, column: 1, depth: 4, width: 6, type: "HRZVRT", horizontalRule: 2, verticalRule: 3 }),
      "GRDBOX((*POS (1 1 4 6)) (*TYPE HRZVRT 2 3))"
    );
  });

  const size = primary([keyword("DSPSIZ(*DS3 *DS4)")]);

  test("書き換えても、触らない指定（*CONTROL）は残る", () => {
    assert.strictEqual(
      rewriteGridKeyword(
        "GRDLIN((*POS (6 4 20)) (*TYPE LOWER) (*CONTROL &CNTL1))",
        { kind: "line", row: 7, column: 4, length: 20, type: "LOWER" },
        size
      ),
      "GRDLIN((*POS (7 4 20)) (*TYPE LOWER) (*CONTROL &CNTL1))"
    );
  });

  test("*DS3 / *DS4 に分かれた位置は、描いている画面サイズの組だけ書き換える", () => {
    assert.strictEqual(
      rewriteGridKeyword(
        "GRDBOX((*POS (*DS3 5 5 18 70) (*DS4 5 5 19 120)) (*TYPE PLAIN))",
        { kind: "box", row: 6, column: 5, depth: 18, width: 70, type: "PLAIN" },
        size
      ),
      "GRDBOX((*POS (*DS3 6 5 18 70) (*DS4 5 5 19 120)) (*TYPE PLAIN))"
    );
  });

  test("色は鍵があれば書き換え・undefined なら外す。鍵が無ければ触らない", () => {
    const raw = "GRDBOX((*POS (2 2 5 10)) (*TYPE PLAIN) (*COLOR RED))";
    const geometry = { kind: "box", row: 2, column: 2, depth: 5, width: 10, type: "PLAIN" } as const;
    assert.strictEqual(rewriteGridKeyword(raw, geometry, size), raw);
    assert.strictEqual(rewriteGridKeyword(raw, geometry, size, { color: "BLU" }), "GRDBOX((*POS (2 2 5 10)) (*TYPE PLAIN) (*COLOR BLU))");
    assert.strictEqual(rewriteGridKeyword(raw, geometry, size, { color: undefined }), "GRDBOX((*POS (2 2 5 10)) (*TYPE PLAIN))");
    assert.strictEqual(
      rewriteGridKeyword(raw, geometry, size, { lineType: "DSH" }),
      "GRDBOX((*POS (2 2 5 10)) (*TYPE PLAIN) (*COLOR RED) (*LINTYP DSH))"
    );
  });
});

suite("罫線: 様式に足す・書き換える・消す", () => {
  const base = source(
    keyword("DSPSIZ(24 80 *DS3)"),
    record("HEAD"),
    "     A                                  1  2'TITLE'",
    record("GRID", "GRDRCD"),
    keyword("GRDATR((*COLOR BLU))"),
    keyword("GRDBOX((*POS (3 2 3 30)) (*TYPE PLAIN))"),
    record("FOOT"),
    "     A                                 24  2'F3=END'"
  );

  test("罫線の様式の末尾に足し、線として描かれる", () => {
    const after = apply(base, [{ kind: "addGrid", recordName: "GRID", keyword: "GRDLIN((*POS (8 2 60)) (*TYPE LOWER))" }]);
    const shapes = resolveDspfLayout(after).gridShapes;
    assert.deepStrictEqual(shapes.map(shape => shape.geometry.kind), ["box", "line"]);
    assert.strictEqual(shapes[1].recordName, "GRID");
    assert.strictEqual(shapes[1].color, "BLU", "様式の GRDATR が効く");
  });

  test("罫線の様式でない様式には足せない", () => {
    const rejections = validateDdsEdits(base, [{ kind: "addGrid", recordName: "HEAD", keyword: "GRDLIN((*POS (8 2 60)) (*TYPE LOWER))" }], "DDS-DSPF");
    assert.deepStrictEqual(rejections.map(r => r.code), ["grid-not-allowed"]);
  });

  test("様式が無ければ GRDRCD の様式を末尾に作って書く", () => {
    const lines = source(keyword("DSPSIZ(24 80 *DS3)"), record("HEAD"), "     A                                  1  2'TITLE'");
    const after = apply(lines, [{ kind: "addGrid", recordName: "lines", keyword: "GRDBOX((*POS (5 2 10 60)) (*TYPE PLAIN))", createRecord: true }]);
    assert.strictEqual(after[3], "     A          R LINES                     GRDRCD");
    assert.deepStrictEqual(resolveDspfLayout(after).gridShapes.map(shape => shape.recordName), ["LINES"]);
  });

  test("書き換える（移動）と、同じ様式の他のキーワードは残る", () => {
    const [shape] = resolveDspfLayout(base).gridShapes;
    const moved = rewriteGridKeyword(shape.raw, { ...shape.geometry, row: 4 } as typeof shape.geometry, primary(base));
    const after = apply(base, [{ kind: "setGridKeyword", sourceLine: shape.recordLine, index: shape.index, keyword: moved }]);
    assert.ok(after.some(line => line.includes("GRDATR((*COLOR BLU))")));
    assert.strictEqual(resolveDspfLayout(after).gridShapes[0].geometry.row, 4);
  });

  test("消すとキーワード行ごと消え、他の行は残る", () => {
    const [shape] = resolveDspfLayout(base).gridShapes;
    const after = apply(base, [{ kind: "setGridKeyword", sourceLine: shape.recordLine, index: shape.index, keyword: "" }]);
    // GRDBOX は折り返して 2 行（6・7 行目）。両方消える。
    assert.strictEqual(after.length, base.length - 2);
    assert.deepStrictEqual(resolveDspfLayout(after).gridShapes, []);
    assert.ok(after.some(line => line.includes("GRDATR")));
  });

  test("罫線でないキーワードは書き換えられない", () => {
    const rejections = validateDdsEdits(base, [{ kind: "setGridKeyword", sourceLine: 4, index: 1, keyword: "" }], "DDS-DSPF");
    assert.deepStrictEqual(rejections.map(r => r.code), ["grid-not-allowed"]);
  });
});
