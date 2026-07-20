import * as assert from "assert";
import {
  classifyRpgSpecKeyword,
  createRpgSpecContext
} from "../../src/core/rpgSpec";

/**
 * 蓄積型の RpgSpecContext が、先行行を毎回渡す版と同じ結果を返すことを固定する。
 *
 * 文脈の索引には 2 つの非対称がある。片方でも逆にすると I/O 仕様書の桁が
 * 変わり、ルーラーとプロンプターが別の欄を指すようになる（黙って壊れる種類）。
 *   - F 仕様書の記述種別 … 先頭から最初に一致したものを採る＝**既出は上書きしない**
 *   - レコード識別行の名前 … 末尾から最初に見つかったものを採る＝**毎回上書きする**
 */

/** 蓄積版でファイル全体を分類する。 */
function classifyAllWithContext(
  lines: readonly string[],
  dialect?: "ile" | "rpg3"
): (string | undefined)[] {
  const context = createRpgSpecContext();
  return lines.map(line => context.classify(line, dialect));
}

/** 先行行を毎回渡す版でファイル全体を分類する。 */
function classifyAllWithPreceding(
  lines: readonly string[],
  dialect?: "ile" | "rpg3"
): (string | undefined)[] {
  return lines.map((line, index) =>
    classifyRpgSpecKeyword(line, {
      dialect,
      precedingLines: lines.slice(0, index)
    })
  );
}

function assertEquivalent(lines: readonly string[], dialect?: "ile" | "rpg3"): void {
  assert.deepStrictEqual(
    classifyAllWithContext(lines, dialect),
    classifyAllWithPreceding(lines, dialect),
    "蓄積版と先行行版で結果が食い違う"
  );
}

suite("RpgSpecContext", () => {
  test("外部記述ファイルの I/O 仕様書（F 仕様 22 桁目が E）", () => {
    const lines = [
      "     FSALESIN   IF   E           K DISK",
      "     ISALESIN   NS",
      "     I                                  1    5  CUSTNO"
    ];
    assertEquivalent(lines);
    assert.deepStrictEqual(classifyAllWithContext(lines), [
      "F-SPEC",
      "I-SPEC-REC-EXT",
      "I-SPEC-FLD-EXT"
    ]);
  });

  test("プログラム記述ファイルの I/O 仕様書（F 仕様 22 桁目が F）", () => {
    const lines = [
      "     FSALESIN   IF   F  100        DISK",
      "     ISALESIN   NS",
      "     I                                  1    5  CUSTNO"
    ];
    assertEquivalent(lines);
    assert.deepStrictEqual(classifyAllWithContext(lines), [
      "F-SPEC",
      "I-SPEC-REC-PGM",
      "I-SPEC-FLD-PGM"
    ]);
  });

  test("同名の F 仕様が 2 つあると先に出た方が勝つ（既出を上書きしない）", () => {
    const lines = [
      "     FSALESIN   IF   F  100        DISK",
      "     FSALESIN   IF   E           K DISK",
      "     ISALESIN   NS"
    ];
    assertEquivalent(lines);
    // 先頭の F（プログラム記述）が採られる。上書きしてしまうと EXT になる。
    assert.strictEqual(classifyAllWithContext(lines)[2], "I-SPEC-REC-PGM");
  });

  test("レコード識別行が複数あるとフィールド行は直前のものに従う（毎回上書き）", () => {
    const lines = [
      "     FPGMFILE   IF   F  100        DISK",
      "     FEXTFILE   IF   E           K DISK",
      "     IPGMFILE   NS",
      "     I                                  1    5  AAA",
      "     IEXTFILE   NS",
      "     I                                  1    5  BBB"
    ];
    assertEquivalent(lines);
    const result = classifyAllWithContext(lines);
    // 4 行目は直前の PGMFILE、6 行目は直前の EXTFILE に従う。
    // 上書きしないと 6 行目まで PGMFILE のままになる。
    assert.strictEqual(result[3], "I-SPEC-FLD-PGM");
    assert.strictEqual(result[5], "I-SPEC-FLD-EXT");
  });

  test("I と O のレコード名は互いに影響しない", () => {
    const lines = [
      "     FPGMFILE   IF   F  100        DISK",
      "     FEXTFILE   O    E             PRINTER",
      "     IPGMFILE   NS",
      "     OEXTFILE   E            DETAIL",
      "     I                                  1    5  AAA",
      "     O                       CUSTNO              10"
    ];
    assertEquivalent(lines);
    const result = classifyAllWithContext(lines);
    assert.strictEqual(result[4], "I-SPEC-FLD-PGM");
    assert.strictEqual(result[5], "O-SPEC-FLD-EXT");
  });

  test("F 仕様に無い名前は外部記述のレコード様式名とみなす", () => {
    const lines = ["     IUNKNOWN   NS"];
    assertEquivalent(lines);
    assert.strictEqual(classifyAllWithContext(lines)[0], "I-SPEC-REC-EXT");
  });

  test("RPG III は I/O をレイアウト別に分けない", () => {
    const lines = [
      "     FCUSTMAS  IF  E           K        DISK",
      "     IPRINT    NS",
      "     OPRINT    D    1"
    ];
    assertEquivalent(lines, "rpg3");
    assert.deepStrictEqual(classifyAllWithContext(lines, "rpg3"), [
      "F-SPEC",
      "I-SPEC",
      "O-SPEC"
    ]);
  });

  test("22 桁に満たない F 仕様は索引に入らない（元の実装と同じ読み飛ばし）", () => {
    const lines = ["     FSHORT", "     ISHORT     NS"];
    assertEquivalent(lines);
    // 索引に入らないので「F 仕様に無い名前」扱い＝EXT。
    assert.strictEqual(classifyAllWithContext(lines)[1], "I-SPEC-REC-EXT");
  });

  test("先行行の未指定と空配列は意味が違う（未指定は PGM）", () => {
    const line = "     IUNKNOWN   NS";
    assert.strictEqual(
      classifyRpgSpecKeyword(line),
      "I-SPEC-REC-PGM",
      "先行行という概念が無いときは既定の PGM"
    );
    assert.strictEqual(
      classifyRpgSpecKeyword(line, { precedingLines: [] }),
      "I-SPEC-REC-EXT",
      "先行行が 0 行なら F 仕様が見つからない扱い＝EXT"
    );
  });

  test("H / D / P / C 仕様は文脈に依存しない", () => {
    const lines = [
      "     H DFTACTGRP(*NO)",
      "     D TOTAL           S             11P 2",
      "     PCALCTAX          B",
      "     C                   EVAL      X = 1",
      "     C                   MOVEL     A         B"
    ];
    assertEquivalent(lines);
    assert.deepStrictEqual(classifyAllWithContext(lines), [
      "H-SPEC",
      "D-SPEC",
      "P-SPEC",
      "C-NEW",
      "C-SPEC"
    ]);
  });
});
