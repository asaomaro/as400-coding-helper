import * as assert from "assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintFile } from "../../src/lint/engine";
import { defaultResourcesDir, loadDefinitions } from "../../src/lint/defsLoader";

/**
 * **RPG III の数値欄。**
 *
 * RPG/400 Reference が入手できないので原典照合ができない。**実機のコンパイラに
 * 判定させた**（IBM i 7.3 / `CRTRPGPGM`。
 * `.aidev/works/20260828-rpg3-numeric-columns/verify/`）:
 *
 * | 形 | 実機 |
 * |---|---|
 * | C 仕様の長さを 51 桁に右寄せ ＋ 小数 | 通る |
 * | **長さを 49 桁に左詰め** | **通らない** |
 * | **長さ欄に英字** / **小数欄に英字** | **通らない** |
 * | I 仕様の開始 44-47 / 終了 48-51 を右寄せ | 通る |
 * | **開始・終了を左詰め** / **英字** | **通らない** |
 *
 * 直す前は `numericOnly` の欄が 1 つも無く、`.rpg` / `.sqlrpg` には
 * `line-length` しか届いていなかった。
 */

const RESOURCES = defaultResourcesDir(__dirname);
const SRC_DIR = join(__dirname, "..", "..", "..", "..", "docs", "src");

const lint = (lines: readonly string[], file = "x.rpg") =>
  lintFile({ fsPath: join(SRC_DIR, file), lines, definitions: loadDefinitions(RESOURCES) });

const put = (line: string, column: number, value: string): string => {
  const chars = line.padEnd(80, " ").split("");
  for (let i = 0; i < value.length; i += 1) chars[column - 1 + i] = value[i];
  return chars.join("").replace(/ +$/u, "");
};
const cSpec = (len: { col: number; text: string }, dec?: string): string => {
  let line = put(put(put(put(" ".repeat(80), 6, "C"), 28, "Z-ADD"), 33, "0"), 43, "TOTAL");
  line = put(line, len.col, len.text);
  return dec === undefined ? line : put(line, 52, dec);
};

const codes = (lines: readonly string[]) => lint(lines).map((finding: { ruleId: string }) => finding.ruleId);

suite("RPG III の数値欄: C 仕様", () => {
  test("右寄せ ＋ 小数なら指摘しない（実機で通る形）", () => {
    assert.deepStrictEqual(codes([cSpec({ col: 51, text: "6" }, "0")]), []);
  });

  /** **実機はこの形を通さない。** 直す前は行末で欄が切れると判定を諦めていた。 */
  test("**長さを左詰めにしたら指摘する**（行末で欄が切れていても）", () => {
    assert.deepStrictEqual(codes([cSpec({ col: 49, text: "6" })]), ["numeric-alignment"]);
  });

  test("長さ欄に英字なら指摘する", () => {
    assert.deepStrictEqual(codes([cSpec({ col: 51, text: "A" }, "0")]), ["numeric-field"]);
  });

  test("小数欄に英字なら指摘する", () => {
    assert.deepStrictEqual(codes([cSpec({ col: 51, text: "6" }, "A")]), ["numeric-field"]);
  });

  test("空欄は指摘しない（未入力は別の規則の担当）", () => {
    assert.deepStrictEqual(codes([put(put(" ".repeat(80), 6, "C"), 28, "SETON")]), []);
  });
});

suite("RPG III の数値欄: I 仕様", () => {
  const iField = (beg: string, end: string, dec?: string) => {
    let line = put(" ".repeat(80), 6, "I");
    line = put(line, 44, beg);
    line = put(line, 48, end);
    if (dec !== undefined) line = put(line, 52, dec);
    return put(line, 53, "NAME");
  };

  test("右寄せなら指摘しない", () => {
    assert.deepStrictEqual(codes([iField("   1", "  10")]), []);
  });

  test("**開始を左詰めにしたら指摘する**", () => {
    assert.ok(codes([iField("1   ", "  10")]).includes("numeric-alignment"));
  });

  test("開始欄に英字なら指摘する", () => {
    assert.ok(codes([iField("   A", "  10")]).includes("numeric-field"));
  });
});

suite("RPG III の数値欄: F 仕様", () => {
  /**
   * 実機で確かめた（`verify/probe-rpg3-fspec.mjs`）:
   * 定義どおりの桁（種別 15 / レコード長 24-27 右寄せ）は**通る**、
   * サンプルの見た目（1 桁ずつ右）は**通らない**、左詰めも英字も**通らない**。
   */
  const fSpec = (reclen: { col: number; text: string }): string => {
    let line = put(put(put(put(" ".repeat(80), 6, "F"), 7, "INFILE"), 15, "I"), 16, "P");
    line = put(put(line, 19, "F"), 40, "DISK");
    return put(line, reclen.col, reclen.text);
  };

  test("レコード長を右寄せなら指摘しない", () => {
    assert.deepStrictEqual(codes([fSpec({ col: 24, text: "  80" })]), []);
  });

  test("**レコード長を左詰めにしたら指摘する**", () => {
    assert.ok(codes([fSpec({ col: 24, text: "80" })]).includes("numeric-alignment"));
  });

  test("レコード長に英字なら指摘する", () => {
    assert.ok(codes([fSpec({ col: 24, text: "  8A" })]).includes("numeric-field"));
  });
});

suite("RPG III の数値欄: 実サンプル", () => {
  /**
   * **`RPG3SAMP.rpg` も壊れていた**（長さが 49 桁・小数なし）。実機が通さない形で、
   * `numericOnly` を足すまで lint に見えていなかった。直した形が通ることは
   * `verify/verify-rpg3-fix.mjs` で対照つきに確認済み。
   */
  test("直したサンプルに指摘が出ない", () => {
    const lines = readFileSync(join(SRC_DIR, "RPG3SAMP.rpg"), "utf8").split(/\r?\n/u);
    assert.deepStrictEqual(lint(lines, "RPG3SAMP.rpg"), []);
  });

  test("直す前の形に戻すと指摘が出る", () => {
    const lines = readFileSync(join(SRC_DIR, "RPG3SAMP.rpg"), "utf8")
      .split(/\r?\n/u)
      .map(line =>
        line.includes("Z-ADD0") && line.includes("TOTAL")
          ? line.slice(0, 48).replace(/ +$/u, "") + " 6"
          : line
      );
    assert.ok(
      lint(lines, "RPG3SAMP.rpg").some((finding: { ruleId: string }) => finding.ruleId === "numeric-alignment"),
      "指摘が出ていない"
    );
  });
});
