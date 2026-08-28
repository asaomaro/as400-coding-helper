import * as assert from "assert";
import {
  applyDdsEdits,
  validateDdsEdits,
  type DdsEdit,
  type DdsEditRejectionCode
} from "../../src/core/dds/ddsEdit";
import {
  findRecordReferences,
  renameRecordReferences
} from "../../src/core/dds/ddsReferences";

/**
 * **様式（レコード）の改名と、その参照追随。**
 *
 * 実機で確かめたこと（IBM i 7.3 / `CRTDSPF`。
 * `.aidev/works/20260828-dds-record-rename/verify/probe-record-names.mjs`）:
 *
 * | 形 | 実機 |
 * |---|---|
 * | 同じ名前の様式が 2 つ | **通らない**（N1）→ 改名の衝突は拒否する |
 * | `SFLCTL` / `ERASE` / `PASSRCD` が存在しない様式を指す | **通らない**（N4/N6/N8） |
 * | 様式名 10 文字 / 11 文字 | 通る / 通らない（NC/ND） |
 * | `HLPRCD` が存在しない様式を指す | **通る**（H4）＝ コンパイラーは見ていない |
 * | `HLPRCD` にファイル名を添える | 通る（H5）＝ 外部を指す形 |
 *
 * `MNUBARDSP` / `MNUBARCHC` は**原典のみ**（実機で通る形を組めなかった）。
 */

function apply(lines: readonly string[], edits: readonly DdsEdit[]): string[] {
  assert.deepStrictEqual(validateDdsEdits(lines, edits, "DDS-DSPF"), [], "検証で弾かれた");
  const out = [...lines];
  for (const result of applyDdsEdits(lines, edits, "DDS-DSPF")) {
    out.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
  }
  return out;
}

function codes(lines: readonly string[], edits: readonly DdsEdit[]): DdsEditRejectionCode[] {
  return validateDdsEdits(lines, edits, "DDS-DSPF").map(rejection => rejection.code);
}

suite("様式の参照: 見つける", () => {
  test("SFLCTL / PASSRCD は 1 つ目の引数", () => {
    assert.deepStrictEqual(
      findRecordReferences("SFLCTL(SFLREC)").map(r => r.name),
      ["SFLREC"]
    );
    assert.deepStrictEqual(
      findRecordReferences("PASSRCD(RECKEEP)").map(r => r.name),
      ["RECKEEP"]
    );
  });

  test("ERASE は全部の引数（原典: 最大 20）", () => {
    assert.deepStrictEqual(
      findRecordReferences("ERASE(REC1 REC2 REC3)").map(r => r.name),
      ["REC1", "REC2", "REC3"]
    );
  });

  /** 原典: 「ファイル名を指定しない場合には…定義中のファイルに入っていなければなりません」 */
  test("**HLPRCD はファイル名が無いときだけ**", () => {
    assert.deepStrictEqual(
      findRecordReferences("HLPRCD(HELPREC)").map(r => r.name),
      ["HELPREC"]
    );
    assert.deepStrictEqual(findRecordReferences("HLPRCD(DFTHELP HELPFILE)"), []);
    assert.deepStrictEqual(findRecordReferences("HLPRCD(DFTHELP MYLIB/HELPFILE)"), []);
  });

  test("MNUBARCHC は 2 つ目の引数（1 つ目は番号・3 つ目はテキスト）", () => {
    assert.deepStrictEqual(
      findRecordReferences("MNUBARCHC(1 PULLREC 'File')").map(r => r.name),
      ["PULLREC"]
    );
  });

  /**
   * `MNUBARDSP` には `MNUBARDSP[(&pull-down-input)]` という形式がある。
   * **位置だけで決めると潜在フィールドの名前を様式名として書き換える。**
   */
  test("MNUBARDSP は `&` で始まる引数を様式名として拾わない", () => {
    assert.deepStrictEqual(
      findRecordReferences("MNUBARDSP(MBARREC &CHCFLD)").map(r => r.name),
      ["MBARREC"]
    );
    assert.deepStrictEqual(findRecordReferences("MNUBARDSP(&PULLIN)"), []);
  });

  test("**項目を指すキーワードは拾わない**（表が別）", () => {
    for (const keywords of [
      "CSRLOC(CSRROW CSRCOL)",
      "SFLCSRRRN(&RRN)",
      "REF(CUSTMST)",
      "REFFLD(CUSTREC/CUSTNO)"
    ]) {
      assert.deepStrictEqual(findRecordReferences(keywords), [], keywords);
    }
  });

  test("丸ごと一致だけを置き換える", () => {
    assert.strictEqual(
      renameRecordReferences("ERASE(REC1 REC10)", "REC1", "MAIN"),
      "ERASE(MAIN REC10)"
    );
  });
});

suite("様式の改名: 編集", () => {
  const BASE = [
    "     A                                      PASSRCD(SFLREC)",
    "     A          R SFLREC                    SFL",
    "     A            SFLFLD        10A  O  5  2",
    "     A          R CTLREC                    SFLCTL(SFLREC)",
    "     A                                      SFLSIZ(20)",
    "     A                                      ERASE(SFLREC)"
  ];

  test("**様式の名前が変わり、参照も一緒に変わる**", () => {
    const after = apply(BASE, [
      { kind: "renameRecord", sourceLine: 2, name: "NEWSFL" }
    ]);
    assert.ok(after[1].includes("R NEWSFL"), after[1]);
    assert.ok(after[3].includes("SFLCTL(NEWSFL)"), after[3]);
    assert.ok(after[5].includes("ERASE(NEWSFL)"), after[5]);
    assert.ok(after[0].includes("PASSRCD(NEWSFL)"), after[0]);
  });

  test("行数は変わらない", () => {
    const after = apply(BASE, [{ kind: "renameRecord", sourceLine: 2, name: "NEWSFL" }]);
    assert.strictEqual(after.length, BASE.length);
  });

  test("名前は大文字にそろう", () => {
    const after = apply(BASE, [{ kind: "renameRecord", sourceLine: 2, name: "newsfl" }]);
    assert.ok(after[1].includes("R NEWSFL"), after[1]);
    assert.ok(after[3].includes("SFLCTL(NEWSFL)"), after[3]);
  });

  test("参照されていない様式の改名は他の行を変えない", () => {
    const after = apply(BASE, [{ kind: "renameRecord", sourceLine: 4, name: "NEWCTL" }]);
    assert.deepStrictEqual(
      after.filter((_, index) => index !== 3),
      BASE.filter((_, index) => index !== 3)
    );
  });

  /** **項目の名前は巻き込まない。** 表が別なので `CSRLOC` は動かない。 */
  test("同じ名前の項目があっても項目の参照は変えない", () => {
    const lines = [
      "     A          R SFLREC                    CSRLOC(SFLREC CSRCOL)",
      "     A            SFLREC         3S 0H",
      "     A            CSRCOL         3S 0H"
    ];
    const after = apply(lines, [{ kind: "renameRecord", sourceLine: 1, name: "NEWREC" }]);
    assert.ok(after[0].includes("R NEWREC"), after[0]);
    assert.ok(after[0].includes("CSRLOC(SFLREC CSRCOL)"), `CSRLOC が変わった: ${after[0]}`);
    assert.ok(after[1].includes("SFLREC"), "項目の名前が変わった");
  });
});

suite("様式の改名: 拒否", () => {
  const TWO = [
    "     A          R REC1",
    "     A            F1            10A  B  5  2",
    "     A          R REC2",
    "     A            F2            10A  B  6  2"
  ];

  /** 実機 N1: 同じ名前の様式を 2 つ置くとコンパイルできない。 */
  test("**既にある様式の名前には変えられない**", () => {
    assert.deepStrictEqual(codes(TWO, [{ kind: "renameRecord", sourceLine: 1, name: "REC2" }]), [
      "record-name-duplicate"
    ]);
  });

  test("大文字小文字が違っても同じ名前とみなす", () => {
    assert.deepStrictEqual(codes(TWO, [{ kind: "renameRecord", sourceLine: 1, name: "rec2" }]), [
      "record-name-duplicate"
    ]);
  });

  test("自分の名前のままは拒否しない", () => {
    assert.deepStrictEqual(codes(TWO, [{ kind: "renameRecord", sourceLine: 1, name: "REC1" }]), []);
  });

  test("空の名前は拒否する", () => {
    assert.deepStrictEqual(codes(TWO, [{ kind: "renameRecord", sourceLine: 1, name: "  " }]), [
      "record-needs-name"
    ]);
  });

  /** 実機 NC / ND: 10 文字は通り、11 文字は通らない。 */
  test("11 桁の名前は拒否する", () => {
    assert.deepStrictEqual(
      codes(TWO, [{ kind: "renameRecord", sourceLine: 1, name: "ABCDEFGHIJK" }]),
      ["name-too-long"]
    );
    assert.deepStrictEqual(
      codes(TWO, [{ kind: "renameRecord", sourceLine: 1, name: "ABCDEFGHIJ" }]),
      []
    );
  });

  test("様式でない行を指すと拒否する", () => {
    assert.deepStrictEqual(codes(TWO, [{ kind: "renameRecord", sourceLine: 2, name: "X" }]), [
      "record-line-not-found"
    ]);
  });
});
