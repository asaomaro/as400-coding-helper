import * as assert from "assert";
import {
  applyDdsEdits,
  validateDdsEdits,
  type DdsEdit,
  type DdsEditRejectionCode
} from "../../src/core/dds/ddsEdit";
import {
  CONDITION_LIMITS,
  conditionLineCount,
  formatConditionText,
  parseConditionText,
  writeBackCondition
} from "../../src/core/dds/ddsConditionWriteBack";
import {
  conditionGroups,
  readConditioning,
  type IndicatorTerm
} from "../../src/core/dds/ddsConditioning";
import { toLogicalUnits } from "../../src/core/dds/ddsLogicalUnits";
import { parseEditorMessage } from "../../src/dds/webview/protocol";

/**
 * 条件標識の編集（7-16 桁への書き戻し）。
 *
 * 原典（`表示装置ファイルの条件付け (7 - 16 桁目)`）:
 * > フィールドについて条件を設定する際には、そのフィールド名 (または固定情報) と
 * > **最後の (または唯一の) 標識は同じ行に指定**しなければなりません。
 *
 * したがって **OR や 4 つ以上の AND では行が増える**。宛先は代表行 1 本ではなく区間。
 */

const BASE = [
  "     A          R MAIN",
  "     A            FLD1          10A  B  5  2",
  "     A            FLD2          10A  B  6  2"
];

const term = (indicator: string, negated = false): IndicatorTerm => ({ indicator, negated });

/** 検証 → 適用（後ろから当てる）。拒否があれば投げる。 */
function apply(lines: readonly string[], edits: readonly DdsEdit[]): string[] {
  const rejections = validateDdsEdits(lines, edits);
  assert.deepStrictEqual(rejections, [], "検証で弾かれた");
  const out = [...lines];
  for (const result of [...applyDdsEdits(lines, edits)].sort(
    (a, b) => b.replaceFrom - a.replaceFrom
  )) {
    out.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
  }
  return out;
}

function rejectionCodes(lines: readonly string[], edits: readonly DdsEdit[]): DdsEditRejectionCode[] {
  return validateDdsEdits(lines, edits).map(rejection => rejection.code);
}

/** 書いた結果を読み直す（往復の確認）。 */
function readBack(lines: readonly string[], label: string): readonly (readonly IndicatorTerm[])[] {
  const unit = toLogicalUnits(lines).find(candidate => candidate.line.includes(label));
  assert.ok(unit, `${label} が読めない`);
  return conditionGroups(readConditioning(unit.conditioningLines));
}

suite("条件の編集: 桁", () => {
  test("単純な条件は代表行に書かれる（行は増えない）", () => {
    const after = apply(BASE, [
      { kind: "setCondition", sourceLine: 2, condition: [[term("50")]] }
    ]);
    assert.strictEqual(after.length, BASE.length, "行数が変わった");
    // 7 桁目 = ブランク（最初の条件）、8 桁目 = NOT、9-10 = 標識。
    assert.strictEqual(after[1].slice(6, 16), "  50      ");
    assert.ok(after[1].includes("FLD1"), "項目が消えた");
  });

  test("N が標識の直前の桁に入る", () => {
    const after = apply(BASE, [
      { kind: "setCondition", sourceLine: 2, condition: [[term("50", true), term("01")]] }
    ]);
    assert.strictEqual(after[1].slice(6, 16), " N50 01   ");
  });

  /**
   * 原典: 「OR で結ばれる複数の条件を指定する場合には、各条件をそれぞれ新しい行から
   * 書き始め、**最初の条件以外のすべての条件については、7 桁目に O を指定**」
   */
  test("**OR では行が増え、2 つ目以降の 7 桁目に O が入る**", () => {
    const after = apply(BASE, [
      { kind: "setCondition", sourceLine: 2, condition: [[term("50")], [term("60")]] }
    ]);
    assert.strictEqual(after.length, BASE.length + 1, "行が増えていない");
    // 条件だけの行は行末の空白を落としてある（元のソースと同じ姿に保つため）。
    assert.strictEqual(after[1].slice(6, 16).padEnd(10), "  50      ", "1 つ目の条件");
    assert.strictEqual(after[1].slice(16).trim(), "", "条件だけの行に項目が残っている");
    assert.strictEqual(after[2].charAt(6), "O", "2 つ目に O が無い");
    assert.ok(after[2].includes("FLD1"), "項目は最後の行にある");
  });

  /**
   * 原典: 「AND 条件をつくるために 4 つ以上の標識が必要な場合には、標識を次の行以降に
   * 指定します。AND 条件の継続を示すためには、2 行目以降の 7 桁目に A を指定してもよい」
   */
  test("AND が 4 つ以上でも行が増える（継続は A）", () => {
    const after = apply(BASE, [
      {
        kind: "setCondition",
        sourceLine: 2,
        condition: [[term("01"), term("02"), term("03"), term("04")]]
      }
    ]);
    assert.strictEqual(after.length, BASE.length + 1);
    assert.strictEqual(after[1].slice(6, 16), "  01 02 03");
    assert.strictEqual(after[2].charAt(6), "A", "継続に A が無い");
  });

  test("条件を消すと行が減り、項目の行だけが残る", () => {
    const withOr = apply(BASE, [
      { kind: "setCondition", sourceLine: 2, condition: [[term("50")], [term("60")]] }
    ]);
    // OR で 1 行増えたので、FLD1 の代表行は 3 行目。
    const cleared = apply(withOr, [{ kind: "setCondition", sourceLine: 3, condition: [] }]);
    assert.strictEqual(cleared.length, BASE.length, "行が戻っていない");
    assert.deepStrictEqual(cleared, BASE, "元のソースに戻らない");
  });

  test("触っていない行は 1 バイトも変わらない", () => {
    const after = apply(BASE, [
      { kind: "setCondition", sourceLine: 2, condition: [[term("50")]] }
    ]);
    assert.strictEqual(after[0], BASE[0]);
    assert.strictEqual(after[2], BASE[2]);
  });
});

suite("条件の編集: 往復", () => {
  const cases: ReadonlyArray<{ name: string; groups: IndicatorTerm[][] }> = [
    { name: "1 つ", groups: [[term("50")]] },
    { name: "N 付き", groups: [[term("50", true)]] },
    { name: "AND 2 つ", groups: [[term("01"), term("02")]] },
    { name: "AND 3 つ（1 行の上限）", groups: [[term("01"), term("02"), term("03")]] },
    { name: "AND 4 つ（行が増える）", groups: [[term("01"), term("02"), term("03"), term("04")]] },
    { name: "OR 2 つ", groups: [[term("50")], [term("60")]] },
    { name: "OR 3 つ", groups: [[term("11")], [term("22")], [term("33")]] },
    { name: "OR と AND の混在", groups: [[term("01"), term("02", true)], [term("03")]] },
    {
      name: "上限（AND 9 個）",
      groups: [Array.from({ length: 9 }, (_, i) => term(String(i + 1).padStart(2, "0")))]
    },
    {
      name: "上限（OR 9 つ）",
      groups: Array.from({ length: 9 }, (_, i) => [term(String(i + 10))])
    }
  ];

  for (const { name, groups } of cases) {
    test(`${name} は書いて読み直すと同じ条件になる`, () => {
      const after = apply(BASE, [
        { kind: "setCondition", sourceLine: 2, condition: groups }
      ]);
      assert.deepStrictEqual(readBack(after, "FLD1"), groups);
    });
  }

  test("条件を差し替えても往復する（付け替え）", () => {
    const first = apply(BASE, [
      { kind: "setCondition", sourceLine: 2, condition: [[term("50")], [term("60")]] }
    ]);
    // OR で増えているので代表行は 3 行目。1 つの条件に戻す。
    const second = apply(first, [
      { kind: "setCondition", sourceLine: 3, condition: [[term("70", true)]] }
    ]);
    assert.deepStrictEqual(readBack(second, "FLD1"), [[term("70", true)]]);
    assert.strictEqual(second.length, BASE.length, "行が残っている");
  });
});

suite("条件の編集: 書けないものは断る", () => {
  test("標識が 01-99 でない", () => {
    assert.deepStrictEqual(
      rejectionCodes(BASE, [
        { kind: "setCondition", sourceLine: 2, condition: [[term("00")]] }
      ]),
      ["condition-indicator-invalid"]
    );
  });

  test("1 つの条件に 10 個以上（原典の上限は 9）", () => {
    const terms = Array.from({ length: CONDITION_LIMITS.termsPerGroup + 1 }, (_, i) =>
      term(String((i % 99) + 1).padStart(2, "0"))
    );
    assert.deepStrictEqual(
      rejectionCodes(BASE, [{ kind: "setCondition", sourceLine: 2, condition: [terms] }]),
      ["condition-too-many"]
    );
  });

  test("条件が 10 個以上（原典の上限は 9）", () => {
    const groups = Array.from({ length: CONDITION_LIMITS.groups + 1 }, (_, i) => [
      term(String(i + 10))
    ]);
    assert.deepStrictEqual(
      rejectionCodes(BASE, [{ kind: "setCondition", sourceLine: 2, condition: groups }]),
      ["condition-too-many"]
    );
  });

  /**
   * 条件行と項目の行の間に注記行が挟まっている形。**まとめて置き換えると注記が消える**ので
   * 書き換えない（`setKeywords` の `keyword-lines-not-contiguous` と同じ扱い）。
   */
  test("条件行と項目の行の間に注記行があると断る", () => {
    const lines = [
      "     A          R MAIN",
      "     A  50",
      "     A* ここに注記",
      "     A O 60        FLD1          10A  B  5  2"
    ];
    assert.deepStrictEqual(
      rejectionCodes(lines, [
        { kind: "setCondition", sourceLine: 4, condition: [[term("70")]] }
      ]),
      ["condition-lines-not-contiguous"]
    );
  });

  test("断ったときは何も書かない", () => {
    const edits: DdsEdit[] = [
      { kind: "setCondition", sourceLine: 2, condition: [[term("00")]] }
    ];
    assert.deepStrictEqual(applyDdsEdits(BASE, edits), []);
  });
});

suite("条件の編集: 短い形（入力欄の書き方）", () => {
  test("読み書きで同じ形（往復する）", () => {
    for (const text of ["", "50", "N50", "N50 01", "50, 60", "01 02 03, N04"]) {
      const parsed = parseConditionText(text);
      assert.ok(parsed.ok, `${text} が読めない`);
      assert.strictEqual(formatConditionText(parsed.groups), text.trim());
    }
  });

  test("1 桁で打っても 0 詰めされる", () => {
    const parsed = parseConditionText("n5");
    assert.ok(parsed.ok);
    assert.deepStrictEqual(parsed.groups, [[term("05", true)]]);
  });

  test("読めない形は理由を返す（例外にしない）", () => {
    for (const text of ["abc", "50,", "00", "1 x"]) {
      const parsed = parseConditionText(text);
      assert.strictEqual(parsed.ok, false, `${text} が通ってしまう`);
      assert.ok(!parsed.ok && parsed.message.length > 0, "理由が空");
    }
  });

  test("空文字は条件なし（消す指定）", () => {
    const parsed = parseConditionText("   ");
    assert.ok(parsed.ok);
    assert.deepStrictEqual(parsed.groups, []);
  });
});

suite("条件の編集: 配線", () => {
  /**
   * **ホストに届かないと画面は「適用中…」のまま止まる。**
   * 実際 `moveColumn` を `parseEdit` に足し忘れて同じ状態になったことがある。
   */
  test("setCondition が WebView からホストへ渡る", () => {
    const message = parseEditorMessage({
      type: "edit",
      edits: [
        {
          kind: "setCondition",
          sourceLine: 2,
          condition: [[{ indicator: "50", negated: false }]]
        }
      ]
    });
    assert.ok(message && message.type === "edit", "メッセージが通らない");
    assert.strictEqual(message.edits.length, 1, "編集が落ちている");
    assert.strictEqual(message.edits[0].kind, "setCondition");
  });

  test("形が違えば通さない", () => {
    for (const condition of [undefined, "50", [["50"]], [[{ indicator: 50, negated: false }]]]) {
      const message = parseEditorMessage({
        type: "edit",
        edits: [{ kind: "setCondition", sourceLine: 2, condition }]
      });
      assert.ok(
        !message || (message.type === "edit" && message.edits.length === 0),
        `${JSON.stringify(condition)} が通ってしまう`
      );
    }
  });
});

suite("条件の編集: 書き戻しの単体", () => {
  test("条件が空なら代表行 1 本（条件付け欄はブランク）", () => {
    const lines = writeBackCondition(BASE[1], []);
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].slice(6, 16).trim(), "");
  });

  test("条件だけの行は 17 桁目以降が空", () => {
    const lines = writeBackCondition(BASE[1], [[term("50")], [term("60")]]);
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[0].length <= 16, true, `条件だけの行が長い: |${lines[0]}|`);
  });
});

suite("条件の編集: 行数の数え方が 1 つであること", () => {
  /**
   * UI は「編集で項目の行が何行ずれるか」を `conditionLineCount` で知り、
   * ずれた分だけ選択を送り直す。**書き出す本数とずれると選択が迷子になる**
   * （実際、直す前は OR にした瞬間にプロパティごと消えた。e2e で踏んだ）。
   */
  const shapes: IndicatorTerm[][][] = [
    [],
    [[term("50")]],
    [[term("01"), term("02"), term("03")]],
    [[term("01"), term("02"), term("03"), term("04")]],
    [Array.from({ length: 9 }, (_, i) => term(String(i + 1).padStart(2, "0")))],
    [[term("50")], [term("60")]],
    [[term("50")], [term("60")], [term("70")]],
    [[term("01"), term("02"), term("03"), term("04")], [term("60")]],
    Array.from({ length: 9 }, (_, i) => [term(String(i + 10))])
  ];

  for (const groups of shapes) {
    test(`${formatConditionText(groups) || "（条件なし）"} の行数が一致する`, () => {
      assert.strictEqual(
        writeBackCondition(BASE[1], groups).length,
        conditionLineCount(groups),
        "書き出す本数と数え方が食い違っている"
      );
    });
  }
});
