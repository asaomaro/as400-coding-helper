import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import { registerSeuColorMarkers } from "../../src/language/seuColorMarkers";

function editorFor(filename: string, text: string, languageId = "rpg-fixed") {
  let lines = text.split("\n");
  const calls: { ranges: vscode.Range[] }[] = [];
  return {
    document: {
      uri: vscode.Uri.file(filename),
      languageId,
      lineCount: lines.length,
      lineAt: (line: number) => ({ text: lines[line] })
    } as vscode.TextDocument,
    setDecorations(_type: vscode.TextEditorDecorationType, ranges: vscode.Range[]) {
      calls.push({ ranges });
    },
    setText(nextText: string) {
      lines = nextText.split("\n");
    },
    calls
  } as unknown as vscode.TextEditor & { calls: { ranges: vscode.Range[] }[] };
}

suite("SEU 色 marker decoration", () => {
  function resetStub(stub: any): void {
    stub.window.decorationTypes = [];
    stub.workspace.__textDocumentChangeListeners = [];
    stub.workspace.__configurationChangeListeners = [];
    stub.window.__activeTextEditorChangeListeners = [];
  }

  test("対象文書の marker 範囲を7色の decoration に分けて初期描画する", () => {
    const stub = vscode as unknown as any;
    resetStub(stub);
    stub.__setConfig({ "rpgClSupport.seuColors": { enabled: true } });
    const editor = editorFor("/workspace/src/LIB/SRC/MBR.rpg", "ŔABCŶ顧客");
    stub.window.activeTextEditor = editor;
    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;

    registerSeuColorMarkers(context);

    assert.equal(stub.window.decorationTypes.length, 7);
    assert.equal(editor.calls.length, 7);
    assert.deepEqual(editor.calls.filter(call => call.ranges.length > 0).map(call => call.ranges[0].start.character), [0, 4]);
  });

  test("対象外文書では既存 decoration をすべて解除する", () => {
    const stub = vscode as unknown as any;
    resetStub(stub);
    stub.__setConfig({ "rpgClSupport.seuColors": { enabled: true } });
    const editor = editorFor("/workspace/readme.txt", "ŔABC", "plaintext");
    stub.window.activeTextEditor = editor;
    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;

    registerSeuColorMarkers(context);

    assert.equal(editor.calls.length, 7);
    assert.ok(editor.calls.every(call => call.ranges.length === 0));
  });

  test("本文変更で再計算し、設定を無効化したらすべて解除する", () => {
    const stub = vscode as unknown as any;
    resetStub(stub);
    stub.__setConfig({ "rpgClSupport.seuColors": { enabled: true } });
    const editor = editorFor("/workspace/src/LIB/SRC/MBR.rpg", "ŔABC") as vscode.TextEditor & {
      calls: { ranges: vscode.Range[] }[];
      setText(text: string): void;
    };
    stub.window.activeTextEditor = editor;
    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;

    registerSeuColorMarkers(context);
    editor.setText("ŶDEF");
    stub.workspace.__fireTextDocumentChange({ document: editor.document });
    const changedCalls = editor.calls.slice(-7);
    assert.equal(changedCalls.filter(call => call.ranges.length > 0).length, 1);
    assert.equal(changedCalls.find(call => call.ranges.length > 0)!.ranges[0].start.character, 0);

    stub.__setConfig({ "rpgClSupport.seuColors": { enabled: false } });
    stub.workspace.__fireConfigurationChange({
      affectsConfiguration: (key: string) => key === "rpgClSupport.seuColors.enabled"
    });
    assert.ok(editor.calls.slice(-7).every(call => call.ranges.length === 0));
  });
});
