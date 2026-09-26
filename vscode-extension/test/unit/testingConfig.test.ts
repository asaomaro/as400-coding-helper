import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import { readTestingConfigs, resolveBinding, type TestingConfigSource } from "../../src/testing/testingConfig";

const stub = vscode as unknown as any;

const source = (path: string, json: unknown): TestingConfigSource => ({ path, text: JSON.stringify(json) });
const bind = (rucrtrpg: Record<string, unknown>) => ({ rpgunit: { rucrtrpg } });

suite("testing.json のバインド指定（resolveBinding）", () => {
  test("どちらも無ければ空（従来どおり）", () => {
    assert.deepEqual(resolveBinding(undefined, undefined), {
      ok: true, binding: { servicePrograms: [], bindingDirectories: [] }
    });
  });

  test("bndSrvPgm と bndDir を読む。大文字にし、修飾は足さない", () => {
    const r = resolveBinding(source("src/testing.json", bind({ bndSrvPgm: ["calcsrv", "mylib/other"], bndDir: [" Mybnd "] })), undefined);
    assert.deepEqual(r, { ok: true, binding: { servicePrograms: ["CALCSRV", "MYLIB/OTHER"], bindingDirectories: ["MYBND"] } });
  });

  test(".vscode/testing.json だけでも読む", () => {
    const r = resolveBinding(undefined, source(".vscode/testing.json", bind({ bndDir: ["BNDA"] })));
    assert.deepEqual(r, { ok: true, binding: { servicePrograms: [], bindingDirectories: ["BNDA"] } });
  });

  test("同じキーは最寄りが配列ごと勝ち、片方にしか無いキーはその値を採る", () => {
    const r = resolveBinding(
      source("src/testing.json", bind({ bndSrvPgm: ["NEAR"] })),
      source(".vscode/testing.json", bind({ bndSrvPgm: ["G1", "G2"], bndDir: ["GDIR"] }))
    );
    assert.deepEqual(r, { ok: true, binding: { servicePrograms: ["NEAR"], bindingDirectories: ["GDIR"] } });
  });

  test("ほかのキー（cOption・rucalltst など）は無視する", () => {
    const r = resolveBinding(source("t.json", {
      rpgunit: { rucrtrpg: { cOption: ["*EVENTF"], dbgView: "*SOURCE", bndSrvPgm: ["A"] }, rucalltst: { order: "*API" } },
      other: 1
    }), undefined);
    assert.deepEqual(r, { ok: true, binding: { servicePrograms: ["A"], bindingDirectories: [] } });
  });

  test("rpgunit や rucrtrpg が無ければ指定無し", () => {
    assert.deepEqual(resolveBinding(source("t.json", {}), undefined), {
      ok: true, binding: { servicePrograms: [], bindingDirectories: [] }
    });
    assert.deepEqual(resolveBinding(source("t.json", { rpgunit: {} }), undefined), {
      ok: true, binding: { servicePrograms: [], bindingDirectories: [] }
    });
  });

  test("空配列は付けない指定として空になる", () => {
    assert.deepEqual(resolveBinding(source("t.json", bind({ bndSrvPgm: [], bndDir: [] })), undefined), {
      ok: true, binding: { servicePrograms: [], bindingDirectories: [] }
    });
  });

  const errorCases: [string, TestingConfigSource, RegExp][] = [
    ["(a) JSON として読めない", { path: "src/testing.json", text: "{ bnd" }, /JSON として読めません/],
    ["読めない（ディレクトリ等）", { path: "src/testing.json", readError: "ファイルではなくディレクトリです" }, /読めません/],
    ["(b) 最上位が配列", source("src/testing.json", []), /最上位はオブジェクト/],
    ["(b) rpgunit が文字列", source("src/testing.json", { rpgunit: "x" }), /rpgunit はオブジェクト/],
    ["(b) rucrtrpg が配列", source("src/testing.json", { rpgunit: { rucrtrpg: [] } }), /rpgunit\.rucrtrpg はオブジェクト/],
    ["(b) bndSrvPgm が文字列", source("src/testing.json", bind({ bndSrvPgm: "CALCSRV" })), /bndSrvPgm は文字列の配列/],
    ["(b) bndDir に数値", source("src/testing.json", bind({ bndDir: [1] })), /bndDir は文字列の配列/],
    ["(c) 名前が長すぎる", source("src/testing.json", bind({ bndSrvPgm: ["ABCDEFGHIJK"] })), /"ABCDEFGHIJK"/],
    ["(c) 数字で始まる", source("src/testing.json", bind({ bndSrvPgm: ["1SRV"] })), /"1SRV"/],
    ["(c) 3 段の修飾", source("src/testing.json", bind({ bndSrvPgm: ["A/B/C"] })), /"A\/B\/C"/],
    ["(c) bndSrvPgm に *CURLIB は使えない", source("src/testing.json", bind({ bndSrvPgm: ["*CURLIB/X"] })), /"\*CURLIB\/X"/],
    ["(d) bndSrvPgm が 51 件", source("src/testing.json", bind({ bndSrvPgm: Array.from({ length: 51 }, (_, i) => `S${i}`) })), /50 件まで/],
    ["(d) bndDir が 11 件", source("src/testing.json", bind({ bndDir: Array.from({ length: 11 }, (_, i) => `D${i}`) })), /10 件まで/]
  ];
  for (const [label, bad, reason] of errorCases) {
    test(`誤り: ${label} → パスと理由を返す`, () => {
      const r = resolveBinding(bad, undefined);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.path, "src/testing.json");
        assert.match(r.reason, reason);
      }
    });
  }

  test("特殊値: bndSrvPgm の *LIBL、bndDir の *LIBL/*CURLIB/*USRLIBL は通る", () => {
    const r = resolveBinding(source("t.json", bind({
      bndSrvPgm: ["*libl/A"], bndDir: ["*LIBL/B", "*CURLIB/C", "*USRLIBL/D"]
    })), undefined);
    assert.deepEqual(r, { ok: true, binding: { servicePrograms: ["*LIBL/A"], bindingDirectories: ["*LIBL/B", "*CURLIB/C", "*USRLIBL/D"] } });
  });

  test("上書きされる .vscode 側の誤りも返す（合成の前に検査する）", () => {
    const r = resolveBinding(
      source("src/testing.json", bind({ bndDir: ["OK"] })),
      source(".vscode/testing.json", bind({ bndDir: Array.from({ length: 11 }, (_, i) => `D${i}`) }))
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.path, ".vscode/testing.json");
    }
  });

  test("両方が誤りなら最寄りを先に返す", () => {
    const r = resolveBinding({ path: "src/testing.json", text: "x" }, { path: ".vscode/testing.json", text: "y" });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.path, "src/testing.json");
    }
  });
});

suite("testing.json の探し方（readTestingConfigs）", () => {
  teardown(() => {
    stub.workspace.__workspaceFolder = undefined;
    stub.workspace.__relativePath = undefined;
    stub.workspace.fs.__existing = [];
    stub.workspace.fs.__directories = [];
    stub.workspace.fs.__contents.clear();
  });

  function setup(files: Record<string, string>): void {
    stub.workspace.__workspaceFolder = { uri: stub.Uri.file("/ws") };
    stub.workspace.fs.__existing = Object.keys(files);
    for (const [p, text] of Object.entries(files)) {
      stub.workspace.fs.__contents.set(p, text);
    }
  }
  const testFile = stub.Uri.file("/ws/src/ASAOLIB/QUNITSRC/CALCTST.rpgle");

  test("同じディレクトリの testing.json を最寄りとして読む", async () => {
    setup({ "/ws/src/ASAOLIB/QUNITSRC/testing.json": "{}", "/ws/src/testing.json": "{\"p\":1}" });
    const r = await readTestingConfigs(testFile);
    assert.equal(r.nearest?.text, "{}");
    assert.equal(r.global, undefined);
  });

  test("無ければ親へ遡る（ワークスペースのルートまで）", async () => {
    setup({ "/ws/testing.json": "{\"root\":1}" });
    const r = await readTestingConfigs(testFile);
    assert.equal(r.nearest?.text, "{\"root\":1}");
  });

  test("ワークスペースの外にある testing.json は読まない", async () => {
    setup({ "/testing.json": "{}" });
    const r = await readTestingConfigs(testFile);
    assert.equal(r.nearest, undefined);
  });

  test(".vscode/testing.json を別に読む", async () => {
    setup({ "/ws/.vscode/testing.json": "{\"g\":1}" });
    const r = await readTestingConfigs(testFile);
    assert.equal(r.global?.text, "{\"g\":1}");
    assert.equal(r.nearest, undefined);
  });

  test("ワークスペースフォルダーに属さないファイルでは何も読まない", async () => {
    stub.workspace.fs.__existing = ["/ws/src/ASAOLIB/QUNITSRC/testing.json"];
    stub.workspace.fs.__contents.set("/ws/src/ASAOLIB/QUNITSRC/testing.json", "{}");
    const r = await readTestingConfigs(testFile);
    assert.deepEqual(r, {});
  });

  test("testing.json という名前のディレクトリは読めない理由を持つ", async () => {
    setup({});
    stub.workspace.fs.__directories = ["/ws/src/ASAOLIB/QUNITSRC/testing.json"];
    const r = await readTestingConfigs(testFile);
    assert.match(r.nearest?.readError ?? "", /ディレクトリ/);
  });
});
