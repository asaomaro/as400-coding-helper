import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import {
  toDocumentSymbols,
  toLineReader,
  toSymbolKind,
  type OutlineKind,
  type OutlineNode
} from "../../src/language/outlineTypes";

/** OutlineKind の全種別。新しい種別を足したらここにも足す（写像の網羅を固定する）。 */
const ALL_KINDS: OutlineKind[] = [
  "record",
  "field",
  "key",
  "select",
  "join",
  "help",
  "command",
  "parm",
  "elem",
  "qual",
  "dep",
  "pmtctl"
];

function node(
  name: string,
  kind: OutlineKind,
  children: OutlineNode[] = []
): OutlineNode {
  const range = { startLine: 0, startChar: 0, endLine: 0, endChar: 10 };
  return { name, detail: "", kind, range, selectionRange: range, children };
}

suite("アウトラインの共通型", () => {
  test("すべての OutlineKind が SymbolKind に写る", () => {
    for (const kind of ALL_KINDS) {
      const mapped = toSymbolKind(kind);
      assert.equal(
        typeof mapped,
        "number",
        `${kind} に対応する SymbolKind が無い`
      );
    }
  });

  test("DDS と .cmd で意味の違う種別に別のアイコンが当たる", () => {
    // レコード様式・フィールド・キーは見分けが付かないと階層の意味が伝わらない。
    assert.equal(toSymbolKind("record"), vscode.SymbolKind.Struct);
    assert.equal(toSymbolKind("field"), vscode.SymbolKind.Field);
    assert.equal(toSymbolKind("key"), vscode.SymbolKind.Key);
    assert.notEqual(toSymbolKind("record"), toSymbolKind("field"));
    assert.notEqual(toSymbolKind("field"), toSymbolKind("key"));
  });

  test("toDocumentSymbols は子を再帰的に変換する", () => {
    const symbols = toDocumentSymbols([
      node("REC", "record", [node("FLD", "field", [node("DEEP", "key")])])
    ]);

    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].name, "REC");
    assert.equal(symbols[0].children.length, 1);
    assert.equal(symbols[0].children[0].name, "FLD");
    assert.equal(symbols[0].children[0].children[0].name, "DEEP");
    assert.equal(symbols[0].children[0].children[0].kind, vscode.SymbolKind.Key);
  });

  test("range が vscode.Range に写る", () => {
    const symbols = toDocumentSymbols([node("X", "field")]);

    assert.equal(symbols[0].range.start.line, 0);
    assert.equal(symbols[0].range.end.character, 10);
  });

  test("空配列を渡しても落ちない", () => {
    assert.deepEqual(toDocumentSymbols([]), []);
  });

  suite("toLineReader", () => {
    test("範囲外の行番号には空文字を返す", () => {
      const { lineAt, lineCount } = toLineReader("a\nb");

      assert.equal(lineCount, 2);
      assert.equal(lineAt(0), "a");
      assert.equal(lineAt(1), "b");
      assert.equal(lineAt(2), "");
      assert.equal(lineAt(-1), "");
    });

    test("CRLF でも行が割れる", () => {
      const { lineAt, lineCount } = toLineReader("a\r\nb");

      assert.equal(lineCount, 2);
      assert.equal(lineAt(0), "a");
      assert.equal(lineAt(1), "b");
    });
  });
});
