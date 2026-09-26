import { strict as assert } from "node:assert";
import { isCodeCoverageAvailable } from "../../src/testing/coverage";
import type { IbmiTestingConnection } from "../../src/testing/codeForIbmi";

function makeConnection(existsFor: readonly string[]): IbmiTestingConnection {
  return {
    uploadMemberContent: async () => true,
    runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
    runCommandSubmitted: async () => ({ completed: true }),
    downloadStreamfile: async () => "",
    writeStreamfile: async () => undefined,
    checkObjectExists: async object => existsFor.includes(`${object.library}/${object.name}`),
    runSQL: async () => [],
    tempDirectory: "/tmp",
    libraryList: [],
    currentLibrary: undefined,
    deploy: async () => ({ ok: false, reason: "unavailable" })
  };
}

suite("CODECOV 検出", () => {
  test("QGPLにCODECOVがあれば true", async () => {
    assert.equal(await isCodeCoverageAvailable(makeConnection(["QGPL/CODECOV"])), true);
  });

  test("QDEVTOOLSにCODECOVがあれば true", async () => {
    assert.equal(await isCodeCoverageAvailable(makeConnection(["QDEVTOOLS/CODECOV"])), true);
  });

  test("どちらにも無ければ false（SR-OSAKAの実機確認結果と一致）", async () => {
    assert.equal(await isCodeCoverageAvailable(makeConnection([])), false);
  });
});
