import * as assert from "assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_PAGE,
  resolvePrtfLayout,
  type PlacedItem
} from "../../src/core/dds/prtfLayout";

/**
 * 帳票レイアウトの解決。この作業の芯。
 *
 * 行は位置欄だけでは決まらず、`SPACEB`/`SPACEA`（相対）と `SKIPB`/`SKIPA`（絶対）
 * による逐次の状態計算になる（原典・`decisions.md` D1）。
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const SRC_DIR = join(ROOT, "docs", "src");

/** DDS の 1 行を組み立てる。桁を間違えないようにヘルパーを通す。 */
function ddsLine(options: {
  nameType?: string;
  name?: string;
  reference?: string;
  length?: string;
  dataType?: string;
  decimals?: string;
  row?: string;
  column?: string;
  keywords?: string;
}): string {
  const cells = " ".repeat(100).split("");
  const put = (start: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) cells[start - 1 + i] = text[i]!;
  };
  put(6, "A");
  if (options.nameType) put(17, options.nameType);
  if (options.name) put(19, options.name);
  if (options.reference) put(29, options.reference);
  if (options.length) put(30, options.length.padStart(5));
  if (options.dataType) put(35, options.dataType);
  if (options.decimals) put(36, options.decimals.padStart(2));
  if (options.row) put(39, options.row.padStart(3));
  if (options.column) put(42, options.column.padStart(3));
  if (options.keywords) put(45, options.keywords);
  return cells.join("").trimEnd();
}

const find = (items: readonly PlacedItem[], key: string) =>
  items.find(item => item.name === key || item.text === key);

suite("PRTF: 行の解決", () => {
  test("位置欄に行があればその行に置く（絶対）", () => {
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F1", length: "10", row: "5", column: "1" })
    ]);
    assert.strictEqual(find(layout.items, "F1")?.row, 5);
  });

  test("位置欄に行が無ければ現在の印刷行に置く", () => {
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F1", length: "10", column: "1" })
    ]);
    assert.strictEqual(find(layout.items, "F1")?.row, 1);
  });

  test("SKIPB は絶対（その行へ飛ぶ）", () => {
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC", keywords: "SKIPB(10)" }),
      ddsLine({ name: "F1", length: "10", column: "1" })
    ]);
    assert.strictEqual(find(layout.items, "F1")?.row, 10);
  });

  test("SPACEB は相対（現在行から送る）", () => {
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC", keywords: "SPACEB(3)" }),
      ddsLine({ name: "F1", length: "10", column: "1" })
    ]);
    assert.strictEqual(find(layout.items, "F1")?.row, 4, "1 + 3");
  });

  test("フィールド・レベルの SPACEA は次の項目に効く", () => {
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F1", length: "10", column: "1", keywords: "SPACEA(2)" }),
      ddsLine({ name: "F2", length: "10", column: "1" })
    ]);
    assert.strictEqual(find(layout.items, "F1")?.row, 1);
    assert.strictEqual(find(layout.items, "F2")?.row, 3);
  });

  test("レコード・レベルの SPACEA はレコードの全行の後に効く（D1）", () => {
    // 原典: レコード・レベルは「該当のレコードのすべての行が印刷された後」。
    // 各項目の後に効かせると F2 が 3 行目に来てしまう。
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC1", keywords: "SPACEA(2)" }),
      ddsLine({ name: "F1", length: "10", column: "1" }),
      ddsLine({ name: "F2", length: "10", column: "20" }),
      ddsLine({ nameType: "R", name: "REC2" }),
      ddsLine({ name: "F3", length: "10", column: "1" })
    ]);
    assert.strictEqual(find(layout.items, "F1")?.row, 1);
    assert.strictEqual(find(layout.items, "F2")?.row, 1, "同じレコードなので同じ行");
    assert.strictEqual(find(layout.items, "F3")?.row, 3, "レコードの後に 2 行送る");
  });

  test("★キーワードだけの行は直前の単位の続き（D4 の回帰）", () => {
    // R 行の次の SPACEA(2) は REC のレコード・レベルのキーワード。
    // 独立した行として扱うと、見出しと明細が同じ行に重なる。
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC1", keywords: "SKIPB(1)" }),
      ddsLine({ keywords: "SPACEA(2)" }),
      ddsLine({ column: "30", keywords: "'TITLE'" }),
      ddsLine({ nameType: "R", name: "REC2" }),
      ddsLine({ name: "F1", length: "10", column: "1" })
    ]);
    assert.strictEqual(find(layout.items, "TITLE")?.row, 1);
    assert.strictEqual(
      find(layout.items, "F1")?.row,
      3,
      "SPACEA(2) が REC1 のものとして効いていない"
    );
  });
});

suite("PRTF: 幅の 3 経路", () => {
  test("定数は DBCS を数えた実機の桁", () => {
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ column: "30", keywords: "'顧客一覧表'" })
    ]);
    assert.strictEqual(find(layout.items, "顧客一覧表")?.width, 12);
  });

  test("長さ欄があればそのまま（バイト数）", () => {
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F1", length: "30", column: "1" })
    ]);
    assert.strictEqual(find(layout.items, "F1")?.width, 30);
  });

  test("EDTCDE があれば編集後の幅", () => {
    const layout = resolvePrtfLayout([
      ddsLine({
        nameType: "R",
        name: "REC"
      }),
      ddsLine({
        name: "F1",
        length: "9",
        dataType: "S",
        decimals: "2",
        column: "1",
        keywords: "EDTCDE(1)"
      })
    ]);
    // 9 + コンマ 2 + 小数点 1
    assert.strictEqual(find(layout.items, "F1")?.width, 12);
  });

  test("29 桁目が R なら幅不明（参照は解決しない）", () => {
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F1", reference: "R", column: "1" })
    ]);
    const item = find(layout.items, "F1");
    assert.strictEqual(item?.width, undefined);
    assert.strictEqual(item?.widthUnknownReason, "reference");
  });

  test("ユーザー定義の編集コードは幅不明", () => {
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({
        name: "F1",
        length: "9",
        dataType: "S",
        column: "1",
        keywords: "EDTCDE(5)"
      })
    ]);
    assert.strictEqual(
      find(layout.items, "F1")?.widthUnknownReason,
      "user-defined-edit-code"
    );
  });
});

suite("PRTF: 診断", () => {
  test("重なりを検出する（エラーではなく警告）", () => {
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F1", length: "10", row: "1", column: "1" }),
      ddsLine({ name: "F2", length: "10", row: "1", column: "5" })
    ]);
    assert.ok(layout.diagnostics.some(d => d.code === "overlap"));
  });

  test("幅不明の項目は重なり判定の対象外", () => {
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F1", reference: "R", row: "1", column: "1" }),
      ddsLine({ name: "F2", reference: "R", row: "1", column: "1" })
    ]);
    assert.strictEqual(layout.diagnostics.filter(d => d.code === "overlap").length, 0);
  });

  test("紙面をはみ出したら検出する", () => {
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F1", length: "10", row: "1", column: "130" })
    ]);
    assert.ok(layout.diagnostics.some(d => d.code === "overflow"));
  });

  test("行番号と SPACE/SKIP の併用を検出する（原典: 無効）", () => {
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F1", length: "10", row: "5", column: "1", keywords: "SPACEA(1)" })
    ]);
    assert.ok(layout.diagnostics.some(d => d.code === "spacing-with-line-number"));
  });

  test("SPACE/SKIP を無効にするキーワードとの併用を検出する", () => {
    const layout = resolvePrtfLayout([
      ddsLine({ nameType: "R", name: "REC", keywords: "OVERLAY SPACEA(1)" }),
      ddsLine({ name: "F1", length: "10", column: "1" })
    ]);
    assert.ok(
      layout.diagnostics.some(d => d.code === "spacing-with-conflicting-keyword")
    );
  });

  test("紙面の既定は原典由来（CRTPRTF の PAGESIZE / OVRFLW）", () => {
    assert.deepStrictEqual(DEFAULT_PAGE, {
      rows: 66,
      columns: 132,
      overflowLine: 60
    });
  });

  test("紙面は設定で変えられる（DDS に書かれていないため）", () => {
    const layout = resolvePrtfLayout([ddsLine({ nameType: "R", name: "REC" })], {
      page: { columns: 80 }
    });
    assert.strictEqual(layout.page.columns, 80);
    assert.strictEqual(layout.page.rows, 66, "指定しなかったものは既定のまま");
  });
});

suite("PRTF: 実サンプル CUSTRPT.prtf", () => {
  const layout = resolvePrtfLayout(
    readFileSync(join(SRC_DIR, "CUSTRPT.prtf"), "utf8").split(/\r?\n/)
  );

  test("見出しは SKIPB(1) で 1 行目、30 桁目", () => {
    const title = find(layout.items, "顧客一覧表");
    assert.strictEqual(title?.row, 1);
    assert.strictEqual(title?.column, 30);
  });

  test("定数の幅が実機の桁と一致する（12 桁）", () => {
    // 競合はここを 5 と見積もって 7 桁ずれる。
    assert.strictEqual(find(layout.items, "顧客一覧表")?.width, 12);
  });

  test("明細は SPACEA(2) を挟んで 3 行目", () => {
    for (const name of ["CUSTNO", "CUSTNM", "CUSTAM"]) {
      assert.strictEqual(find(layout.items, name)?.row, 3, `${name} の行`);
    }
  });

  test("桁は位置欄どおり", () => {
    assert.strictEqual(find(layout.items, "CUSTNO")?.column, 5);
    assert.strictEqual(find(layout.items, "CUSTNM")?.column, 15);
    assert.strictEqual(find(layout.items, "CUSTAM")?.column, 50);
  });

  test("REF の 3 項目は幅不明として示される", () => {
    for (const name of ["CUSTNO", "CUSTNM", "CUSTAM"]) {
      const item = find(layout.items, name);
      assert.strictEqual(item?.width, undefined, `${name} の幅`);
      assert.strictEqual(item?.widthUnknownReason, "reference");
    }
  });

  test("正しいソースなので診断は出ない", () => {
    assert.deepStrictEqual(
      layout.diagnostics.map(d => `${d.code}@${d.sourceLine}`),
      []
    );
  });
});
