import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { parse } from "../src/dds/parse.js";
import { applyOps, PatchRejectedError } from "../src/patch/ops.js";
import { DIAGNOSTIC_CODES } from "../src/dds/validate.js";
import type { ItemLine } from "../src/dds/model.js";
import { ln, dds } from "./helpers.js";

const SOURCE = dds(
  ln({ rec: "EMPMNT" }),
  ln({ row: 3, col: 2, func: "'CODE'" }),
  ln({ name: "EMPNO", len: 6, type: "S", dec: 0, usage: "B", row: 3, col: 10 }),
  ln({ name: "EMPNAM", len: 20, type: "A", usage: "B", row: 4, col: 10 }),
  ln({ rec: "EMPSFL" }),
  ln({ name: "SFLNO", len: 4, type: "S", dec: 0, usage: "O", row: 8, col: 2 })
);

function ids(text: string): string[] {
  return parse(text)
    .lines.filter((l): l is ItemLine => l.kind === "item")
    .map(l => l.item.id);
}

describe("moveItem / resizeItem", () => {
  test("対象行だけが変わり、他の行は 1 バイトも変わらない", () => {
    const doc = parse(SOURCE);
    const result = applyOps(doc, [
      { op: "moveItem", id: "EMPMNT#2", line: 5, pos: 30 }
    ]);

    const before = SOURCE.split("\n");
    const after = result.text.split("\n");
    const changed = before
      .map((line, index) => (line === after[index] ? -1 : index))
      .filter(index => index >= 0);

    assert.deepEqual(changed, [2], "変わった行が対象行だけではない");
    assert.ok(after[2].includes("  5 30"), `行が期待どおりでない: ${after[2]}`);
  });

  test("resizeItem は長さ欄だけを変える", () => {
    const doc = parse(SOURCE);
    const result = applyOps(doc, [
      { op: "resizeItem", id: "EMPMNT#3", length: 30 }
    ]);
    const after = result.text.split("\n")[3];
    assert.ok(after.includes("   30A"), `長さが変わっていない: ${after}`);
    assert.ok(after.includes("EMPNAM"), "名前が壊れている");
  });

  test("構造を変えないので ID は不変", () => {
    const doc = parse(SOURCE);
    const before = ids(SOURCE);
    const result = applyOps(doc, [
      { op: "moveItem", id: "EMPMNT#2", line: 5, pos: 30 }
    ]);
    assert.deepEqual(ids(result.text), before);
  });

  test("存在しない ID は拒否する", () => {
    const doc = parse(SOURCE);
    assert.throws(
      () => applyOps(doc, [{ op: "moveItem", id: "NOPE#9", line: 1, pos: 1 }]),
      PatchRejectedError
    );
  });
});

describe("addItem / removeItem", () => {
  test("addItem はレコード様式の末尾に足す（次の様式の直前）", () => {
    const doc = parse(SOURCE);
    const result = applyOps(doc, [
      {
        op: "addItem",
        record: "EMPMNT",
        item: {
          kind: "field",
          name: "DEPTCD",
          length: 3,
          dataType: "S",
          decimals: 0,
          usage: "O",
          line: 6,
          pos: 10
        }
      }
    ]);

    const lines = result.text.split("\n");
    assert.ok(lines[4].includes("DEPTCD"), `挿入位置が違う: ${lines[4]}`);
    assert.ok(lines[5].includes("R EMPSFL"), "次の様式の直前に入っていない");
  });

  test("addItem で定数を足せる", () => {
    const doc = parse(SOURCE);
    const result = applyOps(doc, [
      {
        op: "addItem",
        record: "EMPMNT",
        item: { kind: "constant", text: "NAME", line: 6, pos: 2 }
      }
    ]);
    assert.ok(result.text.includes("'NAME'"));
  });

  test("removeItem は該当行を取り除く", () => {
    const doc = parse(SOURCE);
    const result = applyOps(doc, [{ op: "removeItem", id: "EMPMNT#2" }]);
    assert.ok(!result.text.includes("EMPNO"), "削除されていない");
    assert.equal(result.text.split("\n").length, SOURCE.split("\n").length - 1);
  });

  test("構造を変えると ID が振り直される（この仕様を明示的に固定する）", () => {
    const doc = parse(SOURCE);
    assert.deepEqual(ids(SOURCE), [
      "EMPMNT#1",
      "EMPMNT#2",
      "EMPMNT#3",
      "EMPSFL#1"
    ]);

    const result = applyOps(doc, [{ op: "removeItem", id: "EMPMNT#1" }]);

    // 元の EMPMNT#2 が、新しいモデルでは EMPMNT#1 になる。
    assert.deepEqual(ids(result.text), ["EMPMNT#1", "EMPMNT#2", "EMPSFL#1"]);
    const first = parse(result.text).lines.find(
      (l): l is ItemLine => l.kind === "item"
    )!.item;
    assert.equal(first.name, "EMPNO", "ID の振り直しが期待と違う");
  });
});

describe("拒否の規則", () => {
  test("警告（隣接違反）ではパッチを拒否しない", () => {
    const doc = parse(SOURCE);
    // 定数 'CODE'(2-5) の直後 6 桁目へ動かす → 属性バイトの隣接違反（警告）
    const result = applyOps(doc, [
      { op: "moveItem", id: "EMPMNT#2", line: 3, pos: 6 }
    ]);

    assert.ok(
      result.diagnostics.some(
        d => d.code === DIAGNOSTIC_CODES.attributeAdjacency
      ),
      "隣接違反の警告が出ていない"
    );
    assert.ok(result.text.includes("  3  6"), "適用されていない");
  });

  test("エラー級（桁溢れ）は拒否する", () => {
    const doc = parse(SOURCE);
    assert.throws(
      () => applyOps(doc, [{ op: "moveItem", id: "EMPMNT#3", line: 4, pos: 70 }]),
      (error: unknown) => {
        assert.ok(error instanceof PatchRejectedError);
        assert.ok(
          error.diagnostics.some(d => d.code === DIAGNOSTIC_CODES.overflow)
        );
        return true;
      }
    );
  });

  test("拒否されたとき、元のモデルは変わっていない", () => {
    const doc = parse(SOURCE);
    try {
      applyOps(doc, [{ op: "moveItem", id: "EMPMNT#3", line: 4, pos: 70 }]);
    } catch {
      // 握りつぶす
    }
    assert.equal(doc.lines[3].raw, SOURCE.split("\n")[3]);
  });
});

describe("部分適用しない", () => {
  test("2 つ目の操作が拒否されたら 1 つ目も適用されない", () => {
    const doc = parse(SOURCE);
    assert.throws(
      () =>
        applyOps(doc, [
          { op: "moveItem", id: "EMPMNT#2", line: 5, pos: 30 },
          { op: "moveItem", id: "NOPE#9", line: 1, pos: 1 }
        ]),
      PatchRejectedError
    );
    // 元のモデルが変わっていない＝1 つ目も適用されていない
    assert.equal(doc.lines[2].raw, SOURCE.split("\n")[2]);
  });

  test("エラー級の違反で止まる場合も 1 つ目が残らない", () => {
    const doc = parse(SOURCE);
    assert.throws(
      () =>
        applyOps(doc, [
          { op: "moveItem", id: "EMPMNT#2", line: 5, pos: 30 },
          { op: "moveItem", id: "EMPMNT#3", line: 4, pos: 70 }
        ]),
      PatchRejectedError
    );
    assert.equal(doc.lines[2].raw, SOURCE.split("\n")[2]);
  });
});

describe("changedLines", () => {
  test("構造を変えない編集は、その行だけを範囲にする", () => {
    const doc = parse(SOURCE);
    const result = applyOps(doc, [
      { op: "moveItem", id: "EMPMNT#2", line: 5, pos: 30 }
    ]);
    assert.deepEqual(result.changedLines, { start: 2, end: 3 });
  });

  test("複数行を編集すると、その範囲を覆う", () => {
    const doc = parse(SOURCE);
    const result = applyOps(doc, [
      { op: "moveItem", id: "EMPMNT#2", line: 5, pos: 30 },
      { op: "resizeItem", id: "EMPMNT#3", length: 30 }
    ]);
    assert.deepEqual(result.changedLines, { start: 2, end: 4 });
  });

  test("構造を変えると、以降の行番号がずれるので末尾までを範囲にする", () => {
    const doc = parse(SOURCE);
    const result = applyOps(doc, [{ op: "removeItem", id: "EMPMNT#2" }]);
    assert.equal(result.changedLines.start, 2);
    assert.equal(result.changedLines.end, result.doc.lines.length);
  });

  test("何も変えなければ空の範囲", () => {
    const doc = parse(SOURCE);
    const result = applyOps(doc, []);
    assert.deepEqual(result.changedLines, { start: 0, end: 0 });
    assert.equal(result.text, SOURCE);
  });
});

describe("既存のエラーは編集をブロックしない（review must-1）", () => {
  // BAD は最初から桁溢れ（70 桁から 20 桁 = 89 桁）
  const withExistingError = dds(
    ln({ rec: "R1" }),
    ln({ name: "BAD", len: 20, type: "A", usage: "O", row: 3, col: 70 }),
    ln({ name: "OK1", len: 5, type: "A", usage: "O", row: 5, col: 2 })
  );

  test("前提: この DDS は元からエラーを含む", () => {
    const diags = applyOpsDiagnostics(withExistingError);
    assert.ok(
      diags.some(d => d.severity === "error"),
      "前提が崩れている（元からのエラーが無い）"
    );
  });

  test("無関係なアイテムの編集は成功する", () => {
    const doc = parse(withExistingError);
    const result = applyOps(doc, [
      { op: "moveItem", id: "R1#2", line: 6, pos: 3 }
    ]);
    assert.ok(result.text.includes("  6  3"), "適用されていない");
  });

  test("元からのエラーは診断には残る（隠さない）", () => {
    const doc = parse(withExistingError);
    const result = applyOps(doc, [
      { op: "moveItem", id: "R1#2", line: 6, pos: 3 }
    ]);
    assert.ok(
      result.diagnostics.some(d => d.severity === "error"),
      "元からのエラーが診断から消えている"
    );
  });

  test("**元からエラーのある項目自身も、エラーが増えなければ動かせる**", () => {
    // 07 の GUI で「掴んでも動かない」として現れた挙動の回帰テスト（07 decisions D14）。
    // 桁溢れしている BAD を、溢れたまま別の行へ動かす——違反を**生んで**いないので通す。
    const doc = parse(withExistingError);
    const result = applyOps(doc, [
      { op: "moveItem", id: "R1#1", line: 8, pos: 70 }
    ]);
    assert.ok(result.text.includes("  8 70"), "適用されていない");
    assert.ok(
      result.diagnostics.some(d => d.severity === "error"),
      "元からのエラーは診断に残る（通したことと隠すことは別）"
    );
  });

  test("元からのエラーを解消する移動もできる", () => {
    const doc = parse(withExistingError);
    const result = applyOps(doc, [
      { op: "moveItem", id: "R1#1", line: 3, pos: 2 }
    ]);
    assert.ok(
      !result.diagnostics.some(d => d.code === DIAGNOSTIC_CODES.overflow),
      "桁溢れが解消していない"
    );
  });

  test("元からエラーのある項目を削除できる", () => {
    const doc = parse(withExistingError);
    const result = applyOps(doc, [{ op: "removeItem", id: "R1#1" }]);
    assert.ok(!result.text.includes("BAD"), "削除されていない");
  });

  test("同じコードのエラーが増える操作は拒否される", () => {
    // 既に 1 件ある桁溢れを 2 件にする操作——「元からある」では済まない。
    // OK1 は 2 桁目にあるので、85 桁に伸ばすと右端（80）を越える。
    const doc = parse(withExistingError);
    assert.throws(
      () => applyOps(doc, [{ op: "resizeItem", id: "R1#2", length: 85 }]),
      PatchRejectedError
    );
  });

  test("触った行に新しくエラーを作る操作は拒否される", () => {
    const doc = parse(withExistingError);
    assert.throws(
      () => applyOps(doc, [{ op: "moveItem", id: "R1#2", line: 6, pos: 78 }]),
      PatchRejectedError
    );
  });
});

function applyOpsDiagnostics(text: string) {
  const doc = parse(text);
  return applyOps(doc, []).diagnostics;
}

describe("幅が不明なフィールドは隣接判定に加えない（review should-1）", () => {
  test("参照フィールド（長さ無し）は判定から外れる", () => {
    const text = dds(
      ln({ rec: "R1" }),
      ln({ name: "REFFLD", type: "A", usage: "O", row: 3, col: 2 }),
      ln({ name: "NEXT", len: 5, type: "A", usage: "O", row: 3, col: 3 })
    );
    const result = applyOps(parse(text), []);
    const forRefField = result.diagnostics.filter(d => d.itemId === "R1#1");

    // 幅 0 と決めつけて素通りさせるのではなく、判定対象から外している。
    assert.ok(
      !forRefField.some(d => d.code === DIAGNOSTIC_CODES.attributeAdjacency),
      "隣接判定に加えられている"
    );
    // ただし**黙って外さない**（05 の review should-1）。理由を伝える。
    assert.ok(
      forRefField.some(d => d.code === DIAGNOSTIC_CODES.widthUnknown),
      "判定対象外である理由が伝えられていない"
    );
  });
});
