import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { parse } from "../src/dds/parse.js";
import { renderAscii } from "../src/render/ascii.js";
import { ln, dds } from "./helpers.js";

function render(...lines: string[]): string[] {
  return renderAscii(parse(dds(ln({ rec: "R1" }), ...lines))).split("\n");
}

describe("グリッドの形（実機の形式に合わせる）", () => {
  test("既定では 24 行 + 末尾の改行", () => {
    const out = renderAscii(parse(dds(ln({ rec: "R1" }))));
    assert.ok(out.endsWith("\n"));
    assert.equal(out.split("\n").length, 25); // 24 行 + 末尾の空要素
  });

  test("すべての行がきっかり 80 文字", () => {
    const rows = render(
      ln({ row: 1, col: 2, func: "'社員マスタ保守'" }),
      ln({ name: "F1", len: 20, type: "A", usage: "O", row: 5, col: 40 })
    ).slice(0, 24);
    for (const [index, row] of rows.entries()) {
      assert.equal(row.length, 80, `${index + 1} 行目が 80 文字でない`);
    }
  });

  test("画面の大きさを指定できる", () => {
    const out = renderAscii(parse(dds(ln({ rec: "R1" }))), {
      screen: { rows: 27, cols: 132 }
    });
    const rows = out.split("\n").slice(0, 27);
    assert.equal(rows.length, 27);
    assert.equal(rows[0].length, 132);
  });
});

describe("定数の描画", () => {
  test("SBCS 定数は指定桁から描かれる", () => {
    const rows = render(ln({ row: 3, col: 10, func: "'ABC'" }));
    assert.equal(rows[2].slice(9, 12), "ABC");
    assert.equal(rows[2][8], " ", "開始桁より前が汚れている");
  });

  test("全角は「文字＋空白」の 2 セルで描かれ、SO/SI が桁を消費する", () => {
    // '名前' を 2 桁目 → SO(2) 名(3-4) 前(5-6) SI(7)
    const rows = render(ln({ row: 3, col: 2, func: "'名前'" }));
    const row = rows[2];
    assert.equal(row[1], " ", "SO の桁が空白でない");
    assert.equal(row[2], "名");
    assert.equal(row[3], " ", "全角の 2 桁目が空白でない");
    assert.equal(row[4], "前");
    assert.equal(row[5], " ", "全角の 2 桁目が空白でない");
    assert.equal(row[6], " ", "SI の桁が空白でない");
    assert.equal(row.length, 80);
  });

  test("半角と全角が混ざっても桁が合う", () => {
    // 'F3=終了' を 2 桁目 → F(2) 3(3) =(4) SO(5) 終(6-7) 了(8-9) SI(10)
    const rows = render(ln({ row: 3, col: 2, func: "'F3=終了'" }));
    const row = rows[2];
    assert.equal(row.slice(1, 4), "F3=");
    assert.equal(row[4], " ", "SO の桁が空白でない");
    assert.equal(row[5], "終");
    assert.equal(row[7], "了");
    assert.equal(row[9], " ", "SI の桁が空白でない");
  });
});

describe("フィールドの描画", () => {
  test("英数字フィールドは X の反復", () => {
    const rows = render(
      ln({ name: "F1", len: 5, type: "A", usage: "O", row: 3, col: 10 })
    );
    assert.equal(rows[2].slice(9, 14), "XXXXX");
  });

  test("数値フィールドは 9 の反復", () => {
    const rows = render(
      ln({ name: "F1", len: 4, type: "S", dec: 0, usage: "O", row: 3, col: 10 })
    );
    assert.equal(rows[2].slice(9, 13), "9999");
  });

  test("長さが不明なフィールド（参照フィールド）は描かない", () => {
    const rows = render(
      ln({ name: "REFFLD", type: "A", usage: "O", row: 3, col: 10 })
    );
    assert.equal(rows[2].trim(), "", "描けないはずのものが描かれている");
  });

  test("画面外の行は描かない（検証は validate の担当）", () => {
    const rows = render(
      ln({ name: "F1", len: 5, type: "A", usage: "O", row: 30, col: 2 })
    ).slice(0, 24);
    assert.ok(rows.every(row => row.trim() === ""));
  });

  test("右端を越える分は切り詰める", () => {
    const rows = render(
      ln({ name: "F1", len: 10, type: "A", usage: "O", row: 3, col: 76 })
    );
    assert.equal(rows[2].length, 80);
    assert.equal(rows[2].slice(75), "XXXXX");
  });
});

describe("様式の選択", () => {
  const source = dds(
    ln({ rec: "R1" }),
    ln({ row: 3, col: 2, func: "'AAA'" }),
    ln({ rec: "R2" }),
    ln({ row: 5, col: 2, func: "'BBB'" })
  );

  test("record を指定するとその様式だけを描く", () => {
    const rows = renderAscii(parse(source), { record: "R1" }).split("\n");
    assert.equal(rows[2].slice(1, 4), "AAA");
    assert.equal(rows[4].trim(), "", "他の様式が描かれている");
  });

  test("allRecords を指定すると配置済みのアイテムをすべて描く", () => {
    const rows = renderAscii(parse(source), { allRecords: true }).split("\n");
    assert.equal(rows[2].slice(1, 4), "AAA");
    assert.equal(rows[4].slice(1, 4), "BBB");
  });

  test("省略時は最初の様式だけ（既定は重ねない）", () => {
    const rows = renderAscii(parse(source)).split("\n");
    assert.equal(rows[2].slice(1, 4), "AAA");
    assert.equal(rows[4].trim(), "", "2 つ目の様式が描かれている");
  });
});

describe("パッチと描画が繋がっている（04 との結合）", () => {
  test("moveItem した結果が描画に反映される", async () => {
    const { applyOps } = await import("../src/patch/ops.js");
    const source = dds(
      ln({ rec: "R1" }),
      ln({ name: "F1", len: 5, type: "A", usage: "O", row: 3, col: 10 })
    );

    const before = renderAscii(parse(source)).split("\n");
    assert.equal(before[2].slice(9, 14), "XXXXX");

    const moved = applyOps(parse(source), [
      { op: "moveItem", id: "R1#1", line: 5, pos: 40 }
    ]);
    const after = renderAscii(moved.doc).split("\n");

    assert.equal(after[2].trim(), "", "元の位置に残っている");
    assert.equal(after[4].slice(39, 44), "XXXXX", "移動先に描かれていない");
  });

  test("resizeItem した結果が描画の幅に反映される", async () => {
    const { applyOps } = await import("../src/patch/ops.js");
    const source = dds(
      ln({ rec: "R1" }),
      ln({ name: "F1", len: 5, type: "A", usage: "O", row: 3, col: 10 })
    );
    const resized = applyOps(parse(source), [
      { op: "resizeItem", id: "R1#1", length: 12 }
    ]);
    const rows = renderAscii(resized.doc).split("\n");
    assert.equal(rows[2].slice(9, 21), "XXXXXXXXXXXX");
    assert.equal(rows[2][21], " ", "幅を超えて描かれている");
  });
});

describe("record 省略時の既定（review should-2）", () => {
  const source = dds(
    ln({ rec: "R1" }),
    ln({ row: 3, col: 2, func: "'AAAAAAAAAA'" }),
    ln({ rec: "R2" }),
    ln({ row: 3, col: 2, func: "'BBB'" })
  );

  test("省略すると最初の様式だけを描く（重なった絵にしない）", () => {
    const rows = renderAscii(parse(source)).split("\n");
    assert.equal(rows[2].slice(1, 11), "AAAAAAAAAA");
    assert.ok(
      !rows[2].startsWith(" BBB"),
      "2 つ目の様式が重なって描かれている"
    );
  });

  test("allRecords を明示したときだけ重ねる", () => {
    const rows = renderAscii(parse(source), { allRecords: true }).split("\n");
    assert.ok(rows[2].startsWith(" BBB"), "重ね合わせになっていない");
  });

  test("様式が 1 つも無ければ何も描かない", () => {
    const rows = renderAscii(parse("     A          \n")).split("\n");
    assert.equal(rows[0].trim(), "");
  });
});
