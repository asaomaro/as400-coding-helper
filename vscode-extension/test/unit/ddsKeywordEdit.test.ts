import * as assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import { applyDdsEdits, validateDdsEdits } from "../../src/core/dds/ddsEdit";
import {
  buildKeywordLine,
  foldKeywordArea,
  KEYWORD_AREA_WIDTH
} from "../../src/core/dds/ddsEditWriteBack";
import { parseKeywordEntries, type DdsKeywordHelp } from "../../src/core/dds/ddsKeywords";
import { toLogicalUnits } from "../../src/core/dds/ddsLogicalUnits";

/**
 * キーワード欄の書き出し。
 *
 * **守るのは往復**——折った結果を読み直すと、元のキーワードの並びに戻ること。
 * 折り返しは 2 通りある（切れ目で折る / `-` で切る）ので、どちらも読み直せなければ
 * **値が黙って変わる**（空白が増える・記号が値に混ざる）。
 *
 * 折り返しの規則は実機で確定したもの（`20260827-dds-keyword-continuation` の research F1）。
 */

const put = (line: string, column: number, value: string): string => {
  const a = line.split("");
  for (let i = 0; i < value.length; i += 1) a[column - 1 + i] = value[i];
  return a.join("");
};
const blank = () => " ".repeat(80);
const A = () => put(blank(), 6, "A");
const cst = (row: number, column: number, text: string) =>
  put(put(put(A(), 39, String(row).padStart(3)), 42, String(column).padStart(3)), 45, text)
    .replace(/ +$/u, "");
const fld = (row: number, column: number, name: string, keywords = "") =>
  put(
    put(
      put(put(put(put(A(), 19, name), 30, "   10"), 35, "A"), 38, "O"),
      39,
      String(row).padStart(3)
    ),
    42,
    String(column).padStart(3)
  ).replace(/ +$/u, "") + (keywords ? " ".repeat(Math.max(0, 44 - 44)) + keywords : "");
const rec = (name: string) => put(put(A(), 17, "R"), 19, name).replace(/ +$/u, "");

/** 折った結果を「ソース行」にして読み直し、キーワード欄の結合結果を返す。 */
function roundTrip(keywords: string): string {
  const chunks = foldKeywordArea(keywords);
  const lines = [
    rec("R1"),
    put(put(put(A(), 39, "  3"), 42, "  2"), 45, chunks[0] ?? "").replace(/ +$/u, ""),
    ...chunks.slice(1).map(buildKeywordLine)
  ];
  const units = toLogicalUnits(lines);
  return units[units.length - 1].keywords;
}

const entries = (text: string) => parseKeywordEntries(text).map(e => e.raw);

suite("キーワードの書き出し: 折り返し", () => {
  test("収まるなら 1 行", () => {
    assert.deepStrictEqual(foldKeywordArea("DSPATR(RI) COLOR(RED)"), ["DSPATR(RI) COLOR(RED)"]);
  });

  test("空なら行を作らない", () => {
    assert.deepStrictEqual(foldKeywordArea("   "), []);
  });

  test("**切れ目で折る**（継続記号を使わない）", () => {
    const chunks = foldKeywordArea("DSPATR(RI HI ND) COLOR(RED) CHECK(RZ) EDTCDE(1)");
    assert.ok(chunks.length >= 2, JSON.stringify(chunks));
    for (const chunk of chunks) {
      assert.ok(chunk.length <= KEYWORD_AREA_WIDTH, `${chunk.length} 桁: ${chunk}`);
      assert.ok(!chunk.endsWith("-"), `切れ目で折れるのに - を使った: ${chunk}`);
    }
  });

  test("**1 つのキーワードが 36 桁を超えるときだけ `-` で切る**", () => {
    const long = "EDTWRD('  ,   ,   ,   ,   ,   ,   ,   ,   ')";
    assert.ok(long.length > KEYWORD_AREA_WIDTH, "前提: 36 桁を超えている");
    const chunks = foldKeywordArea(long);
    assert.ok(chunks.length >= 2);
    assert.ok(chunks[0].endsWith("-"), chunks[0]);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= KEYWORD_AREA_WIDTH, `${chunk.length} 桁: ${chunk}`);
    }
  });

  test("継続行は 1-44 桁が空白（位置や名前を写さない）", () => {
    const line = buildKeywordLine("COLOR(RED)");
    assert.strictEqual(line.slice(0, 6), "     A");
    assert.strictEqual(line.slice(6, 44).trim(), "");
    assert.strictEqual(line.slice(44), "COLOR(RED)");
  });
});

suite("キーワードの書き出し: 往復", () => {
  const CASES = [
    "DSPATR(RI)",
    "DSPATR(RI) COLOR(RED)",
    "DSPATR(RI HI ND) COLOR(RED) CHECK(RZ) EDTCDE(1)",
    "'定数' DSPATR(HI)",
    "EDTWRD('  ,   ,   ,   ,   ,   ,   ,   ,   ')",
    "'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJ'",
    "DFT('(A)') COLOR(RED)",
    "CHECK(RZ RB) DSPATR(UL) COLOR(BLU) EDTCDE(1) DSPATR(HI) COLOR(RED)"
  ];

  for (const text of CASES) {
    test(`読み直すと同じ並びに戻る: ${text.slice(0, 34)}`, () => {
      assert.deepStrictEqual(entries(roundTrip(text)), entries(text), roundTrip(text));
    });
  }
});

/**
 * **原典の表から総当たりで作った入力で往復する。**
 *
 * 手で並べた数件で通しても、実データの綴り（長い引数・引用符・入れ子の括弧）で
 * 崩れれば意味が無い。176 件すべてを使って、単独・2 つ並べ・長い引数の 3 通りを回す。
 */
suite("キーワードの書き出し: 原典の表で総当たり", () => {
  const table = JSON.parse(
    readFileSync(join(__dirname, "../../../resources/completion/dds-keywords.json"), "utf8")
  )["DDS-DSPF"] as readonly DdsKeywordHelp[];

  test("表が読めている", () => {
    assert.ok(table.length > 150, `件数が少なすぎる: ${table.length}`);
  });

  test("**全件で往復が成立する**", () => {
    const failures: string[] = [];
    for (const keyword of table) {
      const name = keyword.name.replace(/nn$/u, "03");
      const forms = keyword.hasParameters
        ? [`${name}(X)`, `${name}(X) DSPATR(HI)`, `${name}('${"A".repeat(40)}')`]
        : [name, `${name} DSPATR(HI)`];
      for (const text of forms) {
        const back = roundTrip(text);
        if (JSON.stringify(entries(back)) !== JSON.stringify(entries(text))) {
          failures.push(`${text} → ${back}`);
        }
      }
    }
    assert.deepStrictEqual(failures.slice(0, 5), [], `${failures.length} 件で往復が崩れた`);
  });
});

suite("キーワードの書き出し: 適用と拒否", () => {
  const SOURCE = [
    rec("KWR"),
    cst(3, 12, "'CONST'"),
    fld(5, 12, "FLD1"),
    put(A(), 45, "DSPATR(HI)").replace(/ +$/u, "")
  ];

  test("欄をまるごと置き換える（後ろのキーワード行ごと）", () => {
    const results = applyDdsEdits(SOURCE, [
      { kind: "setKeywords", sourceLine: 3, keywords: "COLOR(RED)" }
    ], "DDS-DSPF");
    assert.strictEqual(results.length, 1);
    assert.deepStrictEqual([results[0].replaceFrom, results[0].replaceTo], [2, 4]);
    assert.strictEqual(results[0].lines.length, 1);
    assert.ok(results[0].lines[0].endsWith("COLOR(RED)"), results[0].lines[0]);
  });

  test("溢れたら継続行が増える", () => {
    const results = applyDdsEdits(SOURCE, [
      {
        kind: "setKeywords",
        sourceLine: 3,
        keywords: "DSPATR(RI HI ND) COLOR(RED) CHECK(RZ) EDTCDE(1)"
      }
    ], "DDS-DSPF");
    assert.ok(results[0].lines.length >= 2, JSON.stringify(results[0].lines));
    for (const line of results[0].lines) {
      assert.ok(line.length <= 80, `${line.length} 桁: ${line}`);
    }
  });

  test("欄を空にできる（フィールド）", () => {
    const results = applyDdsEdits(SOURCE, [
      { kind: "setKeywords", sourceLine: 3, keywords: "" }
    ], "DDS-DSPF");
    assert.strictEqual(results[0].lines.length, 1);
    assert.strictEqual(results[0].lines[0].slice(44).trim(), "");
  });

  test("**定数からリテラルを消す編集は拒否する**", () => {
    // 消すと `unitItemKind` が項目と認めず、キャンバスから消える。
    const rejections = validateDdsEdits(SOURCE, [
      { kind: "setKeywords", sourceLine: 2, keywords: "DSPATR(HI)" }
    ], "DDS-DSPF");
    assert.deepStrictEqual(rejections.map(r => r.code), ["constant-needs-literal"]);
  });

  test("定数はリテラルを残せば通る", () => {
    assert.deepStrictEqual(
      validateDdsEdits(SOURCE, [
        { kind: "setKeywords", sourceLine: 2, keywords: "'CONST' DSPATR(HI)" }
      ], "DDS-DSPF"),
      []
    );
  });

  test("**様式のキーワードも編集できる**（OVERLAY / CFnn は様式にしか書けない）", () => {
    const withRecordKeywords = [
      put(put(put(A(), 17, "R"), 19, "KWR"), 45, "OVERLAY").replace(/ +$/u, ""),
      cst(3, 12, "'CONST'")
    ];
    assert.deepStrictEqual(
      validateDdsEdits(withRecordKeywords, [
        { kind: "setKeywords", sourceLine: 1, keywords: "OVERLAY PUTOVR" }
      ], "DDS-DSPF"),
      []
    );
    const results = applyDdsEdits(withRecordKeywords, [
      { kind: "setKeywords", sourceLine: 1, keywords: "OVERLAY PUTOVR" }
    ], "DDS-DSPF");
    assert.ok(results[0].lines[0].endsWith("OVERLAY PUTOVR"), results[0].lines[0]);
    // 様式の 1-44 桁（`R KWR`）は残る。
    assert.ok(results[0].lines[0].includes("R KWR"), results[0].lines[0]);
  });

  test("位置や長さの編集は様式を相手にしない（項目だけ）", () => {
    const withRecordKeywords = [
      put(put(put(A(), 17, "R"), 19, "KWR"), 45, "OVERLAY").replace(/ +$/u, ""),
      cst(3, 12, "'CONST'")
    ];
    assert.deepStrictEqual(
      validateDdsEdits(withRecordKeywords, [
        { kind: "move", sourceLine: 1, row: 5, column: 5 }
      ], "DDS-DSPF").map(r => r.code),
      ["line-not-found"]
    );
  });

  test("**注記行が挟まっていたら拒否する**（区間で置き換えると注記が消える）", () => {
    const withComment = [
      rec("KWR"),
      cst(3, 12, "'CONST'"),
      put(A(), 7, "*").replace(/ +$/u, ""),
      put(A(), 45, "DSPATR(HI)").replace(/ +$/u, "")
    ];
    const rejections = validateDdsEdits(withComment, [
      { kind: "setKeywords", sourceLine: 2, keywords: "'CONST'" }
    ], "DDS-DSPF");
    assert.deepStrictEqual(rejections.map(r => r.code), ["keyword-lines-not-contiguous"]);
  });
});
