import { strict as assert } from "node:assert";
import { buildCreateTestCommand, buildRunTestCommand } from "../../src/testing/rpgunitCommands";

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

  test("BNDSRVPGM はライブラリー修飾の無い名前に library を補う", () => {
    const cmd = buildCreateTestCommand({
      library: "ASAOLIB", program: "CALCTST", sourceFile: "QUNITSRC",
      bindServicePrograms: ["CALCSRV", "OTHERLIB/OTHERSRV"]
    });
    assert.equal(
      cmd,
      "RPGUNIT/RUCRTRPG TSTPGM(ASAOLIB/CALCTST) SRCFILE(ASAOLIB/QUNITSRC) SRCMBR(CALCTST) " +
      "BNDSRVPGM(ASAOLIB/CALCSRV OTHERLIB/OTHERSRV) TGTCCSID(0)"
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
});
