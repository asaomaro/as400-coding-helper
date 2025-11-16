import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import { getNextTabStop } from "../../language/rpgLayout";
import { isEditAllowedRange } from "../../language/rpgEditGuards";
import { isInScopeUri } from "../../utils/fileScope";
import { getLogicalCommandRange } from "../../language/clContinuation";

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

  test("getLogicalCommandRange expands across CL continuation lines", () => {
    const lines = [
      "PGM",
      "CALL PGM(MYPGM) +",
      "     PARM('A') +",
      "     PARM('B')",
      "ENDPGM"
    ];

    const document: Partial<vscode.TextDocument> = {
      lineCount: lines.length,
      lineAt(index: number) {
        return {
          lineNumber: index,
          text: lines[index]
        } as vscode.TextLine;
      }
    };

    const rangeWrapper = getLogicalCommandRange(
      document as vscode.TextDocument,
      2
    );

    assert.equal(rangeWrapper.range.start.line, 1);
    assert.equal(rangeWrapper.range.end.line, 3);
  });
});

