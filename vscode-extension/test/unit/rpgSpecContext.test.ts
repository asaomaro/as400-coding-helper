import * as assert from "assert";
import {
  classifyRpgSpecKeyword,
  createRpgSpecContext,
  DEFAULT_C_NEW_OPCODES
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

/**
 * **注記行に仕様書は無い。**
 *
 * 7 桁目（添字 6）の `*` は行全体を注記にする。6 桁目には仕様書の文字が
 * 書かれるので、**それだけを見ると `     H* コメント` が H 仕様書に見える**。
 *
 * 直す前はルーラーだけが判定を持っており、**F4 は注記行で `H-SPEC` を開いていた**
 * （`ruler.ts` に写しがあり、`positionResolver` には無かった）。
 * 判定を分類器の中へ移し、写しを外した。
 */
suite("RPG 仕様書: 注記行", () => {
  test("**注記行は仕様書として分類しない**", () => {
    for (const spec of ["H", "F", "D", "I", "O", "P", "C"]) {
      assert.strictEqual(
        classifyRpgSpecKeyword(`     ${spec}* コメント`),
        undefined,
        `${spec}* が分類された`
      );
    }
  });

  test("注記でない行はいままでどおり分類する（回帰）", () => {
    assert.strictEqual(classifyRpgSpecKeyword("     H DFTACTGRP(*NO)"), "H-SPEC");
    assert.strictEqual(classifyRpgSpecKeyword("     D FLD1            10A"), "D-SPEC");
    assert.strictEqual(classifyRpgSpecKeyword("     P PROC1           B"), "P-SPEC");
  });

  test("7 桁目が `*` でなければ注記ではない", () => {
    assert.strictEqual(classifyRpgSpecKeyword("     H  *コメントに見える"), "H-SPEC");
  });

  /**
   * **注記行を索引に入れない。**
   *
   * `absorb` は分類の結果に関わらず毎行呼ばれる。注記行の 7-16 桁は必ず `*` で
   * 始まるので**ファイル名としては衝突しない**が、`lastRecordName` は
   * **中身を問わず上書きする**——注記を挟むと、続くフィールド行が
   * 「直前のレコード様式」を見失う。
   */
  test("**注記行はレコード様式名の索引を汚さない**", () => {
    const preceding = [
      // プログラム記述のファイル（22 桁目が F）。
      "     FCUSTREC   IF   F  100        DISK",
      "     ICUSTREC",
      "     I* ここに注記を挟む"
    ];
    // 名前欄の空いた I 仕様（フィールド行）。直前のレコード様式に従う。
    assert.strictEqual(
      classifyRpgSpecKeyword("     I                        1  10 CUSTNO", {
        precedingLines: preceding
      }),
      "I-SPEC-FLD-PGM"
    );
  });

  test("注記を挟まなければ同じ答えになる（対照）", () => {
    assert.strictEqual(
      classifyRpgSpecKeyword("     I                        1  10 CUSTNO", {
        precedingLines: ["     FCUSTREC   IF   F  100        DISK", "     ICUSTREC"]
      }),
      "I-SPEC-FLD-PGM"
    );
  });
});

/**
 * **拡張演算項目 2 を採る命令の集合**（`C-NEW` の桁で書く命令）。
 *
 * 手で並べていたころは 10 件しか無く、**`DOU` が抜けていた**——`DOU` の行に
 * 固定欄の桁（`C-SPEC`）を当てるため、64-68 桁の「フィールド長」に式の途中が
 * 入っているように見え、**正しいソースに lint が指摘を出していた**
 * （`docs/src/EMPMNT01.rpgle:147`）。
 *
 * いまは原典から生成した補完データの `fixedForm.columns` から採る。
 */
suite("RPG 仕様書: 拡張演算項目 2 の命令", () => {
  test("**原典に「拡張演算項目 2」と書かれた命令がすべて入っている**", () => {
    const opcodes = (
      require("../../resources/completion/rpg-completion.json") as {
        opcodes: { name: string; fixedForm?: { columns?: string[] } }[];
      }
    ).opcodes;
    const fromOrigin = opcodes
      .filter(opcode => (opcode.fixedForm?.columns ?? []).some(c => c.includes("拡張演算項目")))
      .map(opcode => opcode.name.toUpperCase());

    assert.ok(fromOrigin.length > 0, "原典から 1 つも取れていない");
    for (const name of fromOrigin) {
      assert.ok(DEFAULT_C_NEW_OPCODES.has(name), `${name} が抜けている`);
    }
  });

  /** 抜けていた実物。ここが落ちたら同じ欠陥が戻っている。 */
  test("**DOU / DOW / FOR / RETURN / CALLP が入っている**", () => {
    for (const name of ["DOU", "DOW", "FOR", "RETURN", "CALLP", "EVAL", "IF", "WHEN"]) {
      assert.ok(DEFAULT_C_NEW_OPCODES.has(name), `${name} が抜けている`);
    }
  });

  /** 演算項目を採らない命令は原典の一覧に出ないので、別に足してある。 */
  test("何も採らない命令（ELSE / ENDIF / SELECT / OTHER / ENDSL）も入っている", () => {
    for (const name of ["ELSE", "ENDIF", "SELECT", "OTHER", "ENDSL"]) {
      assert.ok(DEFAULT_C_NEW_OPCODES.has(name), `${name} が抜けている`);
    }
  });

  test("固定欄の命令は入っていない（回帰）", () => {
    for (const name of ["SETLL", "READ", "CHAIN", "MOVEL", "ADD"]) {
      assert.ok(!DEFAULT_C_NEW_OPCODES.has(name), `${name} が入っている`);
    }
  });

  test("**DOU の行は C-NEW として分類される**", () => {
    assert.strictEqual(
      classifyRpgSpecKeyword("     C                   DOU       %EOF(F) OR RRN >= N"),
      "C-NEW"
    );
  });
});
