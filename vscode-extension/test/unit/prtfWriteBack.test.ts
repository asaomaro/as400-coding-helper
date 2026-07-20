import * as assert from "assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hasExplicitRow,
  writeBackPosition
} from "../../src/core/dds/prtfWriteBack";
import { resolvePrtfLayout } from "../../src/core/dds/prtfLayout";

/**
 * 位置欄の書き戻し。
 *
 * 見るのは **位置欄以外の桁が 1 文字も変わらないこと**。
 * `applyChanges` が「指定した桁だけを置き換え、他を壊さない」形を確立して
 * いるので、それを踏襲する。
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const SAMPLE = join(ROOT, "docs", "src", "CUSTRPT.prtf");

/** 位置欄（39-44 桁）以外が変わっていないことを確かめる。 */
function assertOnlyPositionChanged(before: string, after: string): void {
  const head = (text: string) => text.slice(0, 38); // 1-38 桁
  const tail = (text: string) => text.slice(44); // 45 桁目以降
  assert.strictEqual(head(after), head(before), "1-38 桁が変わっている");
  assert.strictEqual(
    tail(after).trimEnd(),
    tail(before).trimEnd(),
    "45 桁目以降が変わっている"
  );
}

suite("PRTF: 位置欄の書き戻し", () => {
  const line =
    " ".repeat(5) + "A" + " ".repeat(12) + "CUSTNO".padEnd(10) + "R    " +
    " ".repeat(9) + "  5" + "EDTCDE(1)";

  test("行と桁を右詰めで書く", () => {
    const after = writeBackPosition({ line, row: 12, column: 34 });
    assert.strictEqual(after.slice(38, 41), " 12", "39-41 桁（行）");
    assert.strictEqual(after.slice(41, 44), " 34", "42-44 桁（桁）");
  });

  test("位置欄以外の桁は 1 文字も変わらない", () => {
    const after = writeBackPosition({ line, row: 12, column: 34 });
    assertOnlyPositionChanged(line, after);
  });

  test("3 桁いっぱいの値も書ける", () => {
    const after = writeBackPosition({ line, row: 255, column: 132 });
    assert.strictEqual(after.slice(38, 41), "255");
    assert.strictEqual(after.slice(41, 44), "132");
  });

  test("省略すると位置欄を空にする", () => {
    const placed = writeBackPosition({ line, row: 5, column: 10 });
    const cleared = writeBackPosition({ line: placed, column: 10 });
    assert.strictEqual(cleared.slice(38, 41), "   ", "行が空になっていない");
    assert.strictEqual(cleared.slice(41, 44), " 10", "桁は残る");
  });

  test("行が短くても書き込む位置まで伸ばす", () => {
    const short = " ".repeat(5) + "A" + " ".repeat(12) + "F1";
    const after = writeBackPosition({ line: short, row: 3, column: 7 });
    assert.strictEqual(after.slice(38, 41), "  3");
    assert.strictEqual(after.slice(41, 44), "  7");
    assert.ok(after.startsWith(short), "元の内容が保たれていない");
  });

  test("行末に余計な空白を残さない", () => {
    const after = writeBackPosition({ line: " ".repeat(5) + "A", row: 1, column: 1 });
    assert.strictEqual(after, after.trimEnd());
  });
});

suite("PRTF: 書き戻しの往復", () => {
  test("書いた位置がレイアウト解決で読み戻せる", () => {
    const lines = [
      "     A          R REC",
      " ".repeat(5) + "A" + " ".repeat(12) + "F1".padEnd(10) + "   10"
    ];
    const moved = [lines[0]!, writeBackPosition({ line: lines[1]!, row: 7, column: 20 })];
    const item = resolvePrtfLayout(moved).items[0];
    assert.strictEqual(item?.row, 7);
    assert.strictEqual(item?.column, 20);
    assert.strictEqual(item?.width, 10, "長さ欄が壊れていない");
  });

  test("実サンプルの各行を無変更で書き戻しても行が変わらない", () => {
    // 位置欄に元の値をそのまま書き戻す。1 文字も変わってはいけない。
    const lines = readFileSync(SAMPLE, "utf8").split(/\r?\n/);
    const layout = resolvePrtfLayout(lines);

    for (const item of layout.items) {
      const original = lines[item.sourceLine - 1]!;
      const rewritten = writeBackPosition({
        line: original,
        ...(item.hasExplicitRow ? { row: item.row } : {}),
        column: item.column
      });
      assert.strictEqual(
        rewritten,
        original.trimEnd(),
        `${item.sourceLine} 行目が変形した`
      );
    }
  });
});

suite("PRTF: 位置欄が空だった項目の判定", () => {
  test("行番号がある行を見分ける", () => {
    const withRow = " ".repeat(38) + "  5" + "  1";
    const withoutRow = " ".repeat(38) + "   " + "  1";
    assert.strictEqual(hasExplicitRow(withRow), true);
    assert.strictEqual(hasExplicitRow(withoutRow), false);
  });

  test("実サンプルは行番号を使っていない（SPACE/SKIP で流れている）", () => {
    const lines = readFileSync(SAMPLE, "utf8").split(/\r?\n/);
    for (const item of resolvePrtfLayout(lines).items) {
      assert.strictEqual(
        item.hasExplicitRow,
        false,
        `${item.sourceLine} 行目に行番号があるはずがない`
      );
    }
  });
});
