import * as assert from "assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findKeywordHelp,
  genericKeywordPrefix,
  genericKeywordRange,
  type DdsKeywordHelp
} from "../../src/core/dds/ddsKeywords";

/**
 * **総称のキーワード**（`CAnn` / `CFnn`）。原典はキー番号をまとめてこう書く。
 *
 * そのまま大文字にして書き出すと `CFNN` になり、**実機はコンパイルを通さない**
 * （IBM i 7.3。`.aidev/works/20260828-dds-generic-keyword-number/verify/`）:
 *
 * | 書いた形 | 実機 |
 * |---|---|
 * | `CF03` / `CF03()` / `CF03(03)` / `CA24` | 通る |
 * | `CFNN` / `CFNN()` | **通らない** |
 * | `CF00` / `CF25` | 通らない（原典の範囲は `CF01 - CF24`） |
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const table = (file: string): DdsKeywordHelp[] =>
  (
    JSON.parse(
      readFileSync(join(ROOT, "vscode-extension", "resources", "completion", file), "utf8")
    ) as Record<string, DdsKeywordHelp[]>
  )["DDS-DSPF"];

const JA = table("dds-keywords.json");
const EN = table("dds-keywords.en.json");

suite("総称のキーワード: 見分ける", () => {
  test("番号の場所より前を返す", () => {
    assert.strictEqual(genericKeywordPrefix("CFnn"), "CF");
    assert.strictEqual(genericKeywordPrefix("CAnn"), "CA");
  });

  test("総称でない名前は undefined", () => {
    for (const name of ["DSPSIZ", "PRINT", "CF03", "CA24", "OVERLAY"]) {
      assert.strictEqual(genericKeywordPrefix(name), undefined, name);
    }
  });

  test("原典の総称は 2 件だけ（増えたら気付く）", () => {
    assert.deepStrictEqual(
      JA.filter(help => genericKeywordPrefix(help.name) !== undefined).map(help => help.name),
      ["CAnn", "CFnn"]
    );
  });

  /** 番号入りの名前は総称に正規化して引ける（既存の振る舞い）。 */
  test("CF03 は CFnn の解説を引ける", () => {
    assert.strictEqual(findKeywordHelp("CF03", JA)?.name, "CFnn");
    assert.strictEqual(findKeywordHelp("CA24", JA)?.name, "CAnn");
  });
});

suite("総称のキーワード: 使える番号の範囲", () => {
  /**
   * **範囲は原典の説明文から取る。** 書き写すと原典が変わったときに食い違う。
   * 区切りは日英で違う（`-` と `through`）。
   */
  test("日本語版から CF01 - CF24 が取れる", () => {
    const help = JA.find(entry => entry.name === "CFnn");
    assert.ok(help);
    assert.deepStrictEqual(genericKeywordRange(help), { from: "01", to: "24" });
  });

  test("英語版（`through` 区切り）からも取れる", () => {
    const help = EN.find(entry => entry.name === "CFnn");
    assert.ok(help);
    assert.deepStrictEqual(genericKeywordRange(help), { from: "01", to: "24" });
  });

  test("CAnn も日英とも取れる", () => {
    for (const list of [JA, EN]) {
      const help = list.find(entry => entry.name === "CAnn");
      assert.ok(help);
      assert.deepStrictEqual(genericKeywordRange(help), { from: "01", to: "24" });
    }
  });

  test("総称でないキーワードは範囲を持たない", () => {
    const help = JA.find(entry => entry.name === "DSPSIZ");
    assert.ok(help);
    assert.strictEqual(genericKeywordRange(help), undefined);
  });
});
