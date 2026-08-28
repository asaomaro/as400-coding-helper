import * as assert from "assert";
import {
  applyDdsEdits,
  validateDdsEdits,
  type DdsEdit
} from "../../src/core/dds/ddsEdit";
import {
  findFieldReferences,
  renameFieldReferences,
  NOT_FOLLOWED
} from "../../src/core/dds/ddsReferences";

/**
 * **名前を変えたときの参照追随。**
 *
 * 追うのは 2 種類だけ（`ddsReferences.ts`）:
 * - `&名前`（プログラム - システム間フィールド）。原典が `&` を
 *   「このソースの中のフィールド」の印として一貫して使う。
 * - 原典が「このファイル内の項目」と書いている定位置の引数（`CSRLOC` / `HLPARA(*FLD …)`）。
 *
 * **外部のオブジェクトを指す引数は触らない。** `REF(CUSTMST)` が黙って書き換わると
 * 原因の分からない壊れ方をするので、触らないことをここで固定する。
 */

function apply(lines: readonly string[], edits: readonly DdsEdit[]): string[] {
  assert.deepStrictEqual(validateDdsEdits(lines, edits, "DDS-DSPF"), [], "検証で弾かれた");
  const out = [...lines];
  for (const result of applyDdsEdits(lines, edits, "DDS-DSPF")) {
    out.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
  }
  return out;
}

suite("参照の追随: 見つける", () => {
  test("&名前 はキーワードを問わず拾う（規則 A）", () => {
    const found = findFieldReferences("SFLCSRRRN(&RRN) CHCCTL(1 &CTL)");
    assert.deepStrictEqual(
      found.map(reference => [reference.keyword, reference.name, reference.rule]),
      [
        ["SFLCSRRRN", "RRN", "ampersand"],
        ["CHCCTL", "CTL", "ampersand"]
      ]
    );
  });

  test("CSRLOC の 2 つの引数を拾う（規則 B）", () => {
    assert.deepStrictEqual(
      findFieldReferences("CSRLOC(CSRROW CSRCOL)").map(r => [r.name, r.rule]),
      [
        ["CSRROW", "positional"],
        ["CSRCOL", "positional"]
      ]
    );
  });

  /**
   * `HLPARA` は形式が 5 つあり、`*FLD` のときだけ 2 つ目が項目名。
   * 位置だけで決めると `HLPARA(1 1 24 80)` の `1` を名前として扱う。
   */
  test("HLPARA は *FLD の形のときだけ拾う", () => {
    assert.deepStrictEqual(
      findFieldReferences("HLPARA(*FLD CUSTNO)").map(r => r.name),
      ["CUSTNO"]
    );
    assert.deepStrictEqual(findFieldReferences("HLPARA(1 1 24 80)"), []);
    assert.deepStrictEqual(findFieldReferences("HLPARA(*RCD)"), []);
  });

  test("**外部を指す引数は拾わない**", () => {
    for (const keywords of [
      "REF(CUSTMST)",
      "REF(MYLIB/CUSTMST CUSTREC)",
      "REFFLD(CUSTREC/CUSTNO)",
      "MSGID(USR0001 MYLIB/MYMSGF)",
      "FONTNAME('Courier')",
      "SFLCTL(SUBFILE)",
      "ERASE(REC1 REC2)",
      "PASSRCD(RECKEEP)"
    ]) {
      assert.deepStrictEqual(findFieldReferences(keywords), [], keywords);
    }
  });

  test("引用符の中の空白で引数を割らない", () => {
    assert.deepStrictEqual(findFieldReferences("CHOICE(1 'あ い う' *SPACEB)"), []);
    assert.deepStrictEqual(
      findFieldReferences("CHOICE(1 &CHCTXT)").map(r => r.name),
      ["CHCTXT"]
    );
  });

  test("同じ綴りのキーワードが 2 つあっても別々に拾う", () => {
    assert.deepStrictEqual(
      findFieldReferences("DSPATR(RI) DSPATR(&ATR1) DSPATR(&ATR2)").map(r => r.name),
      ["ATR1", "ATR2"]
    );
  });
});

suite("参照の追随: 置き換える", () => {
  test("丸ごと一致だけを置き換える（一部一致では変えない）", () => {
    assert.strictEqual(
      renameFieldReferences("SFLCSRRRN(&CUSTNO2) CHCCTL(1 &CUSTNO)", "CUSTNO", "NEWNO"),
      "SFLCSRRRN(&CUSTNO2) CHCCTL(1 &NEWNO)"
    );
  });

  test("`&` は残す", () => {
    assert.strictEqual(
      renameFieldReferences("SFLCSRRRN(&RRN)", "RRN", "NEWRRN"),
      "SFLCSRRRN(&NEWRRN)"
    );
  });

  test("同じ欄に複数あれば全部置き換える（後ろから当てるので桁がずれない）", () => {
    assert.strictEqual(
      renameFieldReferences("CSRLOC(ROW ROW)", "ROW", "CURSORROW"),
      "CSRLOC(CURSORROW CURSORROW)"
    );
  });

  test("一致が無ければ**元のまま**の文字列を返す", () => {
    const keywords = "REF(CUSTMST) DSPATR(RI)";
    assert.strictEqual(renameFieldReferences(keywords, "CUSTMST", "X"), keywords);
  });
});

suite("参照の追随: 編集に組み込む", () => {
  const BASE = [
    "     A          R MAIN",
    "     A                                      CSRLOC(CSRROW CSRCOL)",
    "     A            CSRROW         3S 0H",
    "     A            CSRCOL         3S 0H",
    "     A            CUSTNO        10A  B  5  2",
    "     A            RRN            5S 0H",
    "     A                                      SFLCSRRRN(&RRN)"
  ];

  test("**名前を変えると CSRLOC の引数も変わる**", () => {
    const after = apply(BASE, [
      { kind: "setAttributes", sourceLine: 3, attributes: { name: "NEWROW" } }
    ]);
    assert.ok(after[2].includes("NEWROW"), "項目の名前が変わっていない");
    assert.ok(after[1].includes("CSRLOC(NEWROW CSRCOL)"), after[1]);
  });

  test("**`&` の参照も変わる**（様式の行にある）", () => {
    const after = apply(BASE, [
      { kind: "setAttributes", sourceLine: 6, attributes: { name: "NEWRRN" } }
    ]);
    assert.ok(after[5].includes("NEWRRN"), "項目の名前が変わっていない");
    assert.ok(after[6].includes("SFLCSRRRN(&NEWRRN)"), after[6]);
  });

  test("参照が無い項目の改名は他の行を変えない", () => {
    const after = apply(BASE, [
      { kind: "setAttributes", sourceLine: 5, attributes: { name: "NEWNO" } }
    ]);
    assert.strictEqual(after.length, BASE.length);
    assert.deepStrictEqual(
      after.filter((_, index) => index !== 4),
      BASE.filter((_, index) => index !== 4)
    );
  });

  test("**ファイル・レベルの参照も追う**", () => {
    const lines = [
      "     A                                      CSRLOC(CSRROW CSRCOL)",
      "     A          R MAIN",
      "     A            CSRROW         3S 0H",
      "     A            CSRCOL         3S 0H"
    ];
    const after = apply(lines, [
      { kind: "setAttributes", sourceLine: 3, attributes: { name: "NEWROW" } }
    ]);
    assert.ok(after[0].includes("CSRLOC(NEWROW CSRCOL)"), after[0]);
  });

  /** **黙って外部を壊さない。** ここが崩れると原因の分からない壊れ方をする。 */
  test("**REF の引数は同じ名前でも変わらない**", () => {
    const lines = [
      "     A                                      REF(CUSTNO)",
      "     A          R MAIN",
      "     A            CUSTNO        10A  B  5  2"
    ];
    const after = apply(lines, [
      { kind: "setAttributes", sourceLine: 3, attributes: { name: "NEWNO" } }
    ]);
    assert.ok(after[0].includes("REF(CUSTNO)"), `REF が書き換わった: ${after[0]}`);
    assert.ok(after[2].includes("NEWNO"));
  });

  test("同じ名前への改名では何も起きない", () => {
    const after = apply(BASE, [
      { kind: "setAttributes", sourceLine: 6, attributes: { name: "RRN" } }
    ]);
    assert.deepStrictEqual(after, BASE);
  });
});

suite("参照の追随: 判断の網羅", () => {
  /**
   * 追わないと決めたものは**理由つきで残す**。検査（`verify-dds-references.mjs`）が
   * 「まだ判断していない」と区別するために要る。
   */
  test("追わないと決めた一覧に理由がある", () => {
    assert.ok(NOT_FOLLOWED.size > 0);
    for (const [keyword, reason] of NOT_FOLLOWED) {
      assert.ok(reason.trim().length > 0, `${keyword} に理由が無い`);
      assert.strictEqual(keyword, keyword.toUpperCase(), `${keyword} が大文字でない`);
    }
  });
});
