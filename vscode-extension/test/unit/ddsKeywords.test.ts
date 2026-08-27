import * as assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import {
  findKeywordHelp,
  parseKeywordEntries,
  type DdsKeywordHelp
} from "../../src/core/dds/ddsKeywords";

/**
 * キーワード欄（45-80 桁）の切り分けと、原典の解説の引き当て。
 *
 * **守るのは「引用符の中で切らない」**。`EDTWRD('   0. ')` や `DFT('(A)')` は
 * 空白と括弧を含むリテラルを引数に取るので、素朴に空白や括弧を数えると壊れる。
 */

const raw = (text: string) => parseKeywordEntries(text).map(entry => entry.raw);

suite("キーワード欄: 区切りに分ける", () => {
  test("空白区切りの 2 つ", () => {
    assert.deepStrictEqual(raw("DSPATR(RI) COLOR(RED)"), ["DSPATR(RI)", "COLOR(RED)"]);
  });

  test("引数を取らないキーワード", () => {
    const entries = parseKeywordEntries("ALARM");
    assert.deepStrictEqual(entries, [{ name: "ALARM", raw: "ALARM", kind: "keyword" }]);
  });

  test("引用符の中の空白で切らない", () => {
    assert.deepStrictEqual(raw("EDTWRD('   0. ')"), ["EDTWRD('   0. ')"]);
  });

  test("引用符の中の括弧を数えない", () => {
    assert.deepStrictEqual(raw("DFT('(A)') COLOR(RED)"), ["DFT('(A)')", "COLOR(RED)"]);
  });

  test("引数の中の空白は区切りではない", () => {
    const entries = parseKeywordEntries("CHECK(RZ RB)");
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].parameters, "RZ RB");
  });

  test("入れ子の括弧", () => {
    const entries = parseKeywordEntries("DSPSIZ(24 80 *DS3)");
    assert.strictEqual(entries[0].parameters, "24 80 *DS3");
  });

  test("定数のリテラルはキーワードではない", () => {
    const entries = parseKeywordEntries("'顧客保守'");
    assert.deepStrictEqual(entries, [{ name: "", raw: "'顧客保守'", kind: "literal" }]);
  });

  test("リテラルの後ろにキーワードが続く", () => {
    const entries = parseKeywordEntries("'顧客保守' DSPATR(HI)");
    assert.deepStrictEqual(
      entries.map(entry => [entry.kind, entry.raw]),
      [["literal", "'顧客保守'"], ["keyword", "DSPATR(HI)"]]
    );
  });

  test("リテラルの中の '' はエスケープ（そこで閉じない）", () => {
    assert.deepStrictEqual(raw("'A''B' DSPATR(HI)"), ["'A''B'", "DSPATR(HI)"]);
  });

  test("閉じない括弧でも捨てない（行末までを 1 区切り）", () => {
    const entries = parseKeywordEntries("DSPATR(RI");
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].raw, "DSPATR(RI");
    assert.strictEqual(entries[0].parameters, "RI");
  });

  test("閉じない引用符でも捨てない", () => {
    assert.deepStrictEqual(raw("'閉じない"), ["'閉じない"]);
  });

  test("小文字で書かれていても名前は大文字で返す（raw は元のまま）", () => {
    const entries = parseKeywordEntries("dspatr(ri)");
    assert.strictEqual(entries[0].name, "DSPATR");
    assert.strictEqual(entries[0].raw, "dspatr(ri)");
  });

  test("空なら区切りも無い", () => {
    assert.deepStrictEqual(parseKeywordEntries("   "), []);
  });
});

suite("キーワード欄: 原典の解説を引く", () => {
  const table: readonly DdsKeywordHelp[] = [
    { name: "DSPATR", title: "表示属性" },
    { name: "CAnn", title: "コマンド・アテンション" },
    { name: "CFnn", title: "コマンド機能" }
  ];

  test("そのままの名前で引ける", () => {
    assert.strictEqual(findKeywordHelp("DSPATR", table)?.title, "表示属性");
  });

  test("小文字でも引ける", () => {
    assert.strictEqual(findKeywordHelp("dspatr", table)?.title, "表示属性");
  });

  test("CF03 は CFnn に当たる（原典は総称で書く）", () => {
    assert.strictEqual(findKeywordHelp("CF03", table)?.title, "コマンド機能");
    assert.strictEqual(findKeywordHelp("CA12", table)?.title, "コマンド・アテンション");
  });

  test("桁数が違えば当てない", () => {
    // `CA3` / `CA123` は原典の書き方ではない。当ててしまうと誤った解説が出る。
    assert.strictEqual(findKeywordHelp("CA3", table), undefined);
    assert.strictEqual(findKeywordHelp("CA123", table), undefined);
  });

  test("表に無ければ undefined", () => {
    assert.strictEqual(findKeywordHelp("DSPATZ", table), undefined);
  });
});

/**
 * **原典から生成した実データで引く。**
 *
 * 手で作った表で通しても、実データの綴りと食い違っていれば意味が無い。
 * リポジトリのサンプル（`docs/src/CUSTMNT.dspf`）に実際に書かれているキーワードが
 * 1 つ残らず引けることを、実データに対して確かめる。
 */
suite("キーワード欄: 実データで引く", () => {
  const table = JSON.parse(
    readFileSync(
      join(__dirname, "../../../resources/completion/dds-keywords.json"),
      "utf8"
    )
  )["DDS-DSPF"] as readonly DdsKeywordHelp[];

  const sample = readFileSync(
    join(__dirname, "../../../../docs/src/CUSTMNT.dspf"),
    "utf8"
  ).split(/\r?\n/u);

  test("表が読めている", () => {
    assert.ok(table.length > 150, `件数が少なすぎる: ${table.length}`);
  });

  test("サンプルに出るキーワードがすべて引ける", () => {
    const missing: string[] = [];
    for (const line of sample) {
      if (line.slice(6, 7) === "*") continue; // 注記行
      for (const entry of parseKeywordEntries(line.slice(44))) {
        if (entry.kind !== "keyword" || entry.name.length === 0) continue;
        if (findKeywordHelp(entry.name, table) === undefined) missing.push(entry.name);
      }
    }
    assert.deepStrictEqual(missing, [], `原典に無いと判定された: ${missing.join(", ")}`);
  });

  test("CF03 が引ける（総称 CFnn への正規化が効いている）", () => {
    assert.ok(findKeywordHelp("CF03", table), "CF03 が引けない");
  });
});
