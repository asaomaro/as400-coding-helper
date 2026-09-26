import { strict as assert } from "node:assert";
import {
  buildCreateStreamTestCommand, buildCreateTestCommand, buildRunTestCommand, quoteClString
} from "../../src/testing/rpgunitCommands";

suite("RPGUnit command builder", () => {
  test("RUCRTRPG は SRCMBR に program と同じ値を使う（バインド無し・TGTCCSID(0)既定）", () => {
    assert.equal(
      buildCreateTestCommand({ library: "ASAOLIB", program: "CALCTST", sourceFile: "QUNITSRC" }),
      "RPGUNIT/RUCRTRPG TSTPGM(ASAOLIB/CALCTST) SRCFILE(ASAOLIB/QUNITSRC) SRCMBR(CALCTST) TGTCCSID(0)"
    );
  });

  test("noTgtCcsid が true なら TGTCCSID を付けない（v4.0.3.r 以前）", () => {
    assert.equal(
      buildCreateTestCommand({ library: "ASAOLIB", program: "CALCTST", sourceFile: "QUNITSRC", noTgtCcsid: true }),
      "RPGUNIT/RUCRTRPG TSTPGM(ASAOLIB/CALCTST) SRCFILE(ASAOLIB/QUNITSRC) SRCMBR(CALCTST)"
    );
  });

  test("BNDSRVPGM は修飾の無い名前を補わずに渡す（*LIBL で解決させる。D4）", () => {
    const cmd = buildCreateTestCommand({
      library: "ASAOLIB", program: "CALCTST", sourceFile: "QUNITSRC",
      bindServicePrograms: ["CALCSRV", "OTHERLIB/OTHERSRV"]
    });
    assert.equal(
      cmd,
      "RPGUNIT/RUCRTRPG TSTPGM(ASAOLIB/CALCTST) SRCFILE(ASAOLIB/QUNITSRC) SRCMBR(CALCTST) " +
      "BNDSRVPGM(CALCSRV OTHERLIB/OTHERSRV) TGTCCSID(0)"
    );
  });

  test("BNDDIR を BNDSRVPGM の後ろに付ける", () => {
    const cmd = buildCreateTestCommand({
      library: "ASAOLIB", program: "CALCTST", sourceFile: "QUNITSRC",
      bindServicePrograms: ["CALCSRV"], bindingDirectories: ["MYBND", "*LIBL/OTHERBND"]
    });
    assert.equal(
      cmd,
      "RPGUNIT/RUCRTRPG TSTPGM(ASAOLIB/CALCTST) SRCFILE(ASAOLIB/QUNITSRC) SRCMBR(CALCTST) " +
      "BNDSRVPGM(CALCSRV) BNDDIR(MYBND *LIBL/OTHERBND) TGTCCSID(0)"
    );
  });

  test("空配列なら BNDSRVPGM も BNDDIR も付けない", () => {
    assert.equal(
      buildCreateTestCommand({
        library: "ASAOLIB", program: "CALCTST", sourceFile: "QUNITSRC", bindServicePrograms: [], bindingDirectories: []
      }),
      "RPGUNIT/RUCRTRPG TSTPGM(ASAOLIB/CALCTST) SRCFILE(ASAOLIB/QUNITSRC) SRCMBR(CALCTST) TGTCCSID(0)"
    );
  });

  test("RUCALLTST はライブラリー修飾のTSTPGMとXMLSTMFを組み立てる（既定はORDER/RCLRSC省略）", () => {
    assert.equal(
      buildRunTestCommand({ library: "ASAOLIB", program: "CALCTST", xmlStmf: "/tmp/CALCTST.xml" }),
      "RPGUNIT/RUCALLTST TSTPGM(ASAOLIB/CALCTST) OUTPUT(*NONE) XMLSTMF('/tmp/CALCTST.xml')"
    );
  });

  test("order/reclaimResources を指定すると ORDER/RCLRSC が付く", () => {
    assert.equal(
      buildRunTestCommand({
        library: "ASAOLIB", program: "CALCTST", xmlStmf: "/tmp/CALCTST.xml",
        order: "reverse", reclaimResources: "always"
      }),
      "RPGUNIT/RUCALLTST TSTPGM(ASAOLIB/CALCTST) OUTPUT(*NONE) XMLSTMF('/tmp/CALCTST.xml') " +
      "ORDER(*REVERSE) RCLRSC(*ALWAYS)"
    );
  });

  test("IFS 方式: SRCSTMF と INCDIR（複数・順に）、バインドと TGTCCSID(0)", () => {
    assert.equal(
      buildCreateStreamTestCommand({
        library: "ASAOLIB", program: "TCALC", sourceStreamFile: "/tmp/ci/TCALC.rpgle",
        includeDirectories: ["/home/ASAO/builds/ws/test", "/home/ASAO/builds/ws"],
        bindServicePrograms: ["CALCSRV"], bindingDirectories: ["MYBND"]
      }),
      "RPGUNIT/RUCRTRPG TSTPGM(ASAOLIB/TCALC) SRCSTMF('/tmp/ci/TCALC.rpgle') " +
      "INCDIR('/home/ASAO/builds/ws/test' '/home/ASAO/builds/ws') BNDSRVPGM(CALCSRV) BNDDIR(MYBND) TGTCCSID(0)"
    );
  });

  test("IFS 方式: INCDIR が空なら付けない。noTgtCcsid なら TGTCCSID を付けない", () => {
    assert.equal(
      buildCreateStreamTestCommand({
        library: "L", program: "TX", sourceStreamFile: "/t/TX.sqlrpgle", includeDirectories: [], noTgtCcsid: true
      }),
      "RPGUNIT/RUCRTRPG TSTPGM(L/TX) SRCSTMF('/t/TX.sqlrpgle')"
    );
  });

  test("IFS のパスの ' は 2 つ重ねる（CL の文字列リテラル）", () => {
    assert.equal(quoteClString("/home/o'brien/x.rpgle"), "'/home/o''brien/x.rpgle'");
    assert.match(
      buildCreateStreamTestCommand({ library: "L", program: "TX", sourceStreamFile: "/a'b/TX.rpgle", includeDirectories: ["/a'b"] }),
      /SRCSTMF\('\/a''b\/TX\.rpgle'\) INCDIR\('\/a''b'\)/
    );
  });
});
