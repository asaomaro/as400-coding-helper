import * as assert from "assert";
import {
  applyDdsEdits,
  validateDdsEdits,
  type DdsEdit,
  type DdsEditRejectionCode,
  type EditableDdsType
} from "../../src/core/dds/ddsEdit";
import { toLogicalUnits, unitRunEnd } from "../../src/core/dds/ddsLogicalUnits";
import { conditionNameFor, resolveScreenSizes } from "../../src/core/dds/dspfScreenSize";
import { resolveDspfLayout } from "../../src/core/dds/dspfLayout";

/**
 * 2 次画面サイズでの編集（位置の上書き行への書き戻し）。
 *
 * 上書き行の**形と置き場所は原典に規定が無い**ため、実機（IBM i 7.3 / `CRTDSPF`）に
 * 判定させて確定した。再現は
 * `.aidev/works/20260828-dds-secondary-edit/verify/probe-override-placement.mjs`
 * と `probe-conditioned-override.mjs`。ここではその結果を期待値として固定する。
 *
 * | 形 | 実機 | ここで固定していること |
 * |---|---|---|
 * | 項目の run の直後 | 通る (P1/P2/P4) | 挿入位置は `unitRunEnd` の次 |
 * | run の途中（継続行の間） | 通らない (P3) | 継続を持つ項目でも run の後ろに挿す |
 * | 項目の前 | 通らない (P5) | 前に挿さない |
 * | 1 項目 2 本 | 通らない (P9) | 既存があれば置換（足さない） |
 * | 長さ欄つき | 通らない (PA) | 作る行は条件名と位置だけ |
 * | 条件付け欄に標識 | 通らない (Q3/Q7) | 作る行は画面サイズ条件名だけ |
 * | 条件つきの項目に付ける | 通る (Q2/Q4/Q5) | 拒否しない |
 */

const DSPSIZ = "     A                                      DSPSIZ(24 80 27 132)";
const BASE = [
  DSPSIZ,
  "     A          R MAIN",
  "     A            FLD1          10A  B  5  2",
  "     A            FLD2          10A  B  6  2"
];

function apply(
  lines: readonly string[],
  edits: readonly DdsEdit[],
  ddsType: EditableDdsType = "DDS-DSPF"
): string[] {
  const rejections = validateDdsEdits(lines, edits, ddsType);
  assert.deepStrictEqual(rejections, [], "検証で弾かれた");
  const out = [...lines];
  // `applyDdsEdits` は行番号の降順で返すので、そのまま当てれば挿入でずれない。
  for (const result of applyDdsEdits(lines, edits, ddsType)) {
    out.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
  }
  return out;
}

function codes(
  lines: readonly string[],
  edits: readonly DdsEdit[],
  ddsType: EditableDdsType = "DDS-DSPF"
): DdsEditRejectionCode[] {
  return validateDdsEdits(lines, edits, ddsType).map(rejection => rejection.code);
}

/** 解いた絵の中の項目の位置。1 次と 2 次を分けて見る。 */
function positionOf(
  lines: readonly string[],
  label: string,
  screenSize: "primary" | "secondary"
): { row: number; column: number } {
  const layout = resolveDspfLayout(lines, { screenSize });
  const item = layout.items.find(candidate => candidate.name === label);
  assert.ok(item, `${label} が ${screenSize} の絵に無い`);
  return { row: item.row, column: item.column };
}

suite("2 次画面サイズの編集: 上書き行を作る", () => {
  test("上書き行が無ければ項目の run の直後に作られる", () => {
    const after = apply(BASE, [
      { kind: "move", sourceLine: 3, row: 9, column: 40, screenSize: "secondary" }
    ]);
    assert.strictEqual(after.length, BASE.length + 1, "1 行増えていない");
    // FLD1 は 3 行目。その直後（4 行目）に入る。FLD2 の前。
    assert.strictEqual(after[3].slice(6, 16), "  *DS4    ", "条件付け欄が違う");
    assert.strictEqual(after[3].slice(38, 44), "  9 40", "位置欄が違う");
    assert.ok(after[4].includes("FLD2"), "FLD2 の後ろに入っている");
  });

  test("作る行は条件名と位置だけを持つ（長さ・名前・キーワードを書かない）", () => {
    const after = apply(BASE, [
      { kind: "move", sourceLine: 3, row: 9, column: 40, screenSize: "secondary" }
    ]);
    const created = after[3];
    assert.strictEqual(created.slice(0, 6), "     A", "6 桁目が A でない");
    assert.strictEqual(created.slice(16, 38).trim(), "", "名前・長さ・型・用途が書かれた");
    assert.strictEqual(created.slice(44).trim(), "", "キーワードが書かれた");
  });

  test("項目の行（1 次の位置）は変わらない", () => {
    const after = apply(BASE, [
      { kind: "move", sourceLine: 3, row: 9, column: 40, screenSize: "secondary" }
    ]);
    assert.strictEqual(after[2], BASE[2], "項目の行が書き換わった");
    assert.deepStrictEqual(positionOf(after, "FLD1", "primary"), { row: 5, column: 2 });
    assert.deepStrictEqual(positionOf(after, "FLD1", "secondary"), { row: 9, column: 40 });
  });

  /** 実機 P3: 継続行の**途中**に挟むと通らない。run の末尾の次に挿す。 */
  test("継続行を持つ項目でも run の後ろに挿す", () => {
    const lines = [
      DSPSIZ,
      "     A          R MAIN",
      "     A            FLD1          10A  B  5  2COLOR(RED) +",
      "     A                                      DSPATR(RI)",
      "     A            FLD2          10A  B  6  2"
    ];
    const after = apply(lines, [
      { kind: "move", sourceLine: 3, row: 9, column: 40, screenSize: "secondary" }
    ]);
    assert.ok(after[3].includes("DSPATR(RI)"), "継続の途中に挿さっている");
    assert.strictEqual(after[4].slice(6, 16), "  *DS4    ", "run の後ろに入っていない");
    assert.ok(after[5].includes("FLD2"));
  });

  /** 実機 Q2/Q4/Q5: 条件が付いた項目にも上書き行を付けられる。 */
  test("条件標識が付いた項目でも作れる", () => {
    const lines = [
      DSPSIZ,
      "     A          R MAIN",
      "     A N01        FLD1          10A  B  5  2"
    ];
    const after = apply(lines, [
      { kind: "move", sourceLine: 3, row: 9, column: 40, screenSize: "secondary" }
    ]);
    assert.strictEqual(after[2], lines[2], "項目の条件が書き換わった");
    assert.strictEqual(after[3].slice(6, 16), "  *DS4    ");
  });

  /** ユーザー定義名があればそれを書く（IBM 提供名に落とさない）。 */
  test("DSPSIZ にユーザー定義の条件名があればそれを書く", () => {
    const lines = [
      "     A                                      DSPSIZ(24 80 *DS3 27 132 *BIG)",
      "     A          R MAIN",
      "     A            FLD1          10A  B  5  2"
    ];
    const after = apply(lines, [
      { kind: "move", sourceLine: 3, row: 9, column: 40, screenSize: "secondary" }
    ]);
    assert.strictEqual(after[3].slice(6, 16), "  *BIG    ");
  });
});

suite("2 次画面サイズの編集: 既にある上書き行", () => {
  const WITH_OVERRIDE = [
    DSPSIZ,
    "     A          R MAIN",
    "     A            FLD1          10A  B  5  2",
    "     A  *DS4                            9 40",
    "     A            FLD2          10A  B  6  2"
  ];

  test("行を増やさず位置欄だけを書き換える（1 項目 1 本）", () => {
    const after = apply(WITH_OVERRIDE, [
      { kind: "move", sourceLine: 3, row: 12, column: 100, screenSize: "secondary" }
    ]);
    assert.strictEqual(after.length, WITH_OVERRIDE.length, "行が増えた");
    assert.strictEqual(after[3].slice(6, 16), "  *DS4    ", "条件名が変わった");
    assert.strictEqual(after[3].slice(38, 44), " 12100");
    assert.deepStrictEqual(positionOf(after, "FLD1", "secondary"), { row: 12, column: 100 });
    assert.deepStrictEqual(positionOf(after, "FLD1", "primary"), { row: 5, column: 2 });
  });

  test("数値形式の DSPSIZ でも IBM 提供名の上書き行を引き当てる", () => {
    // 条件名が付かない形。**名前の文字列で比べると引き当てられない。**
    const after = apply(WITH_OVERRIDE, [
      { kind: "move", sourceLine: 3, row: 12, column: 100, screenSize: "secondary" }
    ]);
    assert.strictEqual(after.length, WITH_OVERRIDE.length, "新しい行を作ってしまった");
  });

  test("clearAlternatePosition で上書き行だけが消える", () => {
    const after = apply(WITH_OVERRIDE, [
      { kind: "clearAlternatePosition", sourceLine: 3 }
    ]);
    assert.strictEqual(after.length, WITH_OVERRIDE.length - 1);
    assert.ok(after[2].includes("FLD1"), "項目が消えた");
    assert.ok(after[3].includes("FLD2"), "次の項目が消えた");
    // 消したので 2 次でも 1 次と同じ位置に出る。
    assert.deepStrictEqual(positionOf(after, "FLD1", "secondary"), { row: 5, column: 2 });
  });

  test("上書き行が無ければ clearAlternatePosition は拒否される", () => {
    assert.deepStrictEqual(codes(BASE, [{ kind: "clearAlternatePosition", sourceLine: 3 }]), [
      "alternate-position-not-found"
    ]);
  });
});

suite("2 次画面サイズの編集: 拒否", () => {
  test("DSPSIZ に 2 次が無ければ拒否する", () => {
    const lines = [
      "     A                                      DSPSIZ(24 80)",
      "     A          R MAIN",
      "     A            FLD1          10A  B  5  2"
    ];
    assert.deepStrictEqual(
      codes(lines, [{ kind: "move", sourceLine: 3, row: 9, column: 40, screenSize: "secondary" }]),
      ["screen-size-not-declared"]
    );
  });

  test("DSPSIZ が無い（既定 24x80）ときも拒否する", () => {
    const lines = ["     A          R MAIN", "     A            FLD1          10A  B  5  2"];
    assert.deepStrictEqual(
      codes(lines, [{ kind: "move", sourceLine: 2, row: 9, column: 40, screenSize: "secondary" }]),
      ["screen-size-not-declared"]
    );
  });

  test("帳票では拒否する（DSPSIZ は表示装置のキーワード）", () => {
    const lines = ["     A          R MAIN", "     A            FLD1          10A     5  2"];
    assert.deepStrictEqual(
      codes(
        lines,
        [{ kind: "move", sourceLine: 2, row: 9, column: 40, screenSize: "secondary" }],
        "DDS-PRTF"
      ),
      ["screen-size-not-editable"]
    );
  });

  test("1 行 1 桁は 2 次でも拒否する", () => {
    assert.ok(
      codes(BASE, [
        { kind: "move", sourceLine: 3, row: 1, column: 1, screenSize: "secondary" }
      ]).includes("column-one-reserved")
    );
  });
});

suite("2 次画面サイズの編集: 1 次を壊さない", () => {
  test("screenSize を省いた move はいままでどおり項目の行を書き換える", () => {
    const after = apply(BASE, [{ kind: "move", sourceLine: 3, row: 9, column: 40 }]);
    assert.strictEqual(after.length, BASE.length, "行が増えた");
    assert.strictEqual(after[2].slice(38, 44), "  9 40");
  });

  test('screenSize: "primary" も同じ', () => {
    const after = apply(BASE, [
      { kind: "move", sourceLine: 3, row: 9, column: 40, screenSize: "primary" }
    ]);
    assert.strictEqual(after.length, BASE.length);
    assert.strictEqual(after[2].slice(38, 44), "  9 40");
  });

  test("2 次の move は上書き行を持つ項目の 1 次の絵を変えない", () => {
    const before = resolveDspfLayout(BASE, {});
    const after = apply(BASE, [
      { kind: "move", sourceLine: 3, row: 9, column: 40, screenSize: "secondary" }
    ]);
    const later = resolveDspfLayout(after, {});
    assert.deepStrictEqual(
      later.items.map(item => [item.name, item.row, item.column]),
      before.items.map(item => [item.name, item.row, item.column])
    );
  });
});

suite("2 次画面サイズの編集: 補助関数", () => {
  test("unitRunEnd は上書き行まで含めた最後の行を返す", () => {
    const lines = [
      DSPSIZ,
      "     A          R MAIN",
      "     A            FLD1          10A  B  5  2COLOR(RED) +",
      "     A                                      DSPATR(RI)",
      "     A  *DS4                            9 40"
    ];
    const unit = toLogicalUnits(lines).find(candidate => candidate.line.includes("FLD1"));
    assert.ok(unit);
    assert.strictEqual(unit.sourceLine, 3);
    assert.strictEqual(unitRunEnd(unit), 5);
  });

  test("conditionNameFor はユーザー定義名を優先し、無ければ IBM 提供名を返す", () => {
    const named = resolveScreenSizes([
      "     A                                      DSPSIZ(24 80 *DS3 27 132 *BIG)"
    ]).sizes;
    assert.strictEqual(conditionNameFor(named.secondary!), "*BIG");

    const numeric = resolveScreenSizes([
      "     A                                      DSPSIZ(24 80 27 132)"
    ]).sizes;
    assert.strictEqual(conditionNameFor(numeric.secondary!), "*DS4");
  });
});
