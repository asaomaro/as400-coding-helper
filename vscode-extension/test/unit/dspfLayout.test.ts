import * as assert from "assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readConditioning, isMutuallyExclusive } from "../../src/core/dds/ddsConditioning";
import {
  resolveDspfLayout,
  type DspfPlacedItem
} from "../../src/core/dds/dspfLayout";
import { resolveScreenSizes } from "../../src/core/dds/dspfScreenSize";
import { writeBackPosition } from "../../src/core/dds/ddsPositionWriteBack";

/**
 * 表示装置ファイルの画面レイアウトの解決。
 *
 * PRTF と違い行は位置欄で決まるが、**属性文字が桁を消費する**のが核心。
 * これを誤ると全項目が 1 桁ずれる（requirement が名指しした最大の論点）。
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const SRC_DIR = join(ROOT, "docs", "src");

/** DDS の 1 行を組み立てる。桁を間違えないようにヘルパーを通す。 */
function ddsLine(options: {
  conditioning?: string;
  nameType?: string;
  name?: string;
  reference?: string;
  length?: string;
  dataType?: string;
  usage?: string;
  row?: string;
  column?: string;
  keywords?: string;
}): string {
  const cells = " ".repeat(100).split("");
  const put = (start: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) cells[start - 1 + i] = text[i]!;
  };
  put(6, "A");
  if (options.conditioning) put(7, options.conditioning);
  if (options.nameType) put(17, options.nameType);
  if (options.name) put(19, options.name);
  if (options.reference) put(29, options.reference);
  if (options.length) put(35 - options.length.length, options.length);
  if (options.dataType) put(35, options.dataType);
  if (options.usage) put(38, options.usage);
  // 位置欄は右詰め（行 39-41 / 桁 42-44）。
  if (options.row) put(42 - options.row.length, options.row);
  if (options.column) put(45 - options.column.length, options.column);
  if (options.keywords) put(45, options.keywords);
  return cells.join("").trimEnd();
}

function itemNamed(items: readonly DspfPlacedItem[], name: string): DspfPlacedItem {
  const found = items.find(item => item.name === name);
  assert.ok(found, `${name} が配置されていない`);
  return found;
}

function constantAt(items: readonly DspfPlacedItem[], text: string): DspfPlacedItem {
  const found = items.find(item => item.text === text);
  assert.ok(found, `定数 '${text}' が配置されていない`);
  return found;
}

suite("DSPF: 画面サイズ（DSPSIZ）", () => {
  const withKeywords = (keywords: string): string[] => [
    ddsLine({ keywords }),
    ddsLine({ nameType: "R", name: "REC" })
  ];

  test("DSPSIZ が無ければ 24x80（原典: 指定しなかった場合）", () => {
    const { sizes, problems } = resolveScreenSizes([ddsLine({ nameType: "R", name: "REC" })]);
    assert.deepStrictEqual(sizes.primary.size, { rows: 24, columns: 80 });
    assert.strictEqual(sizes.declared, false);
    assert.strictEqual(problems.length, 0);
  });

  test("*DS3 は 24x80、*DS4 は 27x132", () => {
    assert.deepStrictEqual(
      resolveScreenSizes(withKeywords("DSPSIZ(*DS3)")).sizes.primary.size,
      { rows: 24, columns: 80 }
    );
    assert.deepStrictEqual(
      resolveScreenSizes(withKeywords("DSPSIZ(*DS4)")).sizes.primary.size,
      { rows: 27, columns: 132 }
    );
  });

  test("2 つ指定すると先が 1 次・後が 2 次", () => {
    const { sizes } = resolveScreenSizes(withKeywords("DSPSIZ(*DS4 *DS3)"));
    assert.deepStrictEqual(sizes.primary.size, { rows: 27, columns: 132 });
    assert.deepStrictEqual(sizes.secondary?.size, { rows: 24, columns: 80 });
  });

  test("数値指定＋条件名を読む", () => {
    const { sizes, problems } = resolveScreenSizes(withKeywords("DSPSIZ(24 80 *DS3)"));
    assert.deepStrictEqual(sizes.primary.size, { rows: 24, columns: 80 });
    assert.strictEqual(sizes.primary.conditionName, "*DS3");
    assert.strictEqual(sizes.declared, true);
    assert.strictEqual(problems.length, 0);
  });

  test("ユーザー定義の条件名を 1 次・2 次それぞれに持てる", () => {
    const { sizes } = resolveScreenSizes(
      withKeywords("DSPSIZ(27 132 *WIDE 24 80 *NORMAL)")
    );
    assert.strictEqual(sizes.primary.conditionName, "*WIDE");
    assert.deepStrictEqual(sizes.primary.size, { rows: 27, columns: 132 });
    assert.strictEqual(sizes.secondary?.conditionName, "*NORMAL");
    assert.deepStrictEqual(sizes.secondary?.size, { rows: 24, columns: 80 });
  });

  test("原典に無い画面サイズは弾く（指定できるのは 24x80 と 27x132 だけ）", () => {
    const { problems } = resolveScreenSizes(withKeywords("DSPSIZ(25 80)"));
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0].message, /24 x 80 と 27 x 132/u);
  });

  test("3 つ以上は診断を出して先頭 2 つを使う", () => {
    const { sizes, problems } = resolveScreenSizes(
      withKeywords("DSPSIZ(*DS3 *DS4 *DS3)")
    );
    assert.deepStrictEqual(sizes.primary.size, { rows: 24, columns: 80 });
    assert.deepStrictEqual(sizes.secondary?.size, { rows: 27, columns: 132 });
    assert.ok(problems.some(problem => /最高 2 つ/u.test(problem.message)));
  });
});

suite("DSPF: 条件付け（7-16 桁）", () => {
  test("空なら none", () => {
    assert.deepStrictEqual(readConditioning([ddsLine({ name: "F" })]), { kind: "none" });
  });

  test("標識を読む（N はオフ条件）", () => {
    const result = readConditioning([ddsLine({ conditioning: " 01 N02", name: "F" })]);
    assert.strictEqual(result.kind, "indicators");
    assert.deepStrictEqual(result.kind === "indicators" ? result.clauses : [], [
      {
        join: "A",
        terms: [
          { indicator: "01", negated: false },
          { indicator: "02", negated: true }
        ]
      }
    ]);
  });

  test("7 桁目の O は OR、ブランクは A（原典: A が既定）", () => {
    const or = readConditioning([ddsLine({ conditioning: "O01", name: "F" })]);
    assert.strictEqual(or.kind === "indicators" ? or.clauses[0].join : "", "O");
    const and = readConditioning([ddsLine({ conditioning: " 01", name: "F" })]);
    assert.strictEqual(and.kind === "indicators" ? and.clauses[0].join : "", "A");
  });

  test("複数行にまたがる条件を拾う（項目は最後の標識と同じ行）", () => {
    const result = readConditioning([
      ddsLine({ conditioning: " 01" }),
      ddsLine({ conditioning: "O02", name: "F" })
    ]);
    assert.strictEqual(result.kind, "indicators");
    assert.strictEqual(result.kind === "indicators" ? result.clauses.length : 0, 2);
  });

  test("画面サイズ条件名を標識と区別する（8 桁目から・先頭 *）", () => {
    const result = readConditioning([ddsLine({ conditioning: " *DS4", name: "F" })]);
    assert.deepStrictEqual(result, { kind: "screen-size", name: "*DS4" });
  });

  test("重なりを報告するのは両方とも無条件のときだけ", () => {
    const none = { kind: "none" } as const;
    const ind = readConditioning([ddsLine({ conditioning: " 01", name: "F" })]);
    assert.strictEqual(isMutuallyExclusive(none, none), false);
    assert.strictEqual(isMutuallyExclusive(none, ind), true);
    assert.strictEqual(isMutuallyExclusive(ind, ind), true);
  });
});

suite("DSPF: 属性文字の占有", () => {
  test("実効占有はデータの 1 つ手前から、データの直後まで", () => {
    const { items } = resolveDspfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F", length: "5", dataType: "A", usage: "O", row: "3", column: "10" })
    ]);
    const field = itemNamed(items, "F");
    assert.strictEqual(field.column, 10);
    assert.strictEqual(field.width, 5);
    // 開始属性文字 9、データ 10-14、終了属性文字 15。
    assert.deepStrictEqual(field.occupancy, { start: 9, end: 15 });
  });

  test("隣り合う項目は属性文字を共有できるので、間が 1 桁でも重ならない", () => {
    const { diagnostics } = resolveDspfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "A", length: "5", dataType: "A", usage: "O", row: "1", column: "10" }),
      // A は 10-14 を使い終了属性文字が 15。B の開始属性文字も 15 で共有できる。
      ddsLine({ name: "B", length: "5", dataType: "A", usage: "O", row: "1", column: "16" })
    ]);
    assert.deepStrictEqual(diagnostics, []);
  });

  test("1 桁分でも食い込めば重なりとして報告する", () => {
    const { diagnostics } = resolveDspfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "A", length: "5", dataType: "A", usage: "O", row: "1", column: "10" }),
      ddsLine({ name: "B", length: "5", dataType: "A", usage: "O", row: "1", column: "15" })
    ]);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].code, "overlap");
  });

  test("1 桁目は属性文字の予約なので置けない", () => {
    const { diagnostics } = resolveDspfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F", length: "5", dataType: "A", usage: "O", row: "1", column: "1" })
    ]);
    assert.ok(diagnostics.some(d => d.code === "column-one-reserved"));
  });
});

suite("DSPF: 重なりの誤検出をしない", () => {
  test("条件付けが違えば同じ位置でも重なりとしない", () => {
    const { diagnostics } = resolveDspfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({
        conditioning: " 01",
        name: "A",
        length: "5",
        dataType: "A",
        usage: "O",
        row: "1",
        column: "10"
      }),
      ddsLine({
        conditioning: " 02",
        name: "B",
        length: "5",
        dataType: "A",
        usage: "O",
        row: "1",
        column: "10"
      })
    ]);
    assert.deepStrictEqual(diagnostics, []);
  });

  test("レコード様式が違えば重なりとしない", () => {
    const { diagnostics } = resolveDspfLayout([
      ddsLine({ nameType: "R", name: "REC1" }),
      ddsLine({ name: "A", length: "5", dataType: "A", usage: "O", row: "1", column: "10" }),
      ddsLine({ nameType: "R", name: "REC2" }),
      ddsLine({ name: "B", length: "5", dataType: "A", usage: "O", row: "1", column: "10" })
    ]);
    assert.deepStrictEqual(diagnostics, []);
  });

  test("幅不明の項目は重なりの判定に入れない", () => {
    const { diagnostics } = resolveDspfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "A", reference: "R", usage: "O", row: "1", column: "10" }),
      ddsLine({ name: "B", length: "5", dataType: "A", usage: "O", row: "1", column: "10" })
    ]);
    assert.deepStrictEqual(diagnostics, []);
  });
});

suite("DSPF: 位置の解決", () => {
  test("位置欄が無ければ配置しない（PRTF と違い前の行から流さない）", () => {
    const { items, diagnostics } = resolveDspfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F", length: "5", dataType: "A", usage: "O" })
    ]);
    assert.strictEqual(items.length, 0);
    assert.ok(diagnostics.some(d => d.code === "missing-position"));
  });

  test("相対桁（+n）は解決せず未解決として示す", () => {
    const { items, diagnostics } = resolveDspfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "A", length: "5", dataType: "A", usage: "O", row: "1", column: "10" }),
      ddsLine({ name: "B", length: "5", dataType: "A", usage: "O", column: "+10" })
    ]);
    assert.strictEqual(items.length, 1);
    assert.ok(diagnostics.some(d => d.code === "relative-position-unresolved"));
  });

  test("位置欄に数字以外が入っていたら配置しない", () => {
    const { items, diagnostics } = resolveDspfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F", length: "5", dataType: "A", usage: "O", row: "AB", column: "10" })
    ]);
    assert.strictEqual(items.length, 0);
    assert.ok(diagnostics.some(d => d.code === "invalid-position"));
  });

  test("潜在フィールド（H）は画面を占めないので配置も診断もしない", () => {
    const { items, diagnostics } = resolveDspfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F", length: "5", dataType: "A", usage: "H" })
    ]);
    assert.strictEqual(items.length, 0);
    assert.deepStrictEqual(diagnostics, []);
  });

  test("はみ出しはデータの終端で判定する（終了属性文字は画面端に載らなくてよい）", () => {
    // 原典: 文字フィールドの最大桁数は「画面サイズ - 1」（1 桁は開始属性文字用）。
    // 80 桁画面なら 2 桁目・幅 79 が最大で、データは 80 桁目まで。これは正当。
    const max = resolveDspfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F", length: "79", dataType: "A", usage: "O", row: "1", column: "2" })
    ]);
    assert.deepStrictEqual(max.diagnostics, [], "原典が認める最大幅を誤検出している");

    // 76 桁目・幅 5 → データは 80 桁目ちょうどで収まる。これも正当。
    const edge = resolveDspfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F", length: "5", dataType: "A", usage: "O", row: "1", column: "76" })
    ]);
    assert.deepStrictEqual(edge.diagnostics, [], "最終桁ちょうどを誤検出している");

    // 77 桁目・幅 5 → データが 81 桁目に届く。これが本当のはみ出し。
    const over = resolveDspfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F", length: "5", dataType: "A", usage: "O", row: "1", column: "77" })
    ]);
    assert.ok(over.diagnostics.some(d => d.code === "overflow"), "はみ出しを見逃している");
  });

  test("行が画面の外なら検出する", () => {
    const { diagnostics } = resolveDspfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F", length: "5", dataType: "A", usage: "O", row: "25", column: "10" })
    ]);
    assert.ok(diagnostics.some(d => d.code === "overflow"));
  });
});

suite("DSPF: 2 次画面サイズ用の位置指定", () => {
  test("1 次と違う画面サイズ条件名の項目は描かない（正当なので診断も出さない）", () => {
    const { items, diagnostics } = resolveDspfLayout([
      ddsLine({ keywords: "DSPSIZ(24 80 *NORMAL 27 132 *WIDE)" }),
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({
        name: "A",
        length: "5",
        dataType: "A",
        usage: "O",
        row: "1",
        column: "10"
      }),
      ddsLine({ conditioning: " *WIDE", name: "B", length: "5", dataType: "A", usage: "O", row: "1", column: "100" })
    ]);
    assert.deepStrictEqual(items.map(item => item.name), ["A"]);
    assert.deepStrictEqual(diagnostics, []);
  });
});

suite("DSPF: 画面サイズ条件名は名前ではなくサイズで突き合わせる", () => {
  /**
   * 原典（DSPSIZ）:
   * > ユーザー定義の画面サイズ条件名を指定しない場合には、IBM 提供の画面サイズ条件名を
   * > 使用してフィールドの位置を条件付ける必要があります。
   *
   * 数値形式（条件名なし）の DSPSIZ でも `*DS3` / `*DS4` で条件付けできる。
   * 名前の文字列だけで比べると、この形の項目が黙って消える。
   */
  const numericForm = (conditioning: string): string[] => [
    ddsLine({ keywords: "DSPSIZ(24 80 27 132)" }),
    ddsLine({ nameType: "R", name: "REC" }),
    ddsLine({
      conditioning,
      name: "F",
      length: "5",
      dataType: "A",
      usage: "O",
      row: "5",
      column: "2"
    })
  ];

  test("条件名を持たない DSPSIZ でも *DS3（＝1 次の 24x80）の項目を描く", () => {
    const { items, diagnostics } = resolveDspfLayout(numericForm(" *DS3"));
    assert.deepStrictEqual(
      items.map(item => item.name),
      ["F"],
      "1 次画面サイズと同じ *DS3 の項目が消えている"
    );
    assert.deepStrictEqual(diagnostics, []);
  });

  test("*DS4（＝2 次の 27x132）の項目は描かない（正当なので診断も出さない）", () => {
    const { items, diagnostics } = resolveDspfLayout(numericForm(" *DS4"));
    assert.deepStrictEqual(items, []);
    assert.deepStrictEqual(diagnostics, []);
  });

  test("1 次が *DS4 のときは *DS4 の項目を描き、*DS3 は描かない", () => {
    const lines = (conditioning: string): string[] => [
      ddsLine({ keywords: "DSPSIZ(*DS4 *DS3)" }),
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ conditioning, name: "F", length: "5", dataType: "A", usage: "O", row: "5", column: "2" })
    ];
    assert.strictEqual(resolveDspfLayout(lines(" *DS4")).items.length, 1);
    assert.strictEqual(resolveDspfLayout(lines(" *DS3")).items.length, 0);
  });

  test("ユーザー定義の条件名は名前で突き合わせる", () => {
    const lines = (conditioning: string): string[] => [
      ddsLine({ keywords: "DSPSIZ(24 80 *NORMAL 27 132 *WIDE)" }),
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ conditioning, name: "F", length: "5", dataType: "A", usage: "O", row: "5", column: "2" })
    ];
    assert.strictEqual(resolveDspfLayout(lines(" *NORMAL")).items.length, 1);
    assert.strictEqual(resolveDspfLayout(lines(" *WIDE")).items.length, 0);
  });
});

suite("DSPF: 実サンプル CUSTMNT.dspf（実機コンパイル確認済み）", () => {
  const lines = readFileSync(join(SRC_DIR, "CUSTMNT.dspf"), "utf8").split(/\r?\n/u);
  const layout = resolveDspfLayout(lines);

  test("画面サイズが DSPSIZ(24 80 *DS3) から 24x80 になる", () => {
    assert.deepStrictEqual(layout.screen, { rows: 24, columns: 80 });
    assert.strictEqual(layout.sizes.declared, true);
    assert.strictEqual(layout.sizes.primary.conditionName, "*DS3");
  });

  test("定数 '顧客保守' は 1 行 25 桁・幅 10（SO + 全角 4x2 + SI）", () => {
    const item = constantAt(layout.items, "顧客保守");
    assert.strictEqual(item.row, 1);
    assert.strictEqual(item.column, 25);
    assert.strictEqual(item.width, 10);
    assert.deepStrictEqual(item.occupancy, { start: 24, end: 35 });
    assert.strictEqual(item.recordName, "HEADER");
  });

  test("定数 '顧客番号' は 2 行 5 桁・幅 10", () => {
    const item = constantAt(layout.items, "顧客番号");
    assert.strictEqual(item.row, 2);
    assert.strictEqual(item.column, 5);
    assert.strictEqual(item.width, 10);
  });

  test("CUSTNO / CUSTNM は参照フィールドなので幅不明", () => {
    for (const name of ["CUSTNO", "CUSTNM"]) {
      const item = itemNamed(layout.items, name);
      assert.strictEqual(item.width, undefined);
      assert.strictEqual(item.widthUnknownReason, "reference");
      assert.strictEqual(item.usage, "B");
    }
  });

  test("MSGTXT は 23 行 2 桁・幅 50（属性文字を含めて 1-52 桁）", () => {
    const item = itemNamed(layout.items, "MSGTXT");
    assert.strictEqual(item.row, 23);
    assert.strictEqual(item.column, 2);
    assert.strictEqual(item.width, 50);
    assert.deepStrictEqual(item.occupancy, { start: 1, end: 52 });
  });

  test("診断はゼロ（実機で通るソースなので警告が出てはいけない）", () => {
    assert.deepStrictEqual(layout.diagnostics, []);
  });
});

suite("DSPF: 書き戻し（位置欄だけを変える）", () => {
  const lines = readFileSync(join(SRC_DIR, "CUSTMNT.dspf"), "utf8").split(/\r?\n/u);
  const layout = resolveDspfLayout(lines);

  test("無変更で書き戻すと元の行と 1 文字も変わらない", () => {
    for (const item of layout.items) {
      const original = lines[item.sourceLine - 1]!;
      const rewritten = writeBackPosition({
        line: original,
        row: item.row,
        column: item.column
      });
      assert.strictEqual(
        rewritten,
        original.trimEnd(),
        `${item.sourceLine} 行目が変形した`
      );
    }
  });

  test("位置を動かしても位置欄以外の桁は変わらない", () => {
    for (const item of layout.items) {
      const original = lines[item.sourceLine - 1]!;
      const moved = writeBackPosition({ line: original, row: 9, column: 40 });
      // 1-38 桁（名前・桁数・データタイプ・用途）は不変。
      assert.strictEqual(
        moved.slice(0, 38),
        original.slice(0, 38),
        `${item.sourceLine} 行目の 1-38 桁が変わった`
      );
      // 45 桁目以降（キーワード欄）も不変。
      assert.strictEqual(
        moved.slice(44).trimEnd(),
        original.slice(44).trimEnd(),
        `${item.sourceLine} 行目のキーワード欄が変わった`
      );
    }
  });

  test("動かした位置がレイアウト解決で読み戻せる（書き手と読み手が一致）", () => {
    const target = itemNamed(layout.items, "MSGTXT");
    const updated = [...lines];
    updated[target.sourceLine - 1] = writeBackPosition({
      line: lines[target.sourceLine - 1]!,
      row: 12,
      column: 30
    });

    const item = itemNamed(resolveDspfLayout(updated).items, "MSGTXT");
    assert.strictEqual(item.row, 12);
    assert.strictEqual(item.column, 30);
    assert.strictEqual(item.width, 50, "長さ欄が壊れていない");
    // 属性文字を含む占有も追従する。
    assert.deepStrictEqual(item.occupancy, { start: 29, end: 80 });
  });
});
