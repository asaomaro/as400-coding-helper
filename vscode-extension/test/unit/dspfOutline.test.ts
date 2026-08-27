import * as assert from "assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDspfOutline } from "../../src/core/dds/dspfOutline";
import { buildDspfRenderModel } from "../../src/core/dds/dspfRenderModel";

/**
 * 項目一覧。**守るのは「キャンバスに描かれない項目も出る」こと**。
 *
 * 配置解決は画面に置けない項目を落とす（位置欄が空・数字でない・画面に出ない用途）。
 * 一覧までそこから作ると、**GUI からは存在しないのと同じ**になり、
 * 直すにはテキストエディタへ戻るしかなくなる。ここで出所を固定する。
 */

const SOURCE = [
  "     A                                      DSPSIZ(24 80 *DS3)",
  "     A          R HEADER",
  "     A                                  1  2'見出し'",
  "     A          R DETAIL",
  "     A            SHOWN         10A  B  5 20",
  // 位置欄が空 → キャンバスに描かれない
  "     A            NOPOS         10A  B",
  // 画面に出ない用途（潜在フィールド）→ 描かれないうえ診断も出ない
  "     A            HIDDEN        10A  H",
  // 位置欄が数字でない
  "     A            BADPOS        10A  B  X  2",
  "     A* 注記行"
];

suite("項目一覧: 描かれない項目も出る", () => {
  const outline = buildDspfOutline(SOURCE);
  const detail = outline.find(record => record.name === "DETAIL");

  test("様式ごとに並ぶ", () => {
    assert.deepStrictEqual(
      outline.map(record => record.name),
      ["HEADER", "DETAIL"]
    );
  });

  test("**位置欄が空の項目**が出る（理由つき）", () => {
    const item = detail?.items.find(candidate => candidate.label === "NOPOS");
    assert.ok(item, "一覧に出ていない");
    assert.strictEqual(item.hidden, "no-position");
  });

  test("**画面に出ない用途**の項目が出る（診断が出ないので一覧が唯一の手がかり）", () => {
    const item = detail?.items.find(candidate => candidate.label === "HIDDEN");
    assert.ok(item, "一覧に出ていない");
    assert.strictEqual(item.hidden, "not-displayed");
  });

  test("**位置欄が数字でない項目**が出る", () => {
    const item = detail?.items.find(candidate => candidate.label === "BADPOS");
    assert.ok(item, "一覧に出ていない");
    assert.strictEqual(item.hidden, "invalid-position");
  });

  test("描かれる項目には理由が付かない", () => {
    const item = detail?.items.find(candidate => candidate.label === "SHOWN");
    assert.strictEqual(item?.hidden, undefined);
    assert.deepStrictEqual({ row: item?.row, column: item?.column }, { row: 5, column: 20 });
  });

  test("定数はリテラルを名札にする", () => {
    const item = outline.find(record => record.name === "HEADER")?.items[0];
    assert.strictEqual(item?.kind, "constant");
    assert.strictEqual(item?.label, "見出し");
  });

  test("注記行は項目にならない", () => {
    const labels = outline.flatMap(record => record.items.map(item => item.label));
    assert.ok(!labels.some(label => label.includes("注記")));
  });
});

suite("項目一覧: 描画モデルとの対応", () => {
  const model = buildDspfRenderModel(SOURCE);

  test("**描かれない項目のぶんだけ一覧のほうが多い**", () => {
    const listed = model.outline.flatMap(record => record.items);
    assert.strictEqual(listed.length, 5, "一覧の件数");
    assert.strictEqual(model.items.length, 2, "描かれるのは 2 件だけ");
  });

  test("鍵は sourceLine で共通（どちらで選んでも同じ項目を指す）", () => {
    for (const item of model.items) {
      const listed = model.outline
        .flatMap(record => record.items)
        .find(candidate => candidate.sourceLine === item.sourceLine);
      assert.ok(listed, `${item.sourceLine} 行目が一覧に無い`);
      assert.strictEqual(listed.kind, item.kind);
    }
  });

  test("属性は定位置欄から読める（プロパティが出す値）", () => {
    const shown = model.outline
      .flatMap(record => record.items)
      .find(item => item.label === "SHOWN");
    assert.deepStrictEqual(
      {
        name: shown?.attributes.name,
        length: shown?.attributes.length,
        dataType: shown?.attributes.dataType,
        usage: shown?.attributes.usage
      },
      { name: "SHOWN", length: 10, dataType: "A", usage: "B" }
    );
  });
});

suite("項目一覧: 実サンプル", () => {
  const ROOT = join(__dirname, "..", "..", "..", "..");
  const lines = readFileSync(join(ROOT, "docs", "src", "CUSTMNT.dspf"), "utf8").split(/\r?\n/u);

  test("2 様式が並び、項目が振り分けられる", () => {
    const outline = buildDspfOutline(lines);
    assert.ok(outline.length >= 2);
    for (const record of outline) {
      assert.ok(record.name.length > 0, "名前の無い束ができている");
      assert.ok(record.items.length > 0, `${record.name} に項目が無い`);
    }
  });

  test("キーワードは生テキストで持つ（解釈しない）", () => {
    const item = buildDspfOutline(lines)
      .flatMap(record => record.items)
      .find(candidate => candidate.attributes.keywords.includes("COLOR"));
    assert.ok(item, "キーワードつきの項目が見つからない");
    assert.ok(item.attributes.keywords.includes("COLOR(RED)"));
  });

  test("**様式もキーワードを持つ**（レコード・レベルはここにしか無い）", () => {
    // `OVERLAY` / `CF03` は様式宣言の行にあり、項目の一覧からは辿れない。
    const header = buildDspfOutline(lines).find(record => record.name === "HEADER");
    assert.ok(header, "HEADER 様式が見つからない");
    assert.ok(header.keywords.includes("OVERLAY"), header.keywords);
    assert.ok(header.keywords.includes("CF03(03 '終了')"), header.keywords);
  });

  test("キーワードの無い様式は空文字（undefined にしない）", () => {
    const detail = buildDspfOutline(lines).find(record => record.name === "DETAIL");
    assert.strictEqual(detail?.keywords, "");
  });
});

suite("項目一覧: 配置解決との食い違いを検査する", () => {
  /**
   * **一覧の「描かれない理由」と、配置解決が落とす条件がずれていないか。**
   *
   * 二つは別の実装（`dspfOutline` と `dspfLayout`）なので、片方だけ直すとずれる。
   * ずれると「一覧には理由が出ているのにキャンバスには描かれている」
   * （あるいはその逆で**どこからも触れない項目ができる**）。ここで機械的に突き合わせる。
   */
  const SOURCES: ReadonlyArray<readonly string[]> = [
    SOURCE,
    readFileSync(
      join(__dirname, "..", "..", "..", "..", "docs", "src", "CUSTMNT.dspf"),
      "utf8"
    ).split(/\r?\n/u)
  ];

  test("描かれない項目にだけ理由が付き、描かれる項目には付かない", () => {
    for (const lines of SOURCES) {
      const model = buildDspfRenderModel(lines);
      const drawn = new Set(model.items.map(item => item.sourceLine));

      for (const item of model.outline.flatMap(record => record.items)) {
        if (item.hidden === undefined) {
          assert.ok(
            drawn.has(item.sourceLine),
            `${item.sourceLine} 行目: 理由が無いのに描かれていない（一覧と配置解決がずれている）`
          );
        } else {
          assert.ok(
            !drawn.has(item.sourceLine),
            `${item.sourceLine} 行目: 理由が付いているのに描かれている`
          );
        }
      }
    }
  });

  test("描かれる項目はすべて一覧にも出る（どこからも触れない項目を作らない）", () => {
    for (const lines of SOURCES) {
      const model = buildDspfRenderModel(lines);
      const listed = new Set(
        model.outline.flatMap(record => record.items).map(item => item.sourceLine)
      );
      for (const item of model.items) {
        assert.ok(listed.has(item.sourceLine), `${item.sourceLine} 行目が一覧に無い`);
      }
    }
  });
});
