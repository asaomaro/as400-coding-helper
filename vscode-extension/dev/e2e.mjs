/**
 * 単独起動ハーネスを**実際に操作して**確かめる e2e。
 *
 * ## なぜ要るか
 *
 * このエディタの中身は WebView で、**拡張ホストからは触れない**（統合テストでも中は動かせない）。
 * 一方でこの機能の中身は「掴んで動かす・つまみで伸ばす・置く・消す」という**操作そのもの**。
 * HTML に文字列が含まれることを確かめても、**押して動くか**は分からない。
 *
 * ここでは単独起動ハーネスをブラウザで開いて実際に操作し、
 * **ソース面の変化**（どの行が変わったか）まで見る。UI とホストと core が
 * 繋がって初めて通るので、繋ぎ目の取り違えもここで落ちる。
 *
 * ## 動かし方
 *
 *   npm install --no-save playwright-core     # 依存には入れない（CI にブラウザが無いため）
 *   npm run compile:webview
 *   npm run dev:e2e
 */

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PAGE = join(HERE, "out", "index.html");

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error("playwright-core が見つかりません。`npm install --no-save playwright-core` を実行してください。");
  process.exit(2);
}

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const cache = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(cache)) return undefined;
  for (const entry of readdirSync(cache).filter(n => n.startsWith("chromium-")).sort().reverse()) {
    for (const candidate of [
      join(cache, entry, "chrome-linux64", "chrome"),
      join(cache, entry, "chrome-linux", "chrome")
    ]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const executablePath = findChromium();
if (!executablePath) {
  console.error("Chromium が見つかりません（PLAYWRIGHT_CHROMIUM で指定できます）。");
  process.exit(2);
}
if (!existsSync(PAGE)) {
  console.error("dev/out/index.html がありません。先に `npm run compile:webview` を実行してください。");
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => {
  if (message.type() === "error") errors.push(message.text());
});

await page.goto(pathToFileURL(PAGE).href, { waitUntil: "load" });
await page.waitForSelector(".dds-item");

const sourceLines = () =>
  page.$$eval("#source .line .text", nodes => nodes.map(node => node.textContent));
const changedLines = () =>
  page.$$eval("#source .line.changed", nodes => nodes.map(node => Number(node.dataset.line)));
const byteState = () => page.$eval("#byteState", node => node.textContent);
const cell = () =>
  page.evaluate(() => {
    const frame = document.querySelector(".dds-frame");
    return parseFloat(getComputedStyle(frame).getPropertyValue("--cell-w"));
  });

const before = await sourceLines();
const metrics = await page.$eval(".dds-metrics", node => node.textContent);
console.log("--- 測定値:", metrics);

// ---- 1. 描画（桁が core の計算どおりか） --------------------------------
const cellWidth = await cell();
const dbcs = await page.evaluate(() => {
  const item = [...document.querySelectorAll(".dds-item.constant")].find(node =>
    node.textContent.includes("顧客保守")
  );
  if (!item) return null;
  const canvas = document.querySelector(".dds-canvas");
  const border = parseFloat(getComputedStyle(canvas).borderLeftWidth) || 0;
  const box = item.getBoundingClientRect();
  return {
    width: box.width,
    offset: box.left - canvas.getBoundingClientRect().left - border,
    widthCols: Number(item.dataset.width),
    column: Number(item.dataset.column)
  };
});
// '顧客保守' は SO(1) + 全角 4 文字 × 2 + SI(1) = 10 桁。
check(
  "DBCS 定数の箱が widthCols（SO/SI 込み）どおり",
  dbcs && Math.abs(dbcs.width - dbcs.widthCols * cellWidth) < 0.6 && dbcs.widthCols === 10,
  dbcs ? `幅 ${dbcs.width.toFixed(1)}px = ${dbcs.widthCols} 桁` : "見つからない"
);
check(
  "DBCS 定数の左端が桁どおり（1 桁ずれない）",
  dbcs && Math.abs(dbcs.offset - (dbcs.column - 1) * cellWidth) < 0.6,
  dbcs ? `左端 ${dbcs.offset.toFixed(1)}px = (${dbcs.column} - 1) 桁` : ""
);

// ---- 2. ドラッグ移動 ----------------------------------------------------
const target = await page.evaluate(() => {
  const item = [...document.querySelectorAll(".dds-item")].find(
    node => node.dataset.resizable === "true"
  );
  if (!item) return null;
  const box = item.getBoundingClientRect();
  return {
    sourceLine: Number(item.dataset.sourceLine),
    row: Number(item.dataset.row),
    column: Number(item.dataset.column),
    width: Number(item.dataset.width),
    x: box.left + 4,
    y: box.top + box.height / 2
  };
});
console.log("--- 対象:", JSON.stringify(target));

const drag = async (from, cols, rows) => {
  const lineHeight = await page.evaluate(() => {
    const frame = document.querySelector(".dds-frame");
    return parseFloat(getComputedStyle(frame).getPropertyValue("--cell-h"));
  });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + cols * cellWidth, from.y + rows * lineHeight, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
};

await drag(target, 5, 2);
const afterMove = await sourceLines();
const movedLine = afterMove[target.sourceLine - 1];
// UI は画面の外へ出す位置を提示しない（行は 24 まで、桁は幅ぶん余白を残す）。
// **その丸めも含めて期待値にする**——丸めを無視すると「動いていない」と誤検出する。
const expectedRow = Math.min(target.row + 2, 24);
const expectedColumn = Math.min(target.column + 5, 80 - target.width + 1);
check(
  "ドラッグで 39-41 / 42-44 桁（行・桁）が更新される",
  movedLine.slice(38, 41) === String(expectedRow).padStart(3) &&
    movedLine.slice(41, 44) === String(expectedColumn).padStart(3),
  `期待 ${expectedRow}/${expectedColumn} / 実際 ${JSON.stringify(movedLine.slice(38, 44))}`
);
check(
  "38 桁目までと 45 桁目以降は不変",
  movedLine.slice(0, 38) === before[target.sourceLine - 1].slice(0, 38) &&
    movedLine.slice(44) === before[target.sourceLine - 1].slice(44)
);
check(
  "変わったのは 1 行だけ（他はバイト不変）",
  (await changedLines()).length === 1,
  await byteState()
);

// ---- 3. つまみで長さ変更 ------------------------------------------------
await page.click(`.dds-item[data-source-line="${target.sourceLine}"]`);
await page.waitForTimeout(150);
const handle = await page.$(`.dds-item[data-source-line="${target.sourceLine}"] .handle`);
check("選択するとつまみが出る（フィールドのみ）", handle !== null);
if (handle) {
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + cellWidth * 4, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const resized = (await sourceLines())[target.sourceLine - 1];
  check(
    "つまみで 30-34 桁（長さ）が変わる",
    Number(resized.slice(29, 34)) === target.width + 4,
    `長さ欄 ${JSON.stringify(resized.slice(29, 34))}（元 ${target.width}）`
  );
}

// ---- 4. 定数につまみは出ない --------------------------------------------
const constantLine = await page.evaluate(() => {
  const item = document.querySelector(".dds-item.constant");
  return item ? Number(item.dataset.sourceLine) : null;
});
await page.click(`.dds-item[data-source-line="${constantLine}"]`);
await page.waitForTimeout(150);
check(
  "定数につまみは出ない（桁数欄を持たないため）",
  (await page.$(`.dds-item[data-source-line="${constantLine}"] .handle`)) === null
);

// ---- 5. キーボード ------------------------------------------------------
const beforeArrow = (await sourceLines())[constantLine - 1];
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(200);
const afterArrow = (await sourceLines())[constantLine - 1];
check(
  "矢印キーで 1 桁動く",
  Number(afterArrow.slice(41, 44)) === Number(beforeArrow.slice(41, 44)) + 1,
  `${beforeArrow.slice(41, 44)} → ${afterArrow.slice(41, 44)}`
);

await page.keyboard.press("Escape");
await page.waitForTimeout(100);
const linesBeforeDelete = await sourceLines();
await page.keyboard.press("Delete");
await page.waitForTimeout(200);
check(
  "選択が外れていれば Delete は何もしない",
  (await sourceLines()).length === linesBeforeDelete.length
);

// ---- 6. 追加（ホストが内容を聞く） --------------------------------------
const beforeAdd = await sourceLines();
await page.click("#dds-add-field");
const canvasBox = await page.locator(".dds-canvas").boundingBox();
await page.mouse.click(canvasBox.x + cellWidth * 30, canvasBox.y + 13 * 12);
await page.waitForTimeout(200);
await page.fill("#ask-name", "NEWFLD");
await page.fill("#ask-length", "7");
await page.click("#ask-ok");
await page.waitForTimeout(300);
const afterAdd = await sourceLines();
const added = afterAdd.find(line => line.includes("NEWFLD"));
check(
  "フィールドを置くと行が 1 本増える",
  afterAdd.length === beforeAdd.length + 1 && added !== undefined,
  added ? JSON.stringify(added.trimEnd()) : `${beforeAdd.length} → ${afterAdd.length}`
);
check(
  "追加した行の 30-34 / 39-44 桁が指定どおり",
  added !== undefined && Number(added.slice(29, 34)) === 7 && added.slice(38, 44).trim().length > 0,
  added ? JSON.stringify(added.slice(29, 44)) : ""
);

// ---- 7. 削除 ------------------------------------------------------------
const beforeRemove = await sourceLines();
await page.click(`.dds-item[data-source-line="${constantLine}"]`);
await page.waitForTimeout(150);
await page.keyboard.press("Delete");
await page.waitForTimeout(250);
const afterRemove = await sourceLines();
check(
  "Delete でその行が消える",
  afterRemove.length === beforeRemove.length - 1 &&
    !afterRemove.includes(beforeRemove[constantLine - 1]),
  `${beforeRemove.length} → ${afterRemove.length} 行`
);

// ---- 8. undo（ホストが肩代わりしない側） --------------------------------
await page.click("#undo");
await page.waitForTimeout(250);
check(
  "ホスト側の undo で 1 手戻る",
  (await sourceLines()).length === beforeRemove.length,
  await byteState()
);

check("実行中に JS エラーが出ていない", errors.length === 0, errors.slice(0, 2).join(" | "));

await page.screenshot({ path: join(HERE, "out", "e2e.png") });
await browser.close();

const failed = results.filter(ok => !ok).length;
console.log(`\n=== ${results.length - failed}/${results.length} PASS ===`);
process.exit(failed === 0 ? 0 : 1);
