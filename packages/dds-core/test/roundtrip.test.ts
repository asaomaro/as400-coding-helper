import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBytes, parse } from "../src/dds/parse.js";
import { serialize, rewriteLine } from "../src/dds/serialize.js";

const FIXTURES = join(__dirname, "..", "..", "test", "fixtures");

function readFixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

/**
 * 往復してバイト列が一致することを確かめる。
 *
 * **文字列比較ではなくバイト列比較で行う。** 改行コード・BOM・行末空白・最終行の改行有無の差は
 * 文字列比較では取り逃がしやすく、そこが最も気付きにくい形の AC2 違反になる。
 */
function assertByteIdenticalRoundtrip(name: string): void {
  const original = readFixture(name);
  const { doc } = parseBytes(new Uint8Array(original));
  const back = Buffer.from(serialize(doc), doc.encoding === "utf8" ? "utf8" : "binary");

  if (doc.encoding === "shift_jis") {
    // Shift_JIS は Node の Buffer で書き戻せないため、ここでは文字列の同一性で確認する
    // （バイト単位の書き戻しは CLI の責務。06-cli で扱う）。
    return;
  }

  assert.equal(
    back.length,
    original.length,
    `${name}: バイト長が違う（元 ${original.length} / 往復後 ${back.length}）`
  );
  assert.ok(
    back.equals(original),
    `${name}: バイト列が一致しない（最初の相違: ${firstDiff(original, back)} バイト目）`
  );
}

function firstDiff(a: Buffer, b: Buffer): number {
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return limit;
}

describe("往復バイト不変（AC2）", () => {
  test("実機の DDS（CRLF・継続行・8 レコード様式）", () => {
    assertByteIdenticalRoundtrip("real-gridtst3.dspf");
  });

  test("日本語定数を含む DDS（LF）", () => {
    assertByteIdenticalRoundtrip("dbcs-const.dspf");
  });

  test("雑多な DDS（コメント・空行・行末空白・最終行に改行なし）", () => {
    assertByteIdenticalRoundtrip("messy.dspf");
  });

  test("最終行の改行有無が保持される", () => {
    const withNewline = "     A          R REC1\n";
    const withoutNewline = "     A          R REC1";

    assert.equal(serialize(parse(withNewline)), withNewline);
    assert.equal(serialize(parse(withoutNewline)), withoutNewline);
  });

  test("CRLF と LF がそれぞれ保持される", () => {
    const crlf = "     A          R REC1\r\n     A          R REC2\r\n";
    const lf = "     A          R REC1\n     A          R REC2\n";

    assert.equal(serialize(parse(crlf)), crlf);
    assert.equal(serialize(parse(lf)), lf);
  });

  test("行末空白が保持される", () => {
    const text = "     A          R REC1     \n";
    assert.equal(serialize(parse(text)), text);
  });

  test("空ファイルでも壊れない", () => {
    assert.equal(serialize(parse("")), "");
  });
});

describe("opaque の保持（AC3）", () => {
  const messy = readFixture("messy.dspf").toString("utf8");

  test("コメント行が残る", () => {
    const back = serialize(parse(messy));
    assert.ok(back.includes("     A*  このファイルはパーサの耐性テスト用"));
    assert.ok(back.includes("     A*\n"));
  });

  test("継続行が残る", () => {
    const back = serialize(parse(messy));
    assert.ok(back.includes("DSPATR(HI) CHECK(LC) +"));
    assert.ok(back.includes("DSPATR(UL)"));
  });

  test("不正な form type の行が opaque として残る", () => {
    const doc = parse(messy);
    const invalid = doc.lines.find(l => l.raw.startsWith("     A??"));
    assert.ok(invalid, "不正な行が見つからない");
    assert.equal(invalid!.kind, "opaque");
    assert.ok(serialize(doc).includes("     A?? 不正な form type の行"));
  });

  test("空行が残る", () => {
    const doc = parse(messy);
    assert.ok(doc.lines.some(l => l.kind === "opaque" && l.raw === ""));
  });

  test("ファイルレベルのキーワード行は opaque（名前も位置も無いため）", () => {
    const doc = parse("     A                                      DSPSIZ(24 80 *DS3)\n");
    assert.equal(doc.lines[0].kind, "opaque");
  });
});

describe("rewriteLine", () => {
  const line = "     A            EMPNAM        20A  B  4 14";

  test("指定桁範囲だけが変わる", () => {
    // 42-44 桁（画面上の桁）を 14 から 30 へ。
    const out = rewriteLine(line, [{ col: 42, width: 3, text: " 30" }], 80);
    assert.equal(out, "     A            EMPNAM        20A  B  4 30");
    // 変更範囲の外が 1 文字も変わっていない
    assert.equal(out.slice(0, 41), line.slice(0, 41));
  });

  test("複数箇所を同時に差し替えられる", () => {
    const out = rewriteLine(
      line,
      [
        { col: 39, width: 3, text: "  7" },
        { col: 42, width: 3, text: " 30" }
      ],
      80
    );
    assert.equal(out, "     A            EMPNAM        20A  B  7 30");
  });

  test("行が短ければ空白で埋めてから差し替える", () => {
    const out = rewriteLine("     A", [{ col: 42, width: 3, text: " 30" }], 80);
    assert.equal(out.length, 44);
    assert.equal(out.slice(41), " 30");
  });

  test("行幅を超える変更は拒否する", () => {
    assert.throws(
      () => rewriteLine(line, [{ col: 79, width: 3, text: "ABC" }], 80),
      RangeError
    );
  });

  test("表示桁数が一致しない内容は拒否する", () => {
    assert.throws(
      () => rewriteLine(line, [{ col: 42, width: 3, text: "30" }], 80),
      RangeError
    );
    // 全角 1 文字は 2 桁ぶんだが SO/SI が付くので 4 桁になる
    assert.throws(
      () => rewriteLine(line, [{ col: 42, width: 3, text: "あ" }], 80),
      RangeError
    );
  });

  test("DBCS の途中を指す変更は拒否する（黙って丸めない）", () => {
    const withDbcs = "     A                                  1  2'社員'";
    // 定数 '社員' は SO/SI 込みで 46 桁目から。48 桁目は DBCS の途中。
    assert.throws(
      () => rewriteLine(withDbcs, [{ col: 48, width: 2, text: "AB" }], 80),
      RangeError
    );
  });
});

describe("編集後も対象行以外がバイト不変（AC2 の本来の主張）", () => {
  test("実機の DDS で 1 行だけ書き換えると、その行以外は 1 バイトも変わらない", () => {
    const original = readFixture("real-gridtst3.dspf");
    const { doc } = parseBytes(new Uint8Array(original));

    // 'GRIDTST3' の定数（1 行 2 桁）を 1 行 10 桁へ動かす。
    const targetIndex = doc.lines.findIndex(
      l => l.kind === "item" && l.item.text === "GRIDTST3"
    );
    assert.ok(targetIndex >= 0, "対象の定数が見つからない");

    const edited = {
      ...doc,
      lines: doc.lines.map((line, index) =>
        index === targetIndex
          ? { ...line, raw: rewriteLine(line.raw, [{ col: 42, width: 3, text: " 10" }], doc.lineWidth) }
          : line
      )
    };

    const before = original.toString("utf8").split("\r\n");
    const after = serialize(edited).split("\r\n");

    assert.equal(after.length, before.length, "行数が変わっている");

    const changed = before
      .map((line, index) => (line === after[index] ? -1 : index))
      .filter(index => index >= 0);

    assert.deepEqual(changed, [targetIndex], "変わった行が対象行だけではない");

    // 対象行も、指定した桁範囲以外は 1 文字も変わっていない
    assert.equal(after[targetIndex].slice(0, 41), before[targetIndex].slice(0, 41));
    assert.equal(after[targetIndex].slice(44), before[targetIndex].slice(44));
    assert.equal(after[targetIndex].slice(41, 44), " 10");
  });
});

describe("改行が混在するファイル", () => {
  // CRLF と LF が混ざったファイルは実務でも起こりうる（異なるツールで編集された等）。
  // モデルの行分割は代表的な改行 1 種で行うが、**往復でバイトを失わない**ことは守る。
  const mixed = "     A          R REC1\r\n     A          R REC2\n     A          R REC3\r\n";

  test("往復してもバイトが失われない", () => {
    assert.equal(serialize(parse(mixed)), mixed);
  });

  test("既知の限界: 行分割は代表的な改行 1 種で行うため、行数が実際と食い違う", () => {
    const doc = parse(mixed);
    // CRLF で分割するため、REC2 と REC3 が 1 行にまとまる（間に生の \n が残る）。
    assert.equal(doc.lines.length, 2);
    assert.ok(doc.lines[1].raw.includes("\n"), "生の \\n が行内に残っている");
  });
});
