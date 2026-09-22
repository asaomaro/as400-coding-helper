import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import { buildDiscoveredTestFile, findTestProcedures } from "../../src/testing/discovery";

suite("RPGUnit test discovery", () => {
  test("固定長P仕様のtest始まりEXPORT手続きを検出する", () => {
    const source = [
      "     H NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)",
      "     PTESTPASS         B                   EXPORT",
      "     DTESTPASS         PI",
      "     C                   CALLP     iEqual(2:2)",
      "     PTESTPASS         E"
    ].join("\n");
    assert.deepEqual(findTestProcedures(source), [{ name: "TESTPASS", line: 1 }]);
  });

  test("testで始まらないEXPORT手続き（setUp等）は検出しない", () => {
    const source = [
      "     PSETUP            B                   EXPORT",
      "     DSETUP            PI",
      "     PSETUP            E",
      "     PTESTA            B                   EXPORT",
      "     DTESTA            PI",
      "     PTESTA            E"
    ].join("\n");
    assert.deepEqual(findTestProcedures(source), [{ name: "TESTA", line: 3 }]);
  });

  test("EXPORTが無いP仕様は検出しない", () => {
    const source = "     PTESTX            B\n";
    assert.deepEqual(findTestProcedures(source), []);
  });

  test("6桁目がPでなければP仕様として扱わない", () => {
    const source = "     DTESTX            B                   EXPORT\n";
    assert.deepEqual(findTestProcedures(source), []);
  });

  test("継続名前行（15桁を超える名前が`...`で続く）を読む", () => {
    const source = [
      "     PtestLongProcedureName...",
      "     P                 B                   EXPORT"
    ].join("\n");
    assert.deepEqual(findTestProcedures(source), [{ name: "TESTLONGPROCEDURENAME", line: 1 }]);
  });

  test("注記域(81-100桁)のEXPORTは拾わない", () => {
    const source = `     PTESTX            B${" ".repeat(56)}EXPORT\n`;
    assert.deepEqual(findTestProcedures(source), []);
  });

  test("自由形式の dcl-proc … export; を読む", () => {
    const source = "dcl-proc testFree export;\n  // 本体\nend-proc;\n";
    assert.deepEqual(findTestProcedures(source), [{ name: "TESTFREE", line: 0 }]);
  });

  test("buildDiscoveredTestFile はtest手続きが0件ならundefined", () => {
    const uri = vscode.Uri.file("/ws/src/TESTLIB/QUNITSRC/HELPER.rpgle");
    assert.equal(
      buildDiscoveredTestFile(uri, "src/TESTLIB/QUNITSRC/HELPER.rpgle", "     PHELPER B EXPORT\n"),
      undefined
    );
  });

  test("buildDiscoveredTestFile はresolveMemberTargetの規約に合わないパスならundefined", () => {
    const uri = vscode.Uri.file("/ws/other/TESTA.rpgle");
    const source = "     PTESTA            B                   EXPORT\n";
    assert.equal(buildDiscoveredTestFile(uri, "other/TESTA.rpgle", source), undefined);
  });

  test("buildDiscoveredTestFile はtargetとprocedures一覧をまとめて返す", () => {
    const uri = vscode.Uri.file("/ws/src/TESTLIB/QUNITSRC/CALCTST.rpgle");
    const source = "     PTESTADD          B                   EXPORT\n";
    const file = buildDiscoveredTestFile(uri, "src/TESTLIB/QUNITSRC/CALCTST.rpgle", source);
    assert.deepEqual(file, {
      uri,
      target: { library: "TESTLIB", sourceFile: "QUNITSRC", member: "CALCTST", extension: "rpgle", textDescription: undefined },
      procedures: [{ name: "TESTADD", line: 0 }]
    });
  });
});
