import * as assert from "assert";
import {
  parseEdits,
  parseEditorMessage,
  STANDALONE_HOST,
  VSCODE_HOST
} from "../../src/dds/webview/protocol";

/**
 * UI ↔ ホストの契約。**不正なメッセージで編集が止まらないこと**を守る。
 *
 * 例外を投げないのは、投げてもホスト側で握り潰すしかなく、
 * 1 通の不正メッセージでエディタが死ぬほうが害が大きいため。
 */

suite("エディタのメッセージ検証", () => {
  test("ready はそのまま通る", () => {
    assert.deepStrictEqual(parseEditorMessage({ type: "ready" }), { type: "ready" });
  });

  test("4 操作を含む edit が通る", () => {
    const message = parseEditorMessage({
      type: "edit",
      edits: [
        { kind: "move", sourceLine: 3, row: 5, column: 10 },
        { kind: "resize", sourceLine: 4, length: 8 },
        { kind: "remove", sourceLine: 5 },
        {
          kind: "add",
          recordName: "R1",
          item: { kind: "field", name: "F1", length: 5, row: 2, column: 4 }
        }
      ]
    });
    assert.strictEqual(message?.type, "edit");
    assert.strictEqual(message.type === "edit" ? message.edits.length : 0, 4);
  });

  test("未知の型・null・文字列は弾く（例外は投げない）", () => {
    assert.strictEqual(parseEditorMessage({ type: "eval", code: "1" }), undefined);
    assert.strictEqual(parseEditorMessage(null), undefined);
    assert.strictEqual(parseEditorMessage("edit"), undefined);
    assert.strictEqual(parseEditorMessage(undefined), undefined);
  });

  test("**1 つでも不正なら列ごと捨てる**（部分適用を入口でも作らない）", () => {
    assert.strictEqual(
      parseEdits([
        { kind: "move", sourceLine: 3, row: 5, column: 10 },
        { kind: "move", sourceLine: 4, row: "5", column: 10 }
      ]),
      undefined
    );
  });

  test("空配列・配列以外・未知の操作は弾く", () => {
    assert.strictEqual(parseEdits([]), undefined);
    assert.strictEqual(parseEdits({ kind: "move" }), undefined);
    assert.strictEqual(parseEdits([{ kind: "rename", sourceLine: 1 }]), undefined);
  });

  test("行番号・行・桁は正の整数だけ通る", () => {
    assert.strictEqual(parseEdits([{ kind: "move", sourceLine: 0, row: 1, column: 1 }]), undefined);
    assert.strictEqual(parseEdits([{ kind: "move", sourceLine: 1, row: 1.5, column: 1 }]), undefined);
    assert.strictEqual(parseEdits([{ kind: "remove", sourceLine: -1 }]), undefined);
  });

  test("欄の意味は core に任せる（型だけ見る）", () => {
    // 長さ 0 は DDS としては不正だが、それを弾くのは validateDdsEdits の仕事。
    // ここで判断を持つと同じ規則が 2 か所になる。
    const edits = parseEdits([
      {
        kind: "add",
        recordName: "R1",
        item: { kind: "field", name: "F", length: 0, row: 1, column: 1 }
      }
    ]);
    assert.strictEqual(edits?.length, 1);
  });

  test("askItem は種別と位置を要求する", () => {
    assert.deepStrictEqual(parseEditorMessage({ type: "askItem", kind: "field", row: 1, column: 2 }), {
      type: "askItem",
      kind: "field",
      row: 1,
      column: 2
    });
    assert.strictEqual(parseEditorMessage({ type: "askItem", kind: "other", row: 1, column: 2 }), undefined);
  });
});

suite("ホスト能力の宣言", () => {
  test("VSCode は保存と undo を肩代わりする", () => {
    assert.ok(VSCODE_HOST.providesFileIO && VSCODE_HOST.providesUndo && VSCODE_HOST.canOpenSource);
  });

  test("単独起動は肩代わりしない（UI の外側が自前で持つ）", () => {
    assert.ok(!STANDALONE_HOST.providesFileIO && !STANDALONE_HOST.providesUndo);
  });
});
