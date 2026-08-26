/**
 * 単独起動ハーネス（`dev/standalone.ts`）を**実際に操作して**確かめる e2e。
 *
 * ## なぜ要るか
 *
 * 拡張の統合テストは CI に載せていない（表示環境が要る。親 plan「CI に載せるもの」）。
 * 一方 GUI の桁ずれ・ドラッグの取りこぼしは、単体テストでは絶対に捕まらない。
 * ここが**GUI の回帰を拾える唯一の場所**になる。
 *
 * ## 動かし方
 *
 *   npm install --no-save playwright-core        # 依存には入れていない（下記）
 *   npm run dev:standalone -w rpg-cl-vscode-support
 *   npm run dev:e2e -w rpg-cl-vscode-support
 *
 * `playwright-core` を devDependency にしていないのは、**CI では動かせない**（ブラウザ本体が要る）
 * ためで、入れると「CI に載っているのに走っていないテスト」が生まれる。手動導入に留める。
 *
 * ブラウザは `PLAYWRIGHT_CHROMIUM` で明示するか、`~/.cache/ms-playwright/chromium-*` を自動で探す。
 * 配信はこのスクリプトが内蔵の静的サーバで行う（`DDS_STANDALONE_URL` で外部の URL も指定可）。
 */

import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const OUT_DIR = resolve(HERE, "out");

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error(
    "playwright-core が見つかりません。\n" +
      "  npm install --no-save playwright-core\n" +
      "を実行してから、もう一度お試しください（依存には入れていません）。"
  );
  process.exit(2);
}

/** キャッシュ済みの Chromium を探す。 */
async function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) {
    return process.env.PLAYWRIGHT_CHROMIUM;
  }
  const root = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(root)) {
    return undefined;
  }
  const entries = (await readdir(root))
    .filter(name => name.startsWith("chromium-"))
    .sort();
  for (const entry of entries.reverse()) {
    for (const candidate of [
      join(root, entry, "chrome-linux64", "chrome"),
      join(root, entry, "chrome-linux", "chrome")
    ]) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

/** dev/out を配信する（外部サーバを立てずに 1 コマンドで回すため）。 */
async function serve() {
  if (!existsSync(join(OUT_DIR, "index.html"))) {
    console.error(
      "dev/out/index.html がありません。先に `npm run dev:standalone` を実行してください。"
    );
    process.exit(2);
  }
  const server = createServer(async (request, response) => {
    const path = (request.url ?? "/").split("?")[0];
    const file = join(OUT_DIR, path === "/" ? "index.html" : path.slice(1));
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        "Content-Type": MIME[extname(file)] ?? "application/octet-stream"
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/index.html` };
}

const executablePath = await findChromium();
if (executablePath === undefined) {
  console.error(
    "Chromium が見つかりません。PLAYWRIGHT_CHROMIUM で実行ファイルを指すか、\n" +
      "`npx playwright install chromium` でキャッシュに入れてください。"
  );
  process.exit(2);
}

const hosted = process.env.DDS_STANDALONE_URL ? null : await serve();
const URL_TO_OPEN = process.env.DDS_STANDALONE_URL ?? hosted.url;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
}

const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-gpu"]
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => {
  // favicon の 404 は数えない（ハーネスにアイコンを置いていないだけ）。
  const where = message.location()?.url ?? "";
  if (message.type() === "error" && !where.includes("favicon")) {
    errors.push(`${message.text()} @ ${where}`);
  }
});

await page.goto(URL_TO_OPEN, { waitUntil: "networkidle" });
await page.waitForSelector(".dds-item");

/** ソース面の行テキストを配列で取る。 */
const sourceLines = () =>
  page.$$eval("#source .line .text", nodes => nodes.map(node => node.textContent));
const changedLines = () =>
  page.$$eval("#source .line.changed", nodes =>
    nodes.map(node => Number(node.dataset.line))
  );
const byteState = () => page.$eval("#byteState", node => node.textContent);
const metrics = () => page.$eval(".dds-metrics", node => node.textContent);

const before = await sourceLines();
console.log("--- 測定値:", await metrics());

// ---- 1. セル幅の実測と DBCS の桁 ------------------------------------
const cell = await page.evaluate(() => {
  const frame = document.querySelector(".dds-frame");
  const style = getComputedStyle(frame);
  return {
    w: parseFloat(style.getPropertyValue("--cell-w")),
    h: parseFloat(style.getPropertyValue("--cell-h"))
  };
});
check("セル幅を実測できている", cell.w > 0 && cell.h > 0, `${cell.w}px × ${cell.h}px`);

const dbcs = await page.evaluate(() => {
  const item = [...document.querySelectorAll(".dds-item.constant")].find(node =>
    node.textContent.includes("社員番号")
  );
  if (!item) return null;
  const canvasNode = document.querySelector(".dds-canvas");
  const canvas = canvasNode.getBoundingClientRect();
  // キャンバスには枠線があり、アイテムは枠の内側（padding box）を基準に置かれる。
  const border = parseFloat(getComputedStyle(canvasNode).borderLeftWidth) || 0;
  const box = item.getBoundingClientRect();
  return {
    width: box.width,
    offset: box.left - canvas.left - border,
    widthCols: Number(item.dataset.width),
    pos: Number(item.dataset.pos)
  };
});
check(
  "DBCS 定数の箱が widthCols どおり（SO/SI 込み 10 桁）",
  dbcs !== null && Math.abs(dbcs.width - dbcs.widthCols * cell.w) < 0.5 && dbcs.widthCols === 10,
  dbcs ? `幅 ${dbcs.width.toFixed(1)}px = ${dbcs.widthCols} 桁 × ${cell.w}px` : "見つからない"
);
check(
  "DBCS 定数の左端が桁 2（pos どおり）",
  dbcs !== null && Math.abs(dbcs.offset - (dbcs.pos - 1) * cell.w) < 0.5,
  dbcs ? `左端 ${dbcs.offset.toFixed(1)}px = (${dbcs.pos} - 1) 桁 × ${cell.w}px` : ""
);

// ---- 2. ドラッグで移動（AC1） ---------------------------------------
/** 指定 ID（未指定なら診断が付いていない最初のフィールド）の位置を取る。 */
const pick = (id) => page.evaluate(wanted => {
  const flagged = new Set(
    [...document.querySelectorAll(".dds-diagnostics li .target")]
      .map(node => node.textContent)
      .filter(Boolean)
  );
  const items = [...document.querySelectorAll(".dds-item.field")];
  const item = wanted
    ? items.find(node => node.dataset.id === wanted)
    : items.find(node => !flagged.has(node.dataset.id));
  if (!item) return null;
  const box = item.getBoundingClientRect();
  return {
    id: item.dataset.id,
    line: Number(item.dataset.line),
    pos: Number(item.dataset.pos),
    sourceLine: Number(item.dataset.sourceLine),
    x: box.left + box.width / 2,
    y: box.top + box.height / 2
  };
}, id ?? null);

/** ドラッグする。 */
const drag = async (from, cols, rows) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + cols * cell.w, from.y + rows * cell.h, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
};

// 04 の規則変更（decisions D6）の回帰: **元は移動できなかった項目**も、
// エラーが増えないなら動かせる。フィクスチャも直したので、いまは診断ゼロで開くはず。
check(
  "フィクスチャに診断が出ない（36-37 桁の小数桁を補正済み）",
  (await page.$$(".dds-diagnostics li")).length === 0,
  await page.$eval(".dds-diagnostics", node => node.textContent.trim())
);

const empno = await pick("EMPMNT#4");
await drag(empno, 2, 1);
check(
  "以前は拒否されていた項目（EMPNO）が動く",
  (await sourceLines())[empno.sourceLine].slice(38, 44) ===
    `${String(empno.line + 1).padStart(3, " ")}${String(empno.pos + 2).padStart(3, " ")}`,
  JSON.stringify((await sourceLines())[empno.sourceLine].slice(38, 44))
);
await page.click("#undo");
await page.waitForTimeout(200);

// 拒否経路（エラーを**増やす**操作）は、GUI でも理由が出ること。
await page.fill("#dds-field-name", "TOOLONG");
await page.fill("#dds-field-length", "60");
await page.click("#dds-add-field");
const addBox = await page.evaluate(() => {
  const box = document.querySelector(".dds-canvas").getBoundingClientRect();
  return { x: box.left, y: box.top };
});
const linesBeforeReject = await sourceLines();
await page.mouse.click(addBox.x + 39.5 * cell.w, addBox.y + 21.5 * cell.h);
await page.waitForTimeout(400);
const rejectedStatus = await page.$eval(".dds-toolbar .status", node => node.textContent);
check(
  "エラーを増やす操作は拒否され、理由が画面に出る",
  rejectedStatus.includes("エラー") &&
    (await sourceLines()).length === linesBeforeReject.length,
  `状態表示: ${JSON.stringify(rejectedStatus)}`
);

const target = await pick();
console.log("--- 対象:", JSON.stringify(target));

const moveCols = 6;
const moveRows = 3;
await drag(target, moveCols, moveRows);

const after = await sourceLines();
const line = after[target.sourceLine];
const expectedLine = String(target.line + moveRows).padStart(3, " ");
const expectedPos = String(target.pos + moveCols).padStart(3, " ");
check(
  "ドラッグで 39-41 桁（行）が更新される",
  line.slice(38, 41) === expectedLine,
  `期待 ${JSON.stringify(expectedLine)} / 実際 ${JSON.stringify(line.slice(38, 41))}`
);
check(
  "ドラッグで 42-44 桁（桁）が更新される",
  line.slice(41, 44) === expectedPos,
  `期待 ${JSON.stringify(expectedPos)} / 実際 ${JSON.stringify(line.slice(41, 44))}`
);
check(
  "38 桁目までと 45 桁目以降は不変",
  line.slice(0, 38) === before[target.sourceLine].slice(0, 38) &&
    line.slice(44) === before[target.sourceLine].slice(44),
  ""
);

// ---- 3. 他の行がバイト不変（AC2 / AC3） -----------------------------
const differing = after
  .map((text, index) => (text === before[index] ? null : index))
  .filter(index => index !== null);
check(
  "変わったのは編集した 1 行だけ",
  differing.length === 1 && differing[0] === target.sourceLine,
  `変更行: ${JSON.stringify(differing)}`
);
check("行数が変わらない", after.length === before.length, `${before.length} → ${after.length}`);
check("ソース面の印も 1 行だけ", (await changedLines()).length === 1, await byteState());

// ---- 4. キャンバス上の位置も追従している ----------------------------
const moved = await page.evaluate(id => {
  const item = document.querySelector(`.dds-item[data-id="${id}"]`);
  return item ? { line: Number(item.dataset.line), pos: Number(item.dataset.pos) } : null;
}, target.id);
check(
  "キャンバスの描画も新しい位置に更新される",
  moved !== null && moved.line === target.line + moveRows && moved.pos === target.pos + moveCols,
  JSON.stringify(moved)
);

// ---- 5. undo（ホストが肩代わりしない側・DD8） -----------------------
await page.click("#undo");
await page.waitForTimeout(200);
check(
  "ホスト側の undo で元のテキストに戻る",
  (await sourceLines()).join("\n") === before.join("\n"),
  await byteState()
);

// ---- 6. 削除（L1） --------------------------------------------------
const beforeDelete = await sourceLines();
await page.click(`.dds-item[data-id="${target.id}"]`);
await page.waitForTimeout(150);
await page.keyboard.press("Delete");
await page.waitForTimeout(300);
const afterDelete = await sourceLines();
check(
  "Delete でその行だけが消える",
  afterDelete.length === beforeDelete.length - 1 &&
    !afterDelete.includes(beforeDelete[target.sourceLine]),
  `${beforeDelete.length} → ${afterDelete.length} 行`
);

// ---- 6.5 リサイズと追加（残る L1 操作） -----------------------------
await page.selectOption("#sample", { index: 1 }); // golden-a.dspf
await page.waitForTimeout(300);
const resizeBase = await sourceLines();
const resizeTarget = await pick();
if (resizeTarget !== null) {
  await page.click(`.dds-item[data-id="${resizeTarget.id}"]`);
  await page.waitForTimeout(150);
  const handle = await page.evaluate(id => {
    const node = document.querySelector(`.dds-item[data-id="${id}"] .handle`);
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2,
             width: Number(node.parentElement.dataset.width) };
  }, resizeTarget.id);
  if (handle !== null) {
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x + 3 * cell.w, handle.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const resized = (await sourceLines())[resizeTarget.sourceLine];
    check(
      "リサイズで 30-34 桁（長さ）が変わる",
      Number(resized.slice(29, 34)) === handle.width + 3,
      `長さ欄 ${JSON.stringify(resized.slice(29, 34))}（元 ${handle.width}）`
    );
    const resizeDiff = (await sourceLines())
      .map((text, index) => (text === resizeBase[index] ? null : index))
      .filter(index => index !== null);
    check("リサイズでも変わるのは 1 行だけ", resizeDiff.length === 1, `変更行: ${JSON.stringify(resizeDiff)}`);
  } else {
    check("選択するとリサイズハンドルが出る", false, "ハンドルが見つからない");
  }
} else {
  check("golden-a.dspf に編集できるフィールドがある", false, "");
}

const addBase = await sourceLines();
await page.fill("#dds-field-name", "NEWFLD");
await page.fill("#dds-field-length", "7");
await page.click("#dds-add-field");
const canvasBox = await page.evaluate(() => {
  const box = document.querySelector(".dds-canvas").getBoundingClientRect();
  return { x: box.left, y: box.top };
});
// 20 行 30 桁のあたりへ置く（既存要素と重ならない位置）。
await page.mouse.click(canvasBox.x + 29.5 * cell.w, canvasBox.y + 19.5 * cell.h);
await page.waitForTimeout(400);
const addAfter = await sourceLines();
const added = addAfter.find(line => line.includes("NEWFLD"));
check(
  "フィールド追加で行が 1 本増える",
  addAfter.length === addBase.length + 1 && added !== undefined,
  added ? JSON.stringify(added.trimEnd()) : `${addBase.length} → ${addAfter.length} 行`
);
check(
  "追加した行の 39-44 桁がクリックした位置になる",
  added !== undefined && added.slice(38, 44) === " 20 30",
  added ? JSON.stringify(added.slice(38, 44)) : ""
);

// ---- 7. コメント・継続行の保持（AC3・messy.dspf） --------------------
await page.selectOption("#sample", { index: 2 }); // messy.dspf
await page.waitForTimeout(300);
const messyBefore = await sourceLines();
const messyItem = await page.evaluate(() => {
  const item = [...document.querySelectorAll(".dds-item")][0];
  if (!item) return null;
  const box = item.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2,
           sourceLine: Number(item.dataset.sourceLine) };
});
if (messyItem !== null) {
  await page.mouse.move(messyItem.x, messyItem.y);
  await page.mouse.down();
  await page.mouse.move(messyItem.x + 4 * cell.w, messyItem.y + 2 * cell.h, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const messyAfter = await sourceLines();
  const messyDiff = messyAfter
    .map((text, index) => (text === messyBefore[index] ? null : index))
    .filter(index => index !== null);
  check(
    "コメント・継続行を含む DDS でも 1 行しか変わらない",
    messyDiff.length === 1,
    `変更行: ${JSON.stringify(messyDiff)} / ${await byteState()}`
  );
} else {
  check("messy.dspf に編集できる項目がある", false, "項目が無い");
}

await page.screenshot({ path: process.argv[2] ?? join(OUT_DIR, "e2e.png") });
check("実行中に JS エラーが出ていない", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
hosted?.server.close();

const failed = results.filter(result => !result.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
process.exit(failed.length === 0 ? 0 : 1);
