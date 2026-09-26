import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import { buildDiscoveredTestFile, discoverTestFiles, findTestProcedures, isDiscoveredStreamTest } from "../../src/testing/discovery";

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

  const TEST_SOURCE = "     PTESTADD          B                   EXPORT\n";

  test("buildDiscoveredTestFile: *.test.rpgle は置き場所を問わず IFS 方式（相対パス・拡張子・名前）", () => {
    const uri = vscode.Uri.file("/ws/test/calc/calc.test.rpgle");
    assert.deepEqual(buildDiscoveredTestFile(uri, "test/calc/calc.test.rpgle", TEST_SOURCE), {
      uri,
      stream: { relativePath: "test/calc/calc.test.rpgle", extension: "rpgle", program: "TCALC" },
      procedures: [{ name: "TESTADD", line: 0 }]
    });
  });

  test("buildDiscoveredTestFile: *.test.sqlrpgle・大文字の接尾辞も IFS 方式", () => {
    const sql = buildDiscoveredTestFile(vscode.Uri.file("/ws/q.test.sqlrpgle"), "q.test.sqlrpgle", TEST_SOURCE);
    assert.ok(sql && isDiscoveredStreamTest(sql) && sql.stream.extension === "sqlrpgle");
    const upper = buildDiscoveredTestFile(vscode.Uri.file("/ws/T/IFSBIND.TEST.RPGLE"), "T/IFSBIND.TEST.RPGLE", TEST_SOURCE);
    assert.ok(upper && isDiscoveredStreamTest(upper) && upper.stream.program === "TIFSBIND");
  });

  test("buildDiscoveredTestFile: src/<LIB>/<SRCFILE>/ の下でも *.test.rpgle は IFS 方式だけ。X.rpgle はメンバー方式だけ（AC14）", () => {
    const stream = buildDiscoveredTestFile(vscode.Uri.file("/ws/src/L/F/x.test.rpgle"), "src/L/F/x.test.rpgle", TEST_SOURCE);
    assert.ok(stream && isDiscoveredStreamTest(stream));
    const member = buildDiscoveredTestFile(vscode.Uri.file("/ws/src/L/F/X.rpgle"), "src/L/F/X.rpgle", TEST_SOURCE);
    assert.ok(member && !isDiscoveredStreamTest(member) && member.target.member === "X");
  });

  test("buildDiscoveredTestFile: `-` を含む *.test.rpgle も IFS 方式（メンバー CALC・テキスト add.test と読まない。D14）", () => {
    const file = buildDiscoveredTestFile(vscode.Uri.file("/ws/src/L/F/calc-add.test.rpgle"), "src/L/F/calc-add.test.rpgle", TEST_SOURCE);
    assert.ok(file && isDiscoveredStreamTest(file) && file.stream.program === "TCALC");
    const member = buildDiscoveredTestFile(vscode.Uri.file("/ws/src/L/F/CALC-add.rpgle"), "src/L/F/CALC-add.rpgle", TEST_SOURCE);
    assert.ok(member && !isDiscoveredStreamTest(member) && member.target.textDescription === "add", "`.test` が無ければいままでどおり");
  });

  test("buildDiscoveredTestFile: 名前を作れない IFS 方式も出す（実行時に errored にする）", () => {
    const file = buildDiscoveredTestFile(vscode.Uri.file("/ws/my.calc.test.rpgle"), "my.calc.test.rpgle", TEST_SOURCE);
    assert.ok(file && isDiscoveredStreamTest(file) && file.stream.program === undefined);
  });

  test("discoverTestFiles: メンバー方式と IFS 方式を同時に出し、2 つの glob に当たる同じファイルは 1 つにする", async () => {
    const stub = vscode as unknown as any;
    const member = stub.Uri.file("/ws/src/ASAOLIB/QUNITSRC/CALCTST.rpgle");
    const inSrc = stub.Uri.file("/ws/src/ASAOLIB/QUNITSRC/x.test.rpgle");
    const outside = stub.Uri.file("/ws/test/calc.test.rpgle");
    const patterns: string[] = [];
    const excludes: unknown[] = [];
    stub.workspace.__findFilesResult = (include: { pattern: string }, exclude: unknown) => {
      patterns.push(include.pattern);
      excludes.push(exclude);
      return include.pattern.startsWith("src/") ? [member, inSrc] : [inSrc, outside];
    };
    const relative = new Map([
      [member.fsPath, "src/ASAOLIB/QUNITSRC/CALCTST.rpgle"],
      [inSrc.fsPath, "src/ASAOLIB/QUNITSRC/x.test.rpgle"],
      [outside.fsPath, "test/calc.test.rpgle"]
    ]);
    stub.workspace.__relativePath = (uri: { fsPath: string }) => relative.get(uri.fsPath);
    for (const uri of [member, inSrc, outside]) {
      stub.workspace.fs.__contents.set(uri.fsPath, TEST_SOURCE);
    }
    try {
      const files = await discoverTestFiles([{ uri: stub.Uri.file("/ws"), name: "ws", index: 0 }]);
      assert.deepEqual(
        files.map(f => isDiscoveredStreamTest(f) ? `stream:${f.stream.relativePath}` : `member:${f.target.member}`),
        ["member:CALCTST", "stream:src/ASAOLIB/QUNITSRC/x.test.rpgle", "stream:test/calc.test.rpgle"]
      );
      assert.equal(patterns.length, 2);
      assert.deepEqual(excludes, [undefined, "**/node_modules/**"], "IFS 方式の走査は node_modules を除く");
    } finally {
      stub.workspace.__findFilesResult = [];
      stub.workspace.__relativePath = undefined;
      stub.workspace.fs.__contents.clear();
    }
  });
});
