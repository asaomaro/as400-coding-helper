import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import { getNextTabStop } from "../../src/language/rpgLayout";
import { isEditAllowedRange } from "../../src/language/rpgEditGuards";
import {
  isInScopeUri,
  isInScopeDocument,
  TARGET_EXTENSIONS
} from "../../src/utils/fileScope";
import { getLogicalCommandRange } from "../../src/language/clContinuation";

suite("Editing behaviors", () => {
  test("getNextTabStop returns increasing stops", () => {
    const first = getNextTabStop(0);
    const second = getNextTabStop(first ?? 0);
    assert.ok(first && second, "Expected at least two tab stops");
    assert.ok(
      (first as number) < (second as number),
      "Tab stops should be increasing"
    );
  });

  test("isEditAllowedRange enforces FR-031 restriction on line 4", () => {
    const dummyDocument = {} as unknown as vscode.TextDocument;

    const forbiddenRange = new vscode.Range(
      new vscode.Position(3, 0),
      new vscode.Position(3, 5)
    );
    const allowedRange = new vscode.Range(
      new vscode.Position(3, 6),
      new vscode.Position(3, 10)
    );

    assert.equal(
      isEditAllowedRange(dummyDocument, forbiddenRange),
      false,
      "Expected edits at columns 0–5 on line 4 to be forbidden"
    );
    assert.equal(
      isEditAllowedRange(dummyDocument, allowedRange),
      true,
      "Expected edits at columns 6+ on line 4 to be allowed"
    );
  });

  test("isInScopeUri recognizes .rpgle and .clp", () => {
    const rpgUri = vscode.Uri.file("/workspace/src/sample.rpgle");
    const clUri = vscode.Uri.file("/workspace/src/sample.clp");
    const txtUri = vscode.Uri.file("/workspace/src/sample.txt");

    assert.equal(isInScopeUri(rpgUri), true);
    assert.equal(isInScopeUri(clUri), true);
    assert.equal(isInScopeUri(txtUri), false);
  });

  test("isInScopeUri covers all target extensions (issue #4)", () => {
    for (const ext of TARGET_EXTENSIONS) {
      const uri = vscode.Uri.file(`/workspace/src/sample.${ext}`);
      assert.equal(
        isInScopeUri(uri),
        true,
        `Expected .${ext} to be in scope`
      );
    }
  });

  test("isInScopeUri is case-insensitive for the extension", () => {
    assert.equal(isInScopeUri(vscode.Uri.file("/ws/SAMPLE.DDS")), true);
    assert.equal(isInScopeUri(vscode.Uri.file("/ws/Sample.Prtf")), true);
  });

  test("isInScopeUri rejects non-target extensions", () => {
    assert.equal(isInScopeUri(vscode.Uri.file("/ws/a.ts")), false);
    assert.equal(isInScopeUri(vscode.Uri.file("/ws/a.txt")), false);
    assert.equal(isInScopeUri(vscode.Uri.file("/ws/a.cmdx")), false);
  });

  test("isInScopeDocument matches by languageId or target extension", () => {
    const byLanguage = {
      languageId: "rpg-fixed",
      uri: vscode.Uri.file("/ws/no-extension")
    } as unknown as vscode.TextDocument;
    const byExtension = {
      languageId: "plaintext",
      uri: vscode.Uri.file("/ws/report.prtf")
    } as unknown as vscode.TextDocument;
    const outOfScope = {
      languageId: "plaintext",
      uri: vscode.Uri.file("/ws/notes.txt")
    } as unknown as vscode.TextDocument;

    assert.equal(isInScopeDocument(byLanguage), true);
    assert.equal(isInScopeDocument(byExtension), true);
    assert.equal(isInScopeDocument(outOfScope), false);
  });

  test("getLogicalCommandRange expands across CL continuation lines", () => {
    const lines = [
      "PGM",
      "CALL PGM(MYPGM) +",
      "     PARM('A') +",
      "     PARM('B')",
      "ENDPGM"
    ];

    // lineAt は number と Position の 2 つの形を持つ。テストでは行番号しか
    // 使わないので、番号を受ける形だけ用意して型を合わせる。
    const document: Partial<vscode.TextDocument> = {
      lineCount: lines.length,
      lineAt: ((index: number | vscode.Position) => {
        const line = typeof index === "number" ? index : index.line;
        return { lineNumber: line, text: lines[line] } as vscode.TextLine;
      }) as vscode.TextDocument["lineAt"]
    };

    const rangeWrapper = getLogicalCommandRange(
      document as vscode.TextDocument,
      2
    );

    assert.equal(rangeWrapper.range.start.line, 1);
    assert.equal(rangeWrapper.range.end.line, 3);
  });
});

