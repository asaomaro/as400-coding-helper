import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDdsOutline } from "../../src/language/ddsSymbols";
import { toDocumentSymbols, toLineReader } from "../../src/language/outlineTypes";
import type { OutlineNode } from "../../src/language/outlineTypes";

/**
 * DDS のアウトライン。
 *
 * フィクスチャは docs/src/ の実サンプルをそのまま読む。合成した文字列ではなく実物を使うと、
 * 桁のずれや実務的な書き方の揺れ（参照フィールド・定数行・キーワードだけの行）を拾える。
 */

const SRC = join(__dirname, "../../../../docs/src");

function outlineOf(fileName: string): OutlineNode[] {
  const text = readFileSync(join(SRC, fileName), "utf8");
  const { lineAt, lineCount } = toLineReader(text);
  return buildDdsOutline(lineAt, lineCount);
}

/** name だけの木にして比較しやすくする。 */
function shape(nodes: readonly OutlineNode[]): unknown {
  return nodes.map(node => ({
    name: node.name,
    kind: node.kind,
    children: shape(node.children)
  }));
}

/** VSCode の要件: selectionRange は range に含まれていなければならない。 */
function assertSelectionInsideRange(nodes: readonly OutlineNode[], path = ""): void {
  for (const node of nodes) {
    const here = `${path}/${node.name}`;
    const { range: r, selectionRange: s } = node;

    assert.ok(
      s.startLine > r.startLine ||
        (s.startLine === r.startLine && s.startChar >= r.startChar),
      `${here}: selectionRange の開始が range の外`
    );
    assert.ok(
      s.endLine < r.endLine || (s.endLine === r.endLine && s.endChar <= r.endChar),
      `${here}: selectionRange の終端が range の外`
    );

    assertSelectionInsideRange(node.children, here);
  }
}

/** VSCode の要件: 子の range は親の range に含まれていなければならない。 */
function assertChildrenInsideParent(nodes: readonly OutlineNode[], parent?: OutlineNode, path = ""): void {
  for (const node of nodes) {
    const here = `${path}/${node.name}`;
    if (parent) {
      const p = parent.range;
      const c = node.range;
      assert.ok(
        c.startLine > p.startLine || (c.startLine === p.startLine && c.startChar >= p.startChar),
        `${here}: 子の range が親より前から始まる（親 ${p.startLine}-${p.endLine} / 子 ${c.startLine}-${c.endLine}）`
      );
      assert.ok(
        c.endLine < p.endLine || (c.endLine === p.endLine && c.endChar <= p.endChar),
        `${here}: 子の range が親より後ろまで伸びる（親 ${p.startLine}-${p.endLine} / 子 ${c.startLine}-${c.endLine}）`
      );
    }
    assertChildrenInsideParent(node.children, node, here);
  }
}

/** 兄弟の range が重なっていないこと。重なると VSCode がどちらを指すか不定になる。 */
function assertNoSiblingOverlap(nodes: readonly OutlineNode[], path = ""): void {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i].range;
      const b = nodes[j].range;
      assert.ok(
        a.endLine < b.startLine || b.endLine < a.startLine,
        `${path}: ${nodes[i].name}(${a.startLine}-${a.endLine}) と ` +
          `${nodes[j].name}(${b.startLine}-${b.endLine}) の range が重なっている`
      );
    }
  }
  for (const node of nodes) {
    assertNoSiblingOverlap(node.children, `${path}/${node.name}`);
  }
}

suite("DDS のアウトライン", () => {
  test("物理ファイル: レコード様式の下にフィールドとキーが並ぶ", () => {
    const outline = outlineOf("CUSTMST.pf");

    assert.deepEqual(shape(outline), [
      {
        name: "CUSTREC",
        kind: "record",
        children: [
          { name: "CUSTNO", kind: "field", children: [] },
          { name: "CUSTNM", kind: "field", children: [] },
          { name: "CUSTKN", kind: "field", children: [] },
          { name: "CUSTAM", kind: "field", children: [] },
          { name: "UPDDAT", kind: "field", children: [] },
          { name: "CUSTNO", kind: "key", children: [] }
        ]
      }
    ]);
  });

  test("物理ファイル: detail に長さ・データタイプ・小数点以下桁数が出る", () => {
    const fields = outlineOf("CUSTMST.pf")[0].children;
    const detail = new Map(fields.map(f => [`${f.kind}:${f.name}`, f.detail]));

    assert.equal(detail.get("field:CUSTNO"), "5S 0");
    assert.equal(detail.get("field:CUSTNM"), "30A");
    assert.equal(detail.get("field:CUSTAM"), "9S 2");
    // キーは属性欄が空なので detail も空。
    assert.equal(detail.get("key:CUSTNO"), "");
  });

  test("論理ファイル: キーと選択/省略を種別で区別する", () => {
    const outline = outlineOf("CUSTLF1.lf");

    assert.deepEqual(shape(outline), [
      {
        name: "CUSTREC",
        kind: "record",
        children: [
          { name: "CUSTNO", kind: "field", children: [] },
          { name: "CUSTNM", kind: "field", children: [] },
          { name: "CUSTAM", kind: "field", children: [] },
          { name: "CUSTNM", kind: "key", children: [] },
          { name: "CUSTAM", kind: "select", children: [] }
        ]
      }
    ]);
  });

  test("表示装置ファイル: 定数行はシンボルにならない", () => {
    const outline = outlineOf("CUSTMNT.dspf");

    // ファイル・レベルのキーワード行（DSPSIZ など）も、`1 25'顧客保守'` のような
    // 定数行も、名前欄が空なのでシンボルにならない。
    assert.deepEqual(shape(outline), [
      { name: "HEADER", kind: "record", children: [] },
      {
        name: "DETAIL",
        kind: "record",
        children: [
          { name: "CUSTNO", kind: "field", children: [] },
          { name: "CUSTNM", kind: "field", children: [] },
          { name: "MSGTXT", kind: "field", children: [] }
        ]
      }
    ]);
  });

  test("表示装置ファイル: detail に参照・使用目的・位置が出る", () => {
    const detail = new Map(
      outlineOf("CUSTMNT.dspf")[1].children.map(f => [f.name, f.detail])
    );

    // R=参照フィールド、B=入出力両用、5 20=行と桁。
    assert.equal(detail.get("CUSTNO"), "R B 5 20");
    assert.equal(detail.get("MSGTXT"), "50A O 23 2");
  });

  test("印刷装置ファイル: 位置欄だけを持つフィールドも出る", () => {
    const outline = outlineOf("CUSTRPT.prtf");

    assert.deepEqual(shape(outline), [
      { name: "HEADING", kind: "record", children: [] },
      {
        name: "DETLINE",
        kind: "record",
        children: [
          { name: "CUSTNO", kind: "field", children: [] },
          { name: "CUSTNM", kind: "field", children: [] },
          { name: "CUSTAM", kind: "field", children: [] }
        ]
      }
    ]);
    assert.equal(outline[1].children[0].detail, "R 5");
  });

  test("selectionRange が名前の位置を指す（ジャンプ先が名前になる）", () => {
    const record = outlineOf("CUSTMST.pf")[0];

    // 名前欄は 19-28 桁＝0 始まりで 18。CUSTREC は 7 文字。
    assert.equal(record.selectionRange.startLine, 1);
    assert.equal(record.selectionRange.startChar, 18);
    assert.equal(record.selectionRange.endChar, 18 + "CUSTREC".length);
  });

  test("range が配下の行まで伸びる（レコード様式が子を覆う）", () => {
    const record = outlineOf("CUSTMST.pf")[0];
    const lastChild = record.children[record.children.length - 1];

    assert.equal(record.range.startLine, 1);
    assert.ok(
      record.range.endLine >= lastChild.range.endLine,
      "レコード様式の range が最後の子を覆っていない"
    );
  });

  test("selectionRange は必ず range に含まれる（全フィクスチャ）", () => {
    for (const file of [
      "CUSTMST.pf",
      "CUSTLF1.lf",
      "CUSTMNT.dspf",
      "CUSTRPT.prtf",
      "DBCSSAMP.pf"
    ]) {
      assertSelectionInsideRange(outlineOf(file), file);
    }
  });

  test("子の range は必ず親の range に含まれる（全フィクスチャ）", () => {
    // VSCode の containment 要件。破るとパンくず・カーソル追従が子に解決できない。
    for (const file of [
      "CUSTMST.pf",
      "CUSTLF1.lf",
      "CUSTMNT.dspf",
      "CUSTRPT.prtf",
      "DBCSSAMP.pf"
    ]) {
      assertChildrenInsideParent(outlineOf(file), undefined, file);
    }
  });

  test("兄弟の range が重ならない（全フィクスチャ）", () => {
    for (const file of [
      "CUSTMST.pf",
      "CUSTLF1.lf",
      "CUSTMNT.dspf",
      "CUSTRPT.prtf",
      "DBCSSAMP.pf"
    ]) {
      assertNoSiblingOverlap(outlineOf(file), file);
    }
  });

  test("DocumentSymbol へ変換できる（アダプタが子まで再帰する）", () => {
    const symbols = toDocumentSymbols(outlineOf("CUSTMST.pf"));

    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].name, "CUSTREC");
    assert.equal(symbols[0].children.length, 6);
    assert.equal(symbols[0].children[0].name, "CUSTNO");
  });

  suite("異常系（例外を投げない）", () => {
    const cases: Record<string, string> = {
      空ファイル: "",
      注記のみ: "     A* コメントだけ\n     A* もう一行",
      短い行: "A\n  \n     A",
      レコード様式より前のフィールド: "     A            ORPHAN        10A",
      名前の無いレコード様式: "     A          R",
      改行のみ: "\n\n\n"
    };

    for (const [label, text] of Object.entries(cases)) {
      test(label, () => {
        const { lineAt, lineCount } = toLineReader(text);
        const outline = buildDdsOutline(lineAt, lineCount);
        assert.ok(Array.isArray(outline));
        assertSelectionInsideRange(outline, label);
        assertChildrenInsideParent(outline, undefined, label);
      });
    }

    test("レコード様式より前のフィールドはトップレベルに出る", () => {
      const { lineAt, lineCount } = toLineReader(
        "     A            ORPHAN        10A\n     A          R AFTER"
      );
      const outline = buildDdsOutline(lineAt, lineCount);

      assert.deepEqual(shape(outline), [
        { name: "ORPHAN", kind: "field", children: [] },
        { name: "AFTER", kind: "record", children: [] }
      ]);
    });

    test("名前の無いレコード様式でも落ちず、17 桁目を名前にする", () => {
      const { lineAt, lineCount } = toLineReader("     A          R");
      const outline = buildDdsOutline(lineAt, lineCount);

      assert.equal(outline.length, 1);
      assert.equal(outline[0].kind, "record");
      assert.equal(outline[0].name, "R");
    });
  });
});
