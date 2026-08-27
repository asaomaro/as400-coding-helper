import * as assert from "assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyIndicators, buildDspfRenderModel } from "../../src/core/dds/dspfRenderModel";
import type { RenderItem } from "../../src/core/dds/ddsRenderItem";

/**
 * **描画モデルを実機の画面と突き合わせる。**
 *
 * ゴールデン（`test/golden/RENDER1.screen.json`）は IBM i 7.3 に `CRTDSPF` した様式を
 * 5250 で表示し、画面をそのまま採ったもの。**モデルの語彙は 1 つも入っていない**
 * ——入れると「モデルを間違えたまま固定する」ことになる。
 *
 * 採り直しは `.aidev/works/20260827-dds-render-golden/verify/capture-render-golden.mjs`。
 * このテストは**実機に繋がない**ので CI でも走る。
 *
 * ここまで実機と突き合わせたのは部分だった（DBCS の桁 / `COLOR`・`DSPATR` の 61 通り）。
 * 「この様式を出したら画面がこうなる」を丸ごと比べるのはこれが初めて。
 */

const GOLDEN_DIR = join(__dirname, "..", "..", "..", "test", "golden");

interface GoldenCell {
  row: number; col: number; char: string; color: string;
  reverse: boolean; underline: boolean; blink: boolean; nonDisplay: boolean;
}
interface GoldenField {
  row: number; col: number; length: number; protected: boolean;
}
interface Golden {
  source: string; capturedAt: string; system: string;
  /** 人が眺めるための行。**桁で引かない**（全角が 1 桁ずつ詰まる）。 */
  preview: string[];
  cells: GoldenCell[]; fields: GoldenField[];
}

// **黙って skip しない。** 読めなければ落とす——skip は「実機と合っている」と誤読される。
const golden = JSON.parse(
  readFileSync(join(GOLDEN_DIR, "RENDER1.screen.json"), "utf8")
) as Golden;
const lines = readFileSync(join(GOLDEN_DIR, "RENDER1.dspf"), "utf8").split(/\r?\n/u);
const model = buildDspfRenderModel(lines);

/**
 * 桁で引ける形はセルだけ。**行の文字列で引かない**——全角 1 文字は 2 桁を占めるが
 * 文字は 1 つ目のセルにしか入らないので、繋ぐと桁が詰まる。
 */
const byCell = new Map<string, GoldenCell>();
for (const cell of golden.cells) byCell.set(`${cell.row}:${cell.col}`, cell);

function cellAt(row: number, col: number): GoldenCell | undefined {
  return byCell.get(`${row}:${col}`);
}

/** その桁の文字。セルが無い（＝素の空白）なら空白。全角の 2 桁目は空文字。 */
function charAt(row: number, col: number): string {
  const cell = cellAt(row, col);
  return cell === undefined ? " " : cell.char;
}

/** その行の `from` 桁から `count` 桁分を、1 桁 1 文字で取り出す。 */
function slice(row: number, from: number, count: number): string {
  let text = "";
  for (let col = from; col < from + count; col += 1) {
    const char = charAt(row, col);
    text += char === "" ? "" : char;
  }
  return text;
}

/** その行に文字が 1 つでも出ているか。 */
function rowHasText(row: number): boolean {
  return golden.cells.some(cell => cell.row === row && cell.char.trim().length > 0);
}

suite("描画ゴールデン: 前提", () => {
  test("ゴールデンは採取した様式のもの", () => {
    assert.strictEqual(golden.source, "RENDER1.dspf");
    assert.ok(golden.cells.length > 0, "セルが 1 つも採れていない");
    for (const cell of golden.cells) {
      assert.ok(cell.row >= 1 && cell.row <= 24, `行 ${cell.row} が画面の外`);
      assert.ok(cell.col >= 1 && cell.col <= 80, `桁 ${cell.col} が画面の外`);
    }
  });

  test("様式が解決できている（診断なし・項目が全部ある）", () => {
    assert.deepStrictEqual(model.diagnostics, [], "解決で指摘が出ている");
    assert.strictEqual(model.items.length, 21, "項目の数が変わった");
    assert.strictEqual(model.canvas.rows, 24);
    assert.strictEqual(model.canvas.columns, 80);
  });
});

suite("描画ゴールデン: 定数の文字が桁どおりに出ている", () => {
  /**
   * `segments` を開始桁から並べ、実機の画面の同じ桁と比べる。
   *
   * **DBCS がここで効く。** `'顧客保守'` は SO ＋ 全角 4 × 2 ＋ SI ＝ 10 桁で、
   * 最初の文字は開始桁の**次**に出る。1 桁ずれればこの検査が落ちる。
   */
  function assertConstant(item: RenderItem): void {
    let col = item.column;
    for (const segment of item.segments) {
      if (segment.shift !== undefined) {
        // SO / SI は画面では空白（桁は食う）。
        assert.strictEqual(
          charAt(item.row, col),
          " ",
          `${item.label}: ${item.row} 行 ${col} 桁は ${segment.shift} のはずが ` +
            `'${charAt(item.row, col)}'`
        );
        col += segment.cols;
        continue;
      }
      // 区切りの `cols` は「その文字列が何桁を占めるか」。全角なら 1 文字 2 桁。
      const chars = [...segment.text];
      const perChar = segment.cols / chars.length;
      for (const char of chars) {
        assert.strictEqual(
          charAt(item.row, col),
          char,
          `${item.label}: ${item.row} 行 ${col} 桁は '${char}' のはずが ` +
            `'${charAt(item.row, col)}'`
        );
        if (perChar === 2) {
          // 全角の 2 桁目は空文字で返る（そこに別の文字が来ていないことを見る）。
          assert.strictEqual(
            charAt(item.row, col + 1),
            "",
            `${item.label}: ${col + 1} 桁は全角の続きのはず`
          );
        }
        col += perChar;
      }
    }
  }

  const constants = model.items.filter(
    item => item.kind === "constant" && !item.appearance.nonDisplay && item.condition.kind === "none"
  );

  test("比べる定数がある", () => {
    assert.ok(constants.length >= 10, `定数が ${constants.length} 件しかない`);
  });

  for (const item of constants) {
    test(`${item.row} 行 ${item.column} 桁 '${item.label}'`, () => assertConstant(item));
  }

  test("DBCS の定数は開始桁の次から出る（SO が 1 桁を食う）", () => {
    const item = constants.find(candidate => candidate.label === "顧客保守");
    assert.ok(item, "DBCS の定数が無い");
    assert.strictEqual(item.widthCols, 10, "SO + 全角 4 × 2 + SI = 10 桁");
    assert.strictEqual(charAt(item.row, item.column), " ", "開始桁は SO なので空白");
    assert.strictEqual(charAt(item.row, item.column + 1), "顧", "最初の文字は開始桁の次");
    assert.strictEqual(charAt(item.row, item.column + 9), " ", "最後の桁は SI なので空白");
  });

  test("半角と全角が混じる定数も桁が合う", () => {
    const item = constants.find(candidate => candidate.label === "コードNO");
    assert.ok(item, "混在の定数が無い");
    // SO(1) + コ ー ド(6) + SI(1) + N O(2) = 10
    assert.strictEqual(item.widthCols, 10);
    // 開始桁 SO / +1..+6 全角 3 文字 / +7 SI / +8..+9 半角。
    assert.strictEqual(charAt(item.row, item.column + 7), " ", "全角の後ろは SI");
    assert.strictEqual(charAt(item.row, item.column + 8), "N", "SI の次から半角が続く");
    assert.strictEqual(charAt(item.row, item.column + 9), "O");
  });
});

suite("描画ゴールデン: フィールドが実機の欄と一致する", () => {
  /**
   * 実機が返す欄の桁数は**表示桁数**で、宣言した桁数（30-34）より大きいことがある
   * （原典「表示桁数は、プログラム桁数と同じかまたはそれより大きくなります」）。
   *
   * モデルは増える分を `width` に入れず**占有**に入れている（画面には空白として出るため）。
   * したがって実機の桁数に対応するのは `occupancy.end - column`。
   */
  const inputFields = model.items.filter(
    item => item.kind === "field" && item.attributes.usage !== "O"
  );

  test("入力できる欄の数が実機と一致する", () => {
    assert.strictEqual(
      inputFields.length,
      golden.fields.filter(field => !field.protected).length,
      "入力欄の数が違う"
    );
  });

  for (const item of inputFields) {
    test(`${item.label}（${item.row} 行 ${item.column} 桁）`, () => {
      const field = golden.fields.find(
        candidate => candidate.row === item.row && candidate.col === item.column
      );
      assert.ok(field, `実機に ${item.row} 行 ${item.column} 桁の欄が無い`);
      assert.strictEqual(
        item.occupancy.end - item.column,
        field.length,
        `${item.label}: 表示桁数がモデル ${item.occupancy.end - item.column} / ` +
          `実機 ${field.length}`
      );
      assert.strictEqual(field.protected, false, "入力できるはずの欄が保護されている");
    });
  }

  /**
   * **符号付き数字の入力欄は宣言より 1 桁広い。**
   *
   * `CODE` は `6S 0I`。実機は 7 桁の欄として返す（符号の場所）。
   * モデルは描く幅を 6 のままにし、占有だけ 1 桁伸ばす。
   */
  test("符号付き数字（S）の入力欄は 1 桁広く占める", () => {
    const item = model.items.find(candidate => candidate.label === "CODE" && candidate.kind === "field");
    assert.ok(item);
    assert.strictEqual(item.widthCols, 6, "描く幅は宣言どおり（符号は空白なので描かない）");
    assert.strictEqual(item.occupancy.end - item.column, 7, "占有は符号の分だけ広い");
    const field = golden.fields.find(f => f.row === item.row && f.col === item.column);
    assert.strictEqual(field?.length, 7, "実機も 7 桁");
  });

  /**
   * **数字のみ（`Y`）× 小数点ありの入力欄も 1 桁広い。**
   *
   * 符号（`S`）の分だけを数えていて**小数点の分を取りこぼしていた**
   * ——数字の入力欄はどの画面にもあるので、重なり・はみ出しの判定が 1 桁甘かった。
   * 実機で `6Y 2B` は 7 桁の欄として返る（`verify/probe-display-length.mjs`）。
   */
  test("数字のみ（Y）× 小数点ありの入力欄は 1 桁広く占める", () => {
    const item = model.items.find(
      candidate => candidate.label === "RATE" && candidate.kind === "field"
    );
    assert.ok(item);
    assert.strictEqual(item.widthCols, 6, "描く幅は宣言どおり（小数点は空白なので描かない）");
    assert.strictEqual(item.occupancy.end - item.column, 7, "占有は小数点の分だけ広い");
    const field = golden.fields.find(f => f.row === item.row && f.col === item.column);
    assert.strictEqual(field?.length, 7, "実機も 7 桁");
  });

  test("出力専用（O）の欄は実機の入力欄に現れない", () => {
    const item = model.items.find(
      candidate => candidate.label === "AMOUNT" && candidate.kind === "field"
    );
    assert.ok(item);
    assert.strictEqual(item.attributes.usage, "O");
    assert.ok(
      !golden.fields.some(f => f.row === item.row && f.col === item.column && !f.protected),
      "出力専用なのに入力欄になっている"
    );
    // 値 0 が桁数どおりに印字される（`9S 2O` は小数点を出さない）。
    assert.strictEqual(
      slice(item.row, item.column, 9),
      "000000000",
      "出力専用のゾーン 10 進は生の数字が並ぶ"
    );
  });
});

suite("描画ゴールデン: 見え方が実機と一致する", () => {
  const visible = model.items.filter(
    item => item.kind === "constant" && item.condition.kind === "none"
  );

  for (const item of visible) {
    test(`${item.label} の色と属性`, () => {
      // 非表示の項目は文字が出ないので、**先頭の桁が非表示であること**だけを見る。
      const cell = cellAt(item.row, item.column + (item.segments[0]?.shift ? 1 : 0));
      assert.ok(cell, `${item.label}: ${item.row} 行のセルが採れていない`);
      assert.strictEqual(cell.nonDisplay, item.appearance.nonDisplay, `${item.label}: 非表示`);
      if (item.appearance.nonDisplay) return;
      assert.strictEqual(cell.color, item.appearance.color, `${item.label}: 色`);
      assert.strictEqual(cell.reverse, item.appearance.reverse, `${item.label}: 反転表示`);
      assert.strictEqual(cell.underline, item.appearance.underline, `${item.label}: 下線`);
      assert.strictEqual(cell.blink, item.appearance.blink, `${item.label}: 明滅`);
    });
  }

  test("DSPATR(ND) の項目は桁を占めるが文字が出ない", () => {
    const item = model.items.find(candidate => candidate.label === "HIDE");
    assert.ok(item);
    assert.strictEqual(item.appearance.nonDisplay, true);
    for (let col = item.column; col < item.column + (item.widthCols ?? 0); col += 1) {
      const cell = cellAt(item.row, col);
      assert.ok(cell?.nonDisplay, `${col} 桁目が非表示になっていない`);
      assert.strictEqual(charAt(item.row, col), " ", `${col} 桁目に文字が出ている`);
    }
  });
});

suite("描画ゴールデン: 条件で出ないものは出ていない", () => {
  /**
   * **逆向きの担保。** 出ているものを比べるだけでは
   * 「描いてはいけないものを描いていない」ことは分からない。
   *
   * 標識 50 で条件付けた項目は、標識をオフのまま出した実機の画面に無い。
   */
  test("標識 50 の項目は実機の画面に無い", () => {
    const item = model.items.find(candidate => candidate.label === "COND50");
    assert.ok(item, "条件付きの項目がモデルに無い");
    assert.strictEqual(item.condition.kind, "indicators");
    assert.strictEqual(
      rowHasText(item.row),
      false,
      "条件がオフなのに実機の画面に何か出ている"
    );
  });

  test("標識をオフに倒すとモデルからも消える", () => {
    const off = applyIndicators(model, { "50": "off" });
    assert.ok(
      !off.items.some(item => item.label === "COND50"),
      "標識オフでも項目が残っている"
    );
    // 無条件の項目は残る（オフにした標識と関係が無い）。
    assert.strictEqual(
      off.items.length,
      model.items.length - 1,
      "関係の無い項目まで消えている"
    );
  });

  test("標識をオンに倒すと戻る", () => {
    const on = applyIndicators(model, { "50": "on" });
    assert.ok(on.items.some(item => item.label === "COND50"), "標識オンで出てこない");
  });
});
