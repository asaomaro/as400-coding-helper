import { strict as assert } from "node:assert";
import { applyOps, parse } from "@as400/dds-core";
import { lineReplacement, splitLines } from "../../src/dds/edit";

const TEXT = ["line0", "line1", "line2", "line3"].join("\n") + "\n";

suite("置換範囲の写像（全文置換をしない・design DD6）", () => {
  test("変更行だけを取り出す", () => {
    const replacement = lineReplacement(TEXT, TEXT, { start: 1, end: 2 });
    assert.deepEqual(replacement, {
      startLine: 1,
      endLineExclusive: 2,
      lines: ["line1"]
    });
  });

  test("複数行の変更範囲を取り出す", () => {
    const replacement = lineReplacement(TEXT, TEXT, { start: 1, end: 3 });
    assert.deepEqual(replacement?.lines, ["line1", "line2"]);
  });

  test("**文書全体を返さない**（1 行の変更で 4 行を置換しない）", () => {
    const replacement = lineReplacement(TEXT, TEXT, { start: 2, end: 3 });
    assert.equal(replacement?.lines.length, 1);
    assert.notEqual(replacement?.endLineExclusive, 4);
  });

  test("変更が無ければ undefined（編集そのものを行わない）", () => {
    assert.equal(lineReplacement(TEXT, TEXT, { start: 0, end: 0 }), undefined);
    assert.equal(lineReplacement(TEXT, TEXT, { start: 3, end: 1 }), undefined);
  });

  test("行数を超える範囲は文書の行数で止める", () => {
    const replacement = lineReplacement(TEXT, TEXT, { start: 3, end: 99 });
    assert.deepEqual(replacement, {
      startLine: 3,
      endLineExclusive: 4,
      lines: ["line3"]
    });
  });

  test("CRLF でも行がずれない", () => {
    const crlf = ["a", "b", "c"].join("\r\n") + "\r\n";
    assert.deepEqual(lineReplacement(crlf, crlf, { start: 1, end: 2 })?.lines, ["b"]);
  });
});

suite("行分割（末尾の改行で空行を増やさない）", () => {
  test("末尾に改行がある場合", () => {
    assert.deepEqual(splitLines("A\nB\n"), ["A", "B"]);
  });

  test("末尾に改行が無い場合", () => {
    assert.deepEqual(splitLines("A\nB"), ["A", "B"]);
  });

  test("空文字は 0 行", () => {
    assert.deepEqual(splitLines(""), []);
  });
});

/** DDS の 1 行を桁どおりに組み立てる（core のテストヘルパと同じ流儀）。 */
function ln(spec: {
  rec?: string;
  name?: string;
  len?: number;
  type?: string;
  usage?: string;
  row?: number;
  col?: number;
  func?: string;
}): string {
  const cells = new Array<string>(80).fill(" ");
  const put = (start: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      cells[start - 1 + index] = text[index];
    }
  };
  put(6, "A");
  if (spec.rec !== undefined) {
    put(17, "R");
    put(19, spec.rec);
  }
  if (spec.name !== undefined) put(19, spec.name);
  if (spec.len !== undefined) put(30, String(spec.len).padStart(5));
  if (spec.type !== undefined) put(35, spec.type);
  if (spec.usage !== undefined) put(38, spec.usage);
  if (spec.row !== undefined) put(39, String(spec.row).padStart(3));
  if (spec.col !== undefined) put(42, String(spec.col).padStart(3));
  if (spec.func !== undefined) put(45, spec.func);
  return cells.join("").trimEnd();
}

suite("ドラッグ移動が文書に届くまで（AC1 / AC2 の机上検証）", () => {
  // provider が実際に通す経路をそのまま組み立てる:
  //   parse → applyOps → lineReplacement → その範囲だけ置換。
  // VSCode API に触るのは最後の WorkspaceEdit だけなので、そこ以外はここで固定できる。
  const source =
    [
      ln({ rec: "R1" }),
      ln({ row: 3, col: 2, func: "'NAME'" }),
      ln({ name: "FLD1", len: 10, type: "A", usage: "B", row: 3, col: 10 }),
      "     A* 触ってはいけないコメント行"
    ].join("\n") + "\n";

  function moveFirstField(line: number, pos: number) {
    const doc = parse(source);
    const item = doc.lines
      .filter(candidate => candidate.kind === "item")
      .map(candidate => (candidate as { item: { id: string; kind: string } }).item)
      .find(candidate => candidate.kind === "field");
    assert.ok(item, "フィールドが見つかること");
    const result = applyOps(doc, [
      { op: "moveItem", id: item.id, line, pos }
    ]);
    const replacement = lineReplacement(source, result.text, result.changedLines);
    assert.ok(replacement, "置換範囲が求まること");
    return { result, replacement };
  }

  test("39-44 桁（画面の行・桁）だけが書き換わる（AC1）", () => {
    const { replacement } = moveFirstField(7, 30);
    const before = splitLines(source)[2];
    const after = replacement.lines[0];

    assert.equal(after.slice(38, 41), "  7", "39-41 桁が新しい行になる");
    assert.equal(after.slice(41, 44), " 30", "42-44 桁が新しい桁になる");
    assert.equal(after.slice(0, 38), before.slice(0, 38), "38 桁目までは不変");
    assert.equal(after.slice(44), before.slice(44), "45 桁目以降は不変");
  });

  test("置換範囲は編集した 1 行だけ（AC2）", () => {
    const { replacement } = moveFirstField(7, 30);
    assert.equal(replacement.startLine, 2);
    assert.equal(replacement.endLineExclusive, 3);
    assert.equal(replacement.lines.length, 1);
  });

  test("その範囲だけ差し替えると、適用後テキストと完全に一致する", () => {
    // **provider が全文置換をしなくても結果が同じ**であることの確認。
    // ここがずれると「GUI で編集すると別の行が壊れる」という最悪の壊れ方になる。
    const { result, replacement } = moveFirstField(5, 4);
    const lines = splitLines(source);
    lines.splice(
      replacement.startLine,
      replacement.endLineExclusive - replacement.startLine,
      ...replacement.lines
    );
    assert.equal(lines.join("\n") + "\n", result.text);
  });

  test("コメント行は 1 バイトも変わらない（AC3）", () => {
    const { result } = moveFirstField(5, 4);
    assert.equal(splitLines(result.text)[3], splitLines(source)[3]);
  });
});

suite("4 操作すべてで置換結果が applyOps と一致する（review must-1 の回帰）", () => {
  // **ここが空いていたせいで、削除で行が複製される欠陥を通してしまった。**
  // 移動しか通していなかったので、行数が変わる操作（追加・削除）の座標系の取り違えに
  // 誰も気付けなかった。4 操作を同じ形で回して、provider がやる置換を再現して突き合わせる。
  const source =
    [
      ln({ rec: "R1" }),
      ln({ name: "FLD1", len: 5, type: "A", usage: "B", row: 3, col: 10 }),
      ln({ name: "FLD2", len: 5, type: "A", usage: "B", row: 5, col: 10 }),
      "     A* 触ってはいけないコメント行"
    ].join("\n") + "\n";

  /** provider がやる「範囲だけ差し替え」を、そのまま再現する。 */
  function spliced(ops: Parameters<typeof applyOps>[1]): {
    patched: string;
    expected: string;
  } {
    const result = applyOps(parse(source), ops);
    const replacement = lineReplacement(source, result.text, result.changedLines);
    const lines = splitLines(source);
    if (replacement !== undefined) {
      lines.splice(
        replacement.startLine,
        replacement.endLineExclusive - replacement.startLine,
        ...replacement.lines
      );
    }
    return { patched: lines.join("\n") + "\n", expected: result.text };
  }

  test("移動", () => {
    const { patched, expected } = spliced([
      { op: "moveItem", id: "R1#1", line: 9, pos: 20 }
    ]);
    assert.equal(patched, expected);
  });

  test("リサイズ", () => {
    const { patched, expected } = spliced([
      { op: "resizeItem", id: "R1#1", length: 8 }
    ]);
    assert.equal(patched, expected);
  });

  test("追加（行が 1 本増える）", () => {
    const { patched, expected } = spliced([
      {
        op: "addItem",
        record: "R1",
        item: {
          kind: "field",
          name: "NEW",
          length: 5,
          dataType: "A",
          usage: "B",
          line: 9,
          pos: 10
        }
      }
    ]);
    assert.equal(patched, expected);
  });

  test("**削除（行が 1 本減る）**", () => {
    const { patched, expected } = spliced([{ op: "removeItem", id: "R1#1" }]);
    assert.equal(patched, expected);
    assert.ok(
      patched.split("\n").filter(line => line.includes("コメント行")).length === 1,
      "コメント行が複製されている"
    );
  });

  test("削除しても他の行はバイト不変（AC2 / AC3）", () => {
    const { patched } = spliced([{ op: "removeItem", id: "R1#1" }]);
    const before = splitLines(source);
    const after = splitLines(patched);
    assert.equal(after.length, before.length - 1);
    assert.deepEqual(after, [before[0], before[2], before[3]]);
  });
});
