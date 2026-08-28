import * as assert from "assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintFile } from "../../src/lint/engine";
import { classifyRpgSpecKeyword } from "../../src/core/rpgSpec";
import { defaultResourcesDir, loadDefinitions } from "../../src/lint/defsLoader";
import { buildInitialState } from "../../src/prompter/model";
import type { PrompterDefinition } from "../../src/prompter/types";

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

/**
 * **2 巡目（`.aidev/works/20260828-rpg3-numeric-fields/verify/`）。**
 * O / E / L 仕様の数値欄を実機で確定した。対照（通る形）を必ず添えて流している。
 *
 * | 欄 | 桁 | 実機 |
 * |---|---|---|
 * | O スペース前 / 後 | 17 / 18 | `0`-`3` は通る。`4` も英字も通らない |
 * | O 終了位置 | 40-43 | 右寄せは通る。英字・左詰めは通らない |
 * | E レコードあたり / 表あたり / 長さ / 長さ2 | 33-35 / 36-39 / 40-42 / 52-54 | 同上 |
 * | L 行番号 1 / 2 | 15-17 / 20-22 | 同上 |
 * | **O スキップ前 / 後** | 19-20 / 21-22 | **数字だけではない**（下記） |
 */
suite("RPG III の数値欄: O / E / L 仕様", () => {
  const oField = (endpos: string) =>
    put(put(put(" ".repeat(80), 6, "O"), 32, "NAME"), 40, endpos);
  const oRecord = (column: number, value: string) =>
    put(put(put(put(" ".repeat(80), 6, "O"), 7, "PRINT"), 15, "D"), column, value);
  const eTable = (column: number, value: string) =>
    put(put(" ".repeat(80), 6, "E"), column, value);
  const lLine = (value: string) =>
    put(put(put(put(" ".repeat(80), 6, "L"), 7, "PRINT"), 15, value), 18, "FL");

  test("終了位置を右寄せなら指摘しない", () => {
    assert.deepStrictEqual(codes([oField("  30")]), []);
  });

  test("**終了位置を左詰めにしたら指摘する**", () => {
    assert.ok(codes([oField("30  ")]).includes("numeric-alignment"));
  });

  test("終了位置に英字なら指摘する", () => {
    assert.ok(codes([oField("  3A")]).includes("numeric-field"));
  });

  test("スペース前に英字なら指摘する（実機も通さない）", () => {
    assert.ok(codes([oRecord(17, "A")]).includes("numeric-field"));
  });

  test("スペース後に英字なら指摘する（実機も通さない）", () => {
    assert.ok(codes([oRecord(18, "A")]).includes("numeric-field"));
  });

  test("E 仕様のエントリ長を左詰めにしたら指摘する", () => {
    assert.ok(codes([eTable(40, "3  ")]).includes("numeric-alignment"));
  });

  test("E 仕様の関数テーブル長（52-54）に英字なら指摘する", () => {
    assert.ok(codes([eTable(52, "  A")]).includes("numeric-field"));
  });

  test("L 仕様の行番号を左詰めにしたら指摘する", () => {
    assert.ok(codes([lLine("66 ")]).includes("numeric-alignment"));
  });

  test("L 仕様の行番号に英字なら指摘する", () => {
    assert.ok(codes([lLine(" 6A")]).includes("numeric-field"));
  });
});

/**
 * **スキップ欄に数字だけの検証を掛けてはいけない。**
 *
 * 実機は `01`-`99` のほかに `A0`-`A9`（100-109 行）と `B0`-`B2`（110-112 行）を
 * 受ける（外すと `QRG6016『The Skip entries are not 01-99, A0-A9, B0-B2, or blank』`）。
 * **`A0` を実機に流して通ることを確かめてある。** `numericOnly` を付けると
 * 実機が受ける値を lint が弾くので、この 2 欄だけは付けない。
 * 付けてしまうとこのテストが落ちる。
 */
suite("RPG III のスキップ欄は数字だけではない", () => {
  const skip = (column: number, value: string) =>
    put(put(put(put(" ".repeat(80), 6, "O"), 7, "PRINT"), 15, "D"), column, value);

  test("スキップ前に `A0` を書いても指摘しない（実機は通す）", () => {
    assert.deepStrictEqual(codes([skip(19, "A0")]), []);
  });

  test("スキップ後に `A0` を書いても指摘しない（実機は通す）", () => {
    assert.deepStrictEqual(codes([skip(21, "A0")]), []);
  });
});

/**
 * **`numericOnly` を持つ欄の一覧を固定する。**
 *
 * 手で数えた一覧は漏れる、という PJ の教訓に従って機械で見張る。増減させるときは
 * **実機で確かめてからこの一覧を直す**こと（対照つきで流す。土台は
 * `.aidev/works/20260828-rpg3-numeric-fields/verify/` にある）。
 */
suite("RPG III の numericOnly 一覧", () => {
  const EXPECTED: Readonly<Record<string, readonly string[]>> = {
    "C-SPEC": ["FIELDLEN", "DECPOS"],
    "E-SPEC": ["ENTPERREC", "ENTPERTAB", "ENTLEN", "ENTLEN2"],
    "F-SPEC": ["RECLEN", "RECADDRLEN", "KEYSTART"],
    "I-SPEC": ["FIELDBEG", "FIELDEND", "DECPOS"],
    "L-SPEC": ["LINE1", "LINE2"],
    "O-SPEC": ["SPACEBEFORE", "SPACEAFTER", "ENDPOS"]
  };

  for (const [spec, expected] of Object.entries(EXPECTED)) {
    test(`${spec} の numericOnly が一覧どおり`, () => {
      const path = join(RESOURCES, "prompter", "rpg", "rpg3", "ja", `${spec}.json`);
      const definition = JSON.parse(readFileSync(path, "utf8")) as {
        parameters: readonly { name: string; attributes?: { numericOnly?: boolean } }[];
      };
      const actual = definition.parameters
        .filter(parameter => parameter.attributes?.numericOnly === true)
        .map(parameter => parameter.name);
      assert.deepStrictEqual(actual, [...expected]);
    });
  }

  /** H 仕様には数値欄が無い（一覧に載っていない仕様書も見張る） */
  test("H-SPEC には numericOnly が無い", () => {
    const path = join(RESOURCES, "prompter", "rpg", "rpg3", "ja", "H-SPEC.json");
    const definition = JSON.parse(readFileSync(path, "utf8")) as {
      parameters: readonly { name: string; attributes?: { numericOnly?: boolean } }[];
    };
    assert.deepStrictEqual(
      definition.parameters.filter(parameter => parameter.attributes?.numericOnly === true).map(p => p.name),
      []
    );
  });
});

/**
 * **E / L 仕様が「到達可能」であること。**
 *
 * 定義（`E-SPEC.json` / `L-SPEC.json`）は前からあったが、`classifySpec` の
 * switch に `E` / `L` が無く **`undefined` に落ちていた**——F4 も lint も
 * この 2 つの定義に一度も届いていなかった。PJ の「追加したリソースは到達可能に
 * なって初めて完了」がそのまま起きていた形で、上の O/E/L のテストで発覚した。
 *
 * ここでは**消費経路そのもの**（`classifySpec`）を名指しで確かめる。lint の
 * 指摘だけを見ていると、規則が別の理由で出ているのか経路が繋がったのか区別できない。
 */
suite("RPG III の E / L 仕様は分類される", () => {
  const line = (specChar: string) => put(" ".repeat(80), 6, specChar);

  test("E 仕様が E-SPEC に分類される", () => {
    assert.strictEqual(classifyRpgSpecKeyword(line("E"), { dialect: "rpg3" }), "E-SPEC");
  });

  test("L 仕様が L-SPEC に分類される", () => {
    assert.strictEqual(classifyRpgSpecKeyword(line("L"), { dialect: "rpg3" }), "L-SPEC");
  });

  /** RPG IV で廃止されているので ILE では分類しない（ILE 側に定義も無い） */
  test("ILE では E / L を分類しない", () => {
    assert.strictEqual(classifyRpgSpecKeyword(line("E"), { dialect: "ile" }), undefined);
    assert.strictEqual(classifyRpgSpecKeyword(line("L"), { dialect: "ile" }), undefined);
  });
});

/**
 * **F 仕様の継続行（53桁目が `K`）。**
 *
 * 53桁目が継続欄であることは前 work で実機確認済み（`QRG2067`）。しかし
 * **選択(54-59)と記入(60-65)の欄が定義に無く、継続行が書けなかった**。
 *
 * 選択に入る語は原典が無いので**実機のコンパイラに 50 語を流して判定させた**
 * （`.aidev/works/20260828-rpg3-fspec-continuation-options/verify/`）:
 *
 * - 判定は**リストのメッセージ番号**で行う。`QRG2023` = 語が無効。
 *   **作成の成否では判別できない**——`GENLVL(50)` では誤りがあっても作成される。
 * - 有効 15 件 / 無効 35 件。対照（`INFDS` と `ZZZZZZ`）は先頭・末尾とも期待どおり。
 * - **候補の出所（ILE の F 仕様キーワード）は 15 件中 5 件を取りこぼしていた**
 *   （`SAVDS` `IND` `NUM` `ID` `COMIT` は 2 巡目で見つかった）。
 *   だから**選択肢で縛らない**——一覧に無い語も書ける。
 */
suite("RPG III の F 仕様 継続行", () => {
  const fSpec = (): PrompterDefinition =>
    JSON.parse(
      readFileSync(
        join(RESOURCES, "prompter", "rpg", "rpg3", "ja", "F-SPEC.json"),
        "utf8"
      )
    ) as PrompterDefinition;

  test("選択(54-59)と記入(60-65)の欄がある", () => {
    const byName = new Map(fSpec().parameters.map(p => [p.name, p]));
    assert.deepStrictEqual(
      [byName.get("CONTOPT")?.sourceStart, byName.get("CONTOPT")?.sourceLength],
      [54, 6]
    );
    assert.deepStrictEqual(
      [byName.get("CONTENTRY")?.sourceStart, byName.get("CONTENTRY")?.sourceLength],
      [60, 6]
    );
  });

  /**
   * **桁が重なると静かに壊れる**——片方に入力すると他方が壊れ、読み戻しも曖昧になる。
   * 欄を足すたびに目で確かめるのは無理なので、全欄を機械で見る。
   */
  test("F 仕様の欄は桁が重ならない", () => {
    const ranges = fSpec()
      .parameters.map(p => ({
        name: p.name,
        start: p.sourceStart ?? 0,
        end: (p.sourceStart ?? 0) + (p.sourceLength ?? 0) - 1
      }))
      .sort((a, b) => a.start - b.start);

    const overlaps = ranges
      .slice(1)
      .map((range, index) => ({ previous: ranges[index], range }))
      .filter(({ previous, range }) => range.start <= previous.end)
      .map(({ previous, range }) => `${previous.name}(${previous.start}-${previous.end}) / ${range.name}(${range.start}-${range.end})`);

    assert.deepStrictEqual(overlaps, [], "重なっている欄がある");
  });

  /**
   * **継続行のときだけ出す。** ファイル行では 60-65 は空白でなければならない
   * （実機の `QRG2016`）。条件表示にしておけば、書いて踏むことがない。
   */
  suite("53桁目が K のときだけ出る", () => {
    const visibleOf = (name: string, values: Record<string, string>): boolean =>
      buildInitialState(fSpec(), values).fields.find(f => f.fieldName === name)?.visible === true;

    test("継続でなければ出さない", () => {
      assert.strictEqual(visibleOf("CONTOPT", {}), false);
      assert.strictEqual(visibleOf("CONTENTRY", {}), false);
    });

    test("K なら出す", () => {
      assert.strictEqual(visibleOf("CONTOPT", { CONTINUATION: "K" }), true);
      assert.strictEqual(visibleOf("CONTENTRY", { CONTINUATION: "K" }), true);
    });

    test("K 以外なら出さない", () => {
      assert.strictEqual(visibleOf("CONTOPT", { CONTINUATION: "E" }), false);
    });

    /** 既存ソースを読むため。値が入っているものを隠すと編集できなくなる。 */
    test("値が入っていれば、継続でなくても隠さない", () => {
      assert.strictEqual(visibleOf("CONTOPT", { CONTOPT: "INFDS" }), true);
    });
  });

  /**
   * 一覧を**閉じた集合として書かない**ことの回帰。`options` を付けると
   * プロンプターが `<select>` になり、**実機が受ける語を打てなくなる**
   * （`ADDPFM` の `SRCTYPE` で踏んだのと同じ形）。
   */
  test("選択欄を選択肢で縛っていない", () => {
    const contopt = fSpec().parameters.find(p => p.name === "CONTOPT");
    assert.strictEqual(contopt?.inputType, "text");
    assert.strictEqual(contopt?.options, undefined, "options を付けると自由入力できなくなる");
    // 確かめた語は説明に置く（F1 で読める）。
    for (const word of ["INFDS", "INFSR", "SFILE", "SAVDS", "COMIT"]) {
      assert.ok(contopt?.help?.includes(word), `${word} が説明にある`);
    }
    assert.ok(
      contopt?.help?.includes("全部とは限らない"),
      "**網羅ではない**ことが書いてある"
    );
  });

  /** help に「K か空白」と書いてあるのに、入力例が `S` になっていた。 */
  test("継続欄の入力例が K になっている", () => {
    const cont = fSpec().parameters.find(p => p.name === "CONTINUATION");
    assert.strictEqual(cont?.placeholder, "K");
  });
});
