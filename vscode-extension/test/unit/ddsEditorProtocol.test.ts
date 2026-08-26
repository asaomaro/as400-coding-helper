import { strict as assert } from "node:assert";
import {
  parsePatchOps,
  parseWebviewMessage,
  VSCODE_HOST
} from "../../src/dds/webview/protocol";

suite("WebView メッセージの検証", () => {
  test("ready はそのまま通る", () => {
    assert.deepEqual(parseWebviewMessage({ type: "ready" }), { type: "ready" });
  });

  test("既知の 4 操作を含む patch が通る", () => {
    const message = parseWebviewMessage({
      type: "patch",
      ops: [
        { op: "moveItem", id: "R1#1", line: 3, pos: 10 },
        { op: "resizeItem", id: "R1#2", length: 8 },
        { op: "removeItem", id: "R1#3" },
        {
          op: "addItem",
          record: "R1",
          item: { kind: "field", name: "FLD1", length: 5, line: 2, pos: 4 }
        }
      ]
    });
    assert.equal(message?.type, "patch");
    assert.equal(message?.type === "patch" ? message.ops.length : 0, 4);
  });

  test("未知の型は弾く（例外は投げない）", () => {
    assert.equal(parseWebviewMessage({ type: "eval", code: "1" }), undefined);
    assert.equal(parseWebviewMessage(null), undefined);
    assert.equal(parseWebviewMessage("patch"), undefined);
    assert.equal(parseWebviewMessage(undefined), undefined);
  });

  test("openSource は 0 以上の整数だけ通る", () => {
    assert.deepEqual(parseWebviewMessage({ type: "openSource", sourceLine: 0 }), {
      type: "openSource",
      sourceLine: 0
    });
    assert.equal(
      parseWebviewMessage({ type: "openSource", sourceLine: -1 }),
      undefined
    );
    assert.equal(
      parseWebviewMessage({ type: "openSource", sourceLine: 1.5 }),
      undefined
    );
    assert.equal(
      parseWebviewMessage({ type: "openSource", sourceLine: "3" }),
      undefined
    );
  });
});

suite("パッチ操作の検証（部分適用しない）", () => {
  test("1 つでも不正なら列ごと捨てる", () => {
    const ops = parsePatchOps([
      { op: "moveItem", id: "R1#1", line: 3, pos: 10 },
      { op: "moveItem", id: "R1#2", line: "3", pos: 10 }
    ]);
    assert.equal(ops, undefined, "3 件中 2 件だけ通る状態を作らない");
  });

  test("空配列・配列以外は弾く", () => {
    assert.equal(parsePatchOps([]), undefined);
    assert.equal(parsePatchOps({ op: "moveItem" }), undefined);
    assert.equal(parsePatchOps(undefined), undefined);
  });

  test("未知の op は弾く", () => {
    assert.equal(parsePatchOps([{ op: "renameItem", id: "R1#1" }]), undefined);
  });

  test("moveItem は整数の行桁を要求する", () => {
    assert.equal(
      parsePatchOps([{ op: "moveItem", id: "R1#1", line: 3.5, pos: 10 }]),
      undefined
    );
    assert.equal(
      parsePatchOps([{ op: "moveItem", id: "", line: 3, pos: 10 }]),
      undefined
    );
  });

  test("addItem は kind と行桁を要求する", () => {
    assert.equal(
      parsePatchOps([
        { op: "addItem", record: "R1", item: { kind: "unknown", line: 1, pos: 1 } }
      ]),
      undefined
    );
    assert.equal(
      parsePatchOps([
        { op: "addItem", record: "R1", item: { kind: "field", pos: 1 } }
      ]),
      undefined,
      "line が無い追加は通さない"
    );
  });

  test("addItem の欄は型だけ見る（意味の判断は core に任せる）", () => {
    // 長さ 0 は DDS としては不正だが、それを弾くのは validate の仕事。
    // ここで判断を持つと真実源が 2 つになる。
    const ops = parsePatchOps([
      {
        op: "addItem",
        record: "R1",
        item: { kind: "field", name: "F", length: 0, decimals: 2, line: 1, pos: 1 }
      }
    ]);
    assert.equal(ops?.length, 1);
  });
});

suite("ホスト能力の宣言（design DD8）", () => {
  test("VSCode ホストは保存・undo・パレットを肩代わりする", () => {
    assert.equal(VSCODE_HOST.name, "vscode");
    assert.ok(VSCODE_HOST.providesFileIO);
    assert.ok(VSCODE_HOST.providesUndo);
    assert.ok(VSCODE_HOST.providesCommandPalette);
    assert.ok(VSCODE_HOST.canOpenTextEditor);
  });
});
