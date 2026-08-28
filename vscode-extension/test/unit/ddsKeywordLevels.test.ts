import * as assert from "assert";
import {
  keywordsNotAllowedAt,
  levelsOf
} from "../../src/core/dds/ddsKeywordLevels";
import { resolveDspfLayout } from "../../src/core/dds/dspfLayout";
import { resolvePrtfLayout } from "../../src/core/dds/prtfLayout";

/**
 * **キーワードを書けるレベル**（ファイル / レコード / フィールド）。
 *
 * 違うレベルに書くと**実機はコンパイルを通さない**。実機で確かめた
 * （IBM i 7.3 / `CRTDSPF`。
 * `.aidev/works/20260828-dds-keyword-levels/verify/probe-levels.mjs`）:
 *
 * | 形 | 実機 |
 * |---|---|
 * | 正しいレベル（対照） | 通る |
 * | `DSPSIZ` を様式に / 項目に | **通らない** |
 * | `OVERLAY` をファイルに / 項目に | **通らない** |
 * | `COLOR` を様式に / ファイルに | **通らない** |
 *
 * **原典がレベルを書いていないキーワードは咎めない**——知らないものを咎めると
 * 正しいソースを弾く。
 */

const put = (line: string, column: number, value: string): string => {
  const chars = line.padEnd(80, " ").split("");
  for (let i = 0; i < value.length; i += 1) chars[column - 1 + i] = value[i];
  return chars.join("").replace(/ +$/u, "");
};
const blank = (): string => put(" ".repeat(80), 6, "A");
const keywordLine = (keywords: string): string => put(blank(), 45, keywords);
const record = (name: string, keywords = ""): string => {
  const line = put(put(blank(), 17, "R"), 19, name);
  return keywords ? put(line, 45, keywords) : line;
};
const field = (name: string, col: number, keywords = ""): string => {
  const line = put(
    put(put(put(put(put(blank(), 19, name), 30, "   10"), 35, "A"), 38, "B"), 39, "  5"),
    42,
    String(col).padStart(3)
  );
  return keywords ? put(line, 45, keywords) : line;
};

const levelCodes = (diagnostics: readonly { code: string }[]): number =>
  diagnostics.filter(d => d.code === "keyword-wrong-level").length;

suite("キーワードのレベル: 表", () => {
  test("原典のレベルを引ける", () => {
    assert.deepStrictEqual(levelsOf("DSPF", "DSPSIZ"), ["file"]);
    assert.deepStrictEqual(levelsOf("DSPF", "COLOR"), ["field"]);
    assert.deepStrictEqual(levelsOf("PRTF", "UNDERLINE"), ["field"]);
  });

  test("総称（CFnn）は番号を付けた形からも引ける", () => {
    assert.deepStrictEqual(levelsOf("DSPF", "CF03"), levelsOf("DSPF", "CFnn"));
    assert.ok((levelsOf("DSPF", "CF03") ?? []).includes("record"));
  });

  /** **知らないものは咎めない。** 表に無ければ undefined。 */
  test("原典がレベルを書いていないキーワードは undefined", () => {
    assert.strictEqual(levelsOf("DSPF", "ZZZNOTAKEYWORD"), undefined);
    assert.deepStrictEqual(keywordsNotAllowedAt("DSPF", "ZZZNOTAKEYWORD", "file"), []);
  });

  test("正しいレベルなら空", () => {
    assert.deepStrictEqual(keywordsNotAllowedAt("DSPF", "DSPSIZ(24 80)", "file"), []);
    assert.deepStrictEqual(keywordsNotAllowedAt("DSPF", "OVERLAY", "record"), []);
    assert.deepStrictEqual(keywordsNotAllowedAt("DSPF", "COLOR(RED)", "field"), []);
  });

  test("**違うレベルなら名前を返す**", () => {
    assert.deepStrictEqual(keywordsNotAllowedAt("DSPF", "DSPSIZ(24 80)", "record"), ["DSPSIZ"]);
    assert.deepStrictEqual(keywordsNotAllowedAt("DSPF", "OVERLAY", "file"), ["OVERLAY"]);
    assert.deepStrictEqual(keywordsNotAllowedAt("DSPF", "COLOR(RED)", "record"), ["COLOR"]);
  });
});

suite("キーワードのレベル: 配置の解決", () => {
  /** 実機の対照（V1）と同じ形。 */
  test("正しいレベルなら指摘しない", () => {
    const layout = resolveDspfLayout(
      [keywordLine("DSPSIZ(24 80)"), record("MAIN", "OVERLAY"), field("F1", 2, "COLOR(RED)")],
      {}
    );
    assert.strictEqual(levelCodes(layout.diagnostics), 0);
  });

  /** 実機の V2 / V3。 */
  test("**DSPSIZ を様式・項目に書いたら指摘する**", () => {
    for (const lines of [
      [record("MAIN", "DSPSIZ(24 80)"), field("F1", 2)],
      [record("MAIN"), field("F1", 2, "DSPSIZ(24 80)")]
    ]) {
      assert.strictEqual(levelCodes(resolveDspfLayout(lines, {}).diagnostics), 1);
    }
  });

  /** 実機の V4 / V5。 */
  test("**OVERLAY をファイル・項目に書いたら指摘する**", () => {
    for (const lines of [
      [keywordLine("OVERLAY"), record("MAIN"), field("F1", 2)],
      [record("MAIN"), field("F1", 2, "OVERLAY")]
    ]) {
      assert.strictEqual(levelCodes(resolveDspfLayout(lines, {}).diagnostics), 1);
    }
  });

  /** 実機の V6 / V7。 */
  test("**COLOR を様式・ファイルに書いたら指摘する**", () => {
    for (const lines of [
      [record("MAIN", "COLOR(RED)"), field("F1", 2)],
      [keywordLine("COLOR(RED)"), record("MAIN"), field("F1", 2)]
    ]) {
      assert.strictEqual(levelCodes(resolveDspfLayout(lines, {}).diagnostics), 1);
    }
  });

  test("帳票にも効く（UNDERLINE は項目レベルだけ）", () => {
    const layout = resolvePrtfLayout([record("DETAIL", "UNDERLINE"), field("F1", 2)]);
    assert.strictEqual(levelCodes(layout.diagnostics), 1);
  });

  test("帳票の HIGHLIGHT は様式にも項目にも書ける（指摘しない）", () => {
    for (const lines of [
      [record("DETAIL", "HIGHLIGHT"), field("F1", 2)],
      [record("DETAIL"), field("F1", 2, "HIGHLIGHT")]
    ]) {
      assert.strictEqual(levelCodes(resolvePrtfLayout(lines).diagnostics), 0);
    }
  });
});

suite("キーワードのレベル: 検証済みサンプル", () => {
  /**
   * **既定 ON にしてよいのは、検証済みのソースに当てて偽陽性が 0 件だったものだけ**
   * （AGENTS.md / lint core の既存の方針）。
   */
  test("実機コンパイル確認済みのサンプルに指摘が出ない", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const root = join(__dirname, "..", "..", "..", "..", "docs", "src");

    for (const [file, resolve] of [
      ["CUSTMNT.dspf", (l: string[]) => resolveDspfLayout(l, {})],
      ["CUSTRPT.prtf", (l: string[]) => resolvePrtfLayout(l)]
    ] as const) {
      const lines = readFileSync(join(root, file), "utf8").split(/\r?\n/u);
      assert.strictEqual(levelCodes(resolve(lines).diagnostics), 0, file);
    }
  });
});
