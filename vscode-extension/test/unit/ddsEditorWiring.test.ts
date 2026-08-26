import * as assert from "assert";
import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyDdsEdits,
  validateDdsEdits,
  type DdsEdit
} from "../../src/core/dds/ddsEdit";
import { buildDspfRenderModel } from "../../src/core/dds/dspfRenderModel";
import {
  DDS_EDITOR_VIEW_TYPE,
  registerDdsVisualEditor
} from "../../src/dds/editorProvider";

/**
 * エディタの配線と、編集が文書に届くまでの経路。
 *
 * AGENTS.md「追加したリソースは『到達可能』になって初めて完了」——
 * `ddsEdit` が正しくても、登録されていなければ画面には何も出ない。
 *
 * WebView の**中**は拡張ホストから触れないので、操作そのものは
 * 単独起動ハーネスの e2e（`dev/e2e.mjs`）が受け持つ。ここは**両端**を見る。
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const SAMPLE = join(ROOT, "docs", "src", "CUSTMNT.dspf");
const LINES = readFileSync(SAMPLE, "utf8").split(/\r?\n/u);

suite("DDS エディタ: 配線", () => {
  test("カスタムエディタとして登録される", () => {
    const context = { subscriptions: [], extensionUri: { fsPath: ROOT } };
    (vscode.window as unknown as { __customEditors?: unknown[] }).__customEditors = [];

    registerDdsVisualEditor(context as unknown as vscode.ExtensionContext);

    const registered = (
      vscode.window as unknown as {
        __customEditors: Array<{ viewType: string; options: Record<string, unknown> }>;
      }
    ).__customEditors;
    assert.strictEqual(registered.length, 1, "登録されていない");
    assert.strictEqual(registered[0].viewType, DDS_EDITOR_VIEW_TYPE);
    assert.strictEqual(
      registered[0].options.supportsMultipleEditorsPerDocument,
      false,
      "同じ文書を複数のエディタで開けてしまう"
    );
    assert.strictEqual(context.subscriptions.length, 1, "後片付けが登録されていない");
  });

  test("viewType は package.json の customEditors と一致する", () => {
    const manifest = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "..", "package.json"), "utf8")
    ) as {
      contributes: {
        customEditors?: Array<{ viewType: string; priority: string; selector: unknown[] }>;
      };
    };
    const editors = manifest.contributes.customEditors ?? [];
    assert.strictEqual(editors.length, 1);
    assert.strictEqual(editors[0].viewType, DDS_EDITOR_VIEW_TYPE);
    // **既定のエディタを奪わない。** option でないと .dspf をダブルクリックしたときに
    // テキストエディタが開かなくなり、ルーラー / SOSI / lint が使えなくなる。
    assert.strictEqual(editors[0].priority, "option", "既定エディタを奪っている");
  });
});

suite("DDS エディタ: 編集が文書に届くまで", () => {
  /** provider が通す経路をそのまま組み立てる（VSCode API に触るのは WorkspaceEdit だけ）。 */
  function apply(edits: readonly DdsEdit[]): string[] {
    assert.deepStrictEqual(validateDdsEdits(LINES, edits), [], "検証で弾かれた");
    const lines = [...LINES];
    for (const result of applyDdsEdits(LINES, edits)) {
      lines.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
    }
    return lines;
  }

  test("描画モデルの項目は、そのまま編集の宛先になる", () => {
    const model = buildDspfRenderModel(LINES);
    const item = model.items.find(candidate => candidate.resizable);
    assert.ok(item, "長さを変えられる項目が無い");

    const after = apply([{ kind: "resize", sourceLine: item.sourceLine, length: 12 }]);
    assert.strictEqual(Number(after[item.sourceLine - 1].slice(29, 34)), 12);
    assert.strictEqual(after.length, LINES.length, "行数が変わった");
  });

  test("移動しても対象行以外はバイト不変", () => {
    const model = buildDspfRenderModel(LINES);
    const item = model.items[0];
    const after = apply([
      { kind: "move", sourceLine: item.sourceLine, row: item.row + 1, column: item.column + 1 }
    ]);
    const changed = after
      .map((line, index) => (line === LINES[index] ? -1 : index))
      .filter(index => index >= 0);
    assert.deepStrictEqual(changed, [item.sourceLine - 1]);
  });

  test("実サンプルの項目がすべて描画モデルに載る", () => {
    const model = buildDspfRenderModel(LINES);
    assert.ok(model.items.length > 0);
    assert.ok(model.records.length >= 2, "複数様式のサンプルのはず");
    for (const item of model.items) {
      assert.ok(item.sourceLine > 0 && item.row > 0 && item.column > 0);
    }
  });
});
