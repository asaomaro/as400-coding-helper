import * as assert from "assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePrtfLayout } from "../../src/core/dds/prtfLayout";
import {
  buildPrtfPreviewHtml,
  buildRuler
} from "../../src/language/prtfPreviewHtml";

/**
 * 帳票プレビューの HTML。
 *
 * 見るのは**桁が計算値どおりに出ているか**。等幅フォントでも全角が
 * ちょうど 2 倍幅になる保証は無いので、表示をフォントに委ねていないことを
 * ここで固定する。
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const SRC_DIR = join(ROOT, "docs", "src");

const OPTIONS = {
  cspSource: "vscode-resource:",
  nonce: "testnonce",
  title: "CUSTRPT.prtf"
};

function htmlFor(lines: readonly string[], activeSourceLine?: number): string {
  return buildPrtfPreviewHtml(resolvePrtfLayout(lines), {
    ...OPTIONS,
    ...(activeSourceLine !== undefined ? { activeSourceLine } : {})
  });
}

const sampleLines = readFileSync(join(SRC_DIR, "CUSTRPT.prtf"), "utf8").split(
  /\r?\n/
);

/** `left: calc(var(--cell) * N)` の N を全部拾う。 */
function cellMultipliers(html: string, property: "left" | "width"): number[] {
  const pattern = new RegExp(`${property}: calc\\(var\\(--cell\\) \\* (-?\\d+)\\)`, "gu");
  return [...html.matchAll(pattern)].map(match => Number(match[1]));
}

suite("PRTF プレビュー: 桁の置き方", () => {
  const html = htmlFor(sampleLines);

  test("位置は --cell の整数倍で置く（フォントに依存しない）", () => {
    const lefts = cellMultipliers(html, "left");
    assert.ok(lefts.length > 0, "項目が 1 つも出ていない");
    for (const value of lefts) {
      assert.ok(Number.isInteger(value), `left が整数でない: ${value}`);
      assert.ok(value >= 0, `left が負: ${value}`);
    }
  });

  test("幅も --cell の整数倍で固定する", () => {
    for (const value of cellMultipliers(html, "width")) {
      assert.ok(Number.isInteger(value) && value > 0, `width が不正: ${value}`);
    }
  });

  test("全角を含む定数でも桁は計算値どおり（12 桁）", () => {
    // '顧客一覧表' は 30 桁目・幅 12 桁。JS の文字数（5）ではない。
    assert.ok(
      html.includes("left: calc(var(--cell) * 29)"),
      "30 桁目に置かれていない"
    );
    assert.ok(
      html.includes("width: calc(var(--cell) * 12)"),
      "実機の桁（12）で箱が作られていない"
    );
  });

  test("箱からはみ出しても桁は動かさない（overflow: hidden）", () => {
    assert.ok(html.includes("overflow: hidden"));
  });

  test("行は line-height の整数倍で置く", () => {
    const tops = [...html.matchAll(/top: calc\(var\(--line-height\) \* (\d+)\)/gu)].map(
      match => Number(match[1])
    );
    assert.ok(tops.length > 0);
    for (const value of tops) assert.ok(Number.isInteger(value) && value >= 0);
  });
});

suite("PRTF プレビュー: 見せ方", () => {
  test("幅不明の項目は印を付ける", () => {
    const html = htmlFor(sampleLines);
    assert.ok(html.includes("unknown-width"), "REF の項目に印が無い");
    assert.ok(html.includes("REF で参照している"), "理由が出ていない");
  });

  test("項目にソース行を持たせる（相互ジャンプに使う）", () => {
    const html = htmlFor(sampleLines);
    assert.ok(/data-source-line="\d+"/u.test(html));
  });

  test("カーソル行の項目を強調する", () => {
    // CUSTRPT.prtf の 5 行目は定数の行。
    const html = htmlFor(sampleLines, 5);
    assert.ok(html.includes("item constant active"), "強調が付いていない");
  });

  test("紙面の大きさが反映される", () => {
    const html = htmlFor(sampleLines);
    assert.ok(html.includes("var(--cell) * 132"), "132 桁の紙面になっていない");
    assert.ok(html.includes("var(--line-height) * 66"), "66 行の紙面になっていない");
  });

  test("指摘が無ければその旨を出す", () => {
    assert.ok(htmlFor(sampleLines).includes("指摘はありません"));
  });

  test("指摘があれば一覧に出す", () => {
    const field = (name: string, column: string) =>
      " ".repeat(5) + "A" + " ".repeat(12) + name.padEnd(10) + "   10" +
      " ".repeat(4) + "  1" + column.padStart(3);
    const overlapping = ["     A          R REC", field("F1", "1"), field("F2", "5")];
    const html = htmlFor(overlapping);
    assert.ok(html.includes("件の指摘"));
    assert.ok(html.includes("重なっています"));
  });
});

suite("PRTF プレビュー: 安全性", () => {
  test("CSP と nonce を埋める", () => {
    const html = htmlFor(sampleLines);
    assert.ok(html.includes("Content-Security-Policy"));
    assert.ok(html.includes("'nonce-testnonce'"));
    assert.ok(html.includes('<script nonce="testnonce">'));
  });

  test("項目の文字を HTML エスケープする", () => {
    // 45 桁目から定数。桁を間違えると項目として読まれず、素通りしたのに
    // 「エスケープされている」と見えてしまうので、桁を明示して組む。
    const constantLine =
      " ".repeat(5) + "A" + " ".repeat(35) + "  1" + "'<img src=x>'";
    const injected = ["     A          R REC", constantLine];
    const html = htmlFor(injected);
    assert.ok(!html.includes("<img src=x>"), "エスケープされていない");
    assert.ok(html.includes("&lt;img src=x&gt;"));
  });
});

suite("PRTF プレビュー: ルーラー", () => {
  test("5 桁ごとに + / 10 桁ごとに数字", () => {
    assert.strictEqual(buildRuler(20), "....+....1....+....2");
  });

  test("紙面の桁数と同じ長さになる", () => {
    assert.strictEqual(buildRuler(132).length, 132);
  });
});

/**
 * ドラッグで位置を動かす経路（review ラウンド 1 の should）。
 *
 * 受け口（`prtfPreview.ts` の `type: "move"`）だけあって送る側が無いと、
 * ロジックが実装済みに見えるのに**利用者は項目を動かせない**。
 * AGENTS.md「追加したリソースは到達可能になって初めて完了」。
 */
suite("PRTF プレビュー: ドラッグの経路", () => {
  const html = htmlFor(sampleLines);

  test("項目がドラッグできる", () => {
    assert.ok(html.includes('draggable="true"'), "draggable が付いていない");
    assert.ok(html.includes("movable"), "動かせる印が無い");
  });

  test("項目が現在の行・桁を持つ（落とす位置の計算に使う）", () => {
    assert.ok(/data-row="\d+"/u.test(html));
    assert.ok(/data-column="\d+"/u.test(html));
  });

  test("落としたら move を送る（受け口と対になっている）", () => {
    assert.ok(
      html.includes("type: 'move'"),
      "move を送る箇所が無い＝受け口が死蔵になる"
    );
    assert.ok(html.includes("addEventListener('drop'"), "drop を拾っていない");
  });

  test("落とす位置は計算で桁に直す（見た目に合わせない）", () => {
    // 実際に描かれた項目の位置から 1 桁の実寸を逆算する。
    assert.ok(html.includes("function toCell"), "桁への変換が無い");
    assert.ok(html.includes("Math.round"), "桁に丸めていない");
  });

  test("クリック（ジャンプ）とドラッグが両立する", () => {
    assert.ok(html.includes("type: 'reveal'"));
    assert.ok(html.includes("type: 'move'"));
  });
});
