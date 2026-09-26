import { strict as assert } from "node:assert";
import {
  isStreamTestFile,
  resolveStreamTestTarget,
  streamTestProgramName
} from "../../src/testing/streamTarget";

suite("IFS 方式のテスト（streamTarget）", () => {
  test("isStreamTestFile: *.test.rpgle / *.test.sqlrpgle を大文字小文字を問わず判定する", () => {
    assert.equal(isStreamTestFile("calc.test.rpgle"), true);
    assert.equal(isStreamTestFile("test/CALC.TEST.RPGLE"), true);
    assert.equal(isStreamTestFile("sql1.Test.SqlRpgle"), true);
    assert.equal(isStreamTestFile("src\\qtest\\x.test.sqlrpgle"), true);
    assert.equal(isStreamTestFile("calc.rpgle"), false, ".test が無ければメンバー方式の候補");
    assert.equal(isStreamTestFile("calc.test.rpgleinc"), false);
    assert.equal(isStreamTestFile(".test.rpgle"), false, "名前が空");
  });

  // 期待値は IBM i Testing の getSystemNameFromPath（IBM/vscode-ibmi-testing 259485a888 の api/apiUtils.ts 46-97 行）を
  // そのまま実行して採った（.aidev/works/20260926-rpgunit-ifs-deploy/decisions.md D7）。
  const fromIbmiTesting: readonly [string, string][] = [
    ["calc.test.rpgle", "TCALC"],
    ["CALC.TEST.RPGLE", "TCALC"],
    ["ifsbasic.test.rpgle", "TIFSBASIC"],
    ["verylongname.test.rpgle", "TVERYLONGN"],
    ["customerMaster.test.rpgle", "TCM"],
    ["UA_customerMaster.test.rpgle", "TUACM"],
    ["calc-日本語.test.rpgle", "TCALC"],
    ["abcdefghi.test.rpgle", "TABCDEFGHI"],
    ["abcdefghij.test.rpgle", "TABCDEFGHI"],
    ["IFSBIND.TEST.RPGLE", "TIFSBIND"],
    ["sql1.test.sqlrpgle", "TSQL1"],
    ["allupperlongname.test.rpgle", "TALLUPPERL"],
    ["1calc.test.rpgle", "T1CALC"],
    // 元の関数の癖が出る分岐: `_` が 2 つ以上なら 2 つ目までだけ使う／`-` より前が 10 文字超／大文字にすると長さが変わる文字
    ["ua_ab_customerMaster.test.rpgle", "TUAA"],
    ["customermasterfile-x.test.rpgle", "TCUSTOMERM"],
    ["straßeLongName.test.rpgle", "TSLN"]
  ];
  for (const [file, name] of fromIbmiTesting) {
    test(`streamTestProgramName: ${file} → ${name}（IBM i Testing と同じ）`, () => {
      assert.equal(streamTestProgramName(`test/${file}`), name);
    });
  }

  test("streamTestProgramName: IBM i の名前として不正なら undefined（IBM i Testing は TMY.CALC を返す）", () => {
    assert.equal(streamTestProgramName("my.calc.test.rpgle"), undefined);
  });

  test("streamTestProgramName: IFS 方式のファイルでなければ undefined", () => {
    assert.equal(streamTestProgramName("calc.rpgle"), undefined);
  });

  test("resolveStreamTestTarget: 相対パス・拡張子・名前をまとめる（区切りは / にそろえる）", () => {
    assert.deepEqual(resolveStreamTestTarget("test\\sub\\calc.test.SQLRPGLE"), {
      relativePath: "test/sub/calc.test.SQLRPGLE",
      extension: "sqlrpgle",
      program: "TCALC"
    });
    assert.deepEqual(resolveStreamTestTarget("my.calc.test.rpgle"), {
      relativePath: "my.calc.test.rpgle",
      extension: "rpgle",
      program: undefined
    });
    assert.equal(resolveStreamTestTarget("src/LIB/QRPGLESRC/CALC.rpgle"), undefined);
  });
});
