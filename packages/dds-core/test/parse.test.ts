import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../src/dds/parse.js";
import { displayWidth } from "../src/text/encoding.js";
import { literalFromFunctions } from "../src/dds/lineLayout.js";
import type { ItemLine } from "../src/dds/model.js";

const FIXTURES = join(__dirname, "..", "..", "test", "fixtures");

function items(text: string): ItemLine["item"][] {
  return parse(text)
    .lines.filter((l): l is ItemLine => l.kind === "item")
    .map(l => l.item);
}

describe("フィールドの解釈", () => {
  const text = "     A            EMPNAM        20A  B  4 14\n";

  test("各欄が桁どおりに取れる", () => {
    const [item] = items(text);
    assert.equal(item.kind, "field");
    assert.equal(item.name, "EMPNAM");
    assert.equal(item.length, 20);
    assert.equal(item.dataType, "A");
    assert.equal(item.usage, "B");
    assert.equal(item.line, 4);
    assert.equal(item.pos, 14);
  });
});

describe("DBCS を含む行の切り出し", () => {
  const dbcs = readFileSync(join(FIXTURES, "dbcs-const.dspf"), "utf8");

  test("日本語定数のリテラルが取れる", () => {
    const texts = items(dbcs).map(i => i.text).filter(Boolean);
    assert.ok(texts.includes("社員マスタ保守"));
    assert.ok(texts.includes("所属部門"));
    assert.ok(texts.includes("F3=終了"));
  });

  test("日本語定数の行桁が正しく取れる（機能欄より前は SBCS）", () => {
    const constant = items(dbcs).find(i => i.text === "社員マスタ保守");
    assert.ok(constant);
    assert.equal(constant!.line, 1);
    assert.equal(constant!.pos, 2);
  });

  test("定数の表示桁数が SO/SI を含めて計算できる", () => {
    // '社員マスタ保守' は全角 7 文字 = SO(1) + 7*2 + SI(1) = 16 桁。
    assert.equal(displayWidth("社員マスタ保守"), 16);
    // 'F3=終了' は半角 3 + SO(1) + 2*2 + SI(1) = 9 桁。
    assert.equal(displayWidth("F3=終了"), 9);
  });

  test("日本語を含む行でも 45 桁目から機能欄が始まる", () => {
    const line = "     A                                  1  2'社員マスタ保守'";
    const [item] = items(line + "\n");
    assert.equal(item.keywords, "'社員マスタ保守'");
  });
});

describe("リテラルの取り出し", () => {
  test("単純な引用符", () => {
    assert.equal(literalFromFunctions("'ABC'"), "ABC");
  });

  test("引用符の 2 個重ねは 1 個を表す", () => {
    assert.equal(literalFromFunctions("'IT''S'"), "IT'S");
  });

  test("キーワードは取り出さない", () => {
    assert.equal(literalFromFunctions("DSPATR(HI)"), undefined);
  });

  test("特殊文字を含むリテラル（実機フィクスチャに実在）", () => {
    assert.equal(literalFromFunctions("'+-+||+-+'"), "+-+||+-+");
  });

  test("空白だけのリテラル（実機フィクスチャに実在）", () => {
    assert.equal(literalFromFunctions("'        '"), "        ");
  });
});

describe("レコード様式とアイテムの対応", () => {
  const real = readFileSync(join(FIXTURES, "real-gridtst3.dspf"), "utf8");

  test("実機の DDS から 8 つのレコード様式が取れる", () => {
    const doc = parse(real);
    assert.deepEqual(
      doc.records.map(r => r.name),
      ["MAIN", "GRD3", "WIN1", "GRD4", "WIN2", "BACKGND", "WINBG", "WINNOB"]
    );
  });

  test("アイテムの id は様式ごとの連番になる", () => {
    const doc = parse(real);
    const mainItems = doc.lines
      .filter((l): l is ItemLine => l.kind === "item")
      .map(l => l.item)
      .filter(i => i.record === "MAIN");
    assert.deepEqual(mainItems.map(i => i.id), ["MAIN#1", "MAIN#2"]);
  });

  test("継続行はアイテムにならない（opaque のまま）", () => {
    const doc = parse(real);
    // GRDBOX(...) の継続行は名前も行桁も持たないので opaque。
    const continuation = doc.lines.find(l => l.raw.includes("PLAIN) (*COLOR RED)"));
    assert.ok(continuation);
    assert.equal(continuation!.kind, "opaque");
  });
});

describe("壊れた行は解釈しない", () => {
  test("DDS の名前として不正なら opaque にする", () => {
    // 6 桁目は 'A' だが、名前欄が日本語 = DDS の名前として不正。
    const line = "     A            日本語テスト  10A  O  5  2\n";
    const doc = parse(line);
    assert.equal(doc.lines[0].kind, "opaque");
  });

  test("妥当な名前は受け入れる", () => {
    for (const name of ["A", "EMPNAM", "#FLD1", "$X", "@Y", "A_B", "ABCDEFGHIJ"]) {
      const padded = name.padEnd(10);
      const line = `     A            ${padded}    10A  O  5  2\n`;
      assert.equal(
        doc0(line),
        "item",
        `${name} が受け入れられていない`
      );
    }
  });

  // 名前欄は 19-28 桁の 10 桁固定なので「11 文字の名前」は存在しえない
  // （11 文字目は名前欄の外＝29 桁目に落ちる）。不正になるのは文字種のほう。
  test("先頭が数字の名前は不正として弾く", () => {
    assert.equal(doc0("     A            1FLD          10A  O  5  2\n"), "opaque");
  });

  test("途中に空白を含む名前は不正として弾く", () => {
    assert.equal(doc0("     A            AB CD         10A  O  5  2\n"), "opaque");
  });

  test("ハイフンを含む名前は不正として弾く", () => {
    assert.equal(doc0("     A            A-B           10A  O  5  2\n"), "opaque");
  });
});

function doc0(text: string): string {
  return parse(text).lines[0].kind;
}

describe("同名のレコード様式（review should-2）", () => {
  const dup = [
    "     A          R REC1",
    "     A            FLDA          5A  O  3  2",
    "     A          R REC1",
    "     A            FLDB          5A  O  4  2",
    ""
  ].join("\n");

  test("出現ごとに別々の itemIds を持つ（配列を共有しない）", () => {
    const doc = parse(dup);
    assert.equal(doc.records.length, 2);
    assert.deepEqual(doc.records[0].itemIds, ["REC1#1"]);
    assert.deepEqual(doc.records[1].itemIds, ["REC1#2"]);
  });

  test("ID は名前で採番するので衝突しない", () => {
    const doc = parse(dup);
    const ids = doc.lines
      .filter((l): l is ItemLine => l.kind === "item")
      .map(l => l.item.id);
    assert.deepEqual(ids, ["REC1#1", "REC1#2"]);
    assert.equal(new Set(ids).size, ids.length, "ID が重複している");
  });
});
