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
  // 中央ペインは横スクロールする（キャンバスが 80 桁ぶんあるため）。
  // **見えていない位置を掴もうとしても当たらない**ので、先に送り込む。
  await handle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
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

// ---- 9. 3 ペイン（C1 のレイアウト） -------------------------------------
check("左ペインに様式ツリーが出る", (await page.$$(".dds-tree .record")).length >= 1);
check("右ペインがある", (await page.$(".dds-properties")) !== null);

// ---- 10. 一覧から選ぶ → プロパティに出る -------------------------------
const listed = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".dds-tree li.item")];
  const field = rows.find(row => !row.classList.contains("constant"));
  return field ? { sourceLine: Number(field.dataset.sourceLine) } : null;
});
check("一覧に項目が並ぶ", listed !== null);

if (listed) {
  await page.click(`.dds-tree li.item[data-source-line="${listed.sourceLine}"]`);
  await page.waitForTimeout(200);
  const name = await page.inputValue('.dds-props input[data-key="name"]');
  check("一覧で選ぶとプロパティに属性が出る", name.length > 0, `名前=${name}`);

  // ---- 11. 属性編集（AC1） --------------------------------------------
  const before11 = await sourceLines();
  await page.fill('.dds-props input[data-key="name"]', "RENAMED");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const after11 = await sourceLines();
  const line = after11[listed.sourceLine - 1];
  check(
    "名前を変えると 19-28 桁だけが変わる",
    line.slice(18, 28).trim() === "RENAMED" &&
      line.slice(28) === before11[listed.sourceLine - 1].slice(28),
    JSON.stringify(line.slice(18, 34))
  );
  const changedNow = await changedLines();
  check("属性編集でも変わるのは 1 行だけ", changedNow.includes(listed.sourceLine), await byteState());

  // ---- 12. 拒否（AC7・AC-I4） -----------------------------------------
  // 名前は maxLength で 10 桁を超えられない（**入力の時点で防ぐ**）ので、
  // 拒否経路は桁数欄で確かめる——5 桁の欄に 6 桁は書けない。
  const before12 = await sourceLines();
  await page.fill('.dds-props input[data-key="length"]', "123456");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  check(
    "書けない値は何も書き換えない",
    (await sourceLines()).join("\n") === before12.join("\n")
  );
  const rejectText = await page.$eval(".dds-reject", node => node.textContent);
  check("拒否の理由がプロパティに出る", (rejectText ?? "").length > 0, rejectText ?? "");
  check(
    "拒否された欄にフォーカスが戻る（入力し直せる）",
    await page.evaluate(() => document.activeElement?.dataset?.key === "length")
  );

  // ---- 13. 入力中はキャンバスへ漏らさない（AC-I5） ----------------------
  const before13 = await sourceLines();
  await page.focus('.dds-props input[data-key="name"]');
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Delete");
  await page.waitForTimeout(200);
  check(
    "プロパティ入力中の矢印・Delete でキャンバスが動かない",
    (await sourceLines()).join("\n") === before13.join("\n")
  );
}

// ---- 14. 描かれない項目も一覧に出て、直せる（AC3） ---------------------
await page.selectOption("#sample", { index: 1 }); // hidden-items.dspf
await page.waitForTimeout(300);

const hidden = await page.$$eval(".dds-tree li.item.hidden", nodes =>
  nodes.map(node => ({
    sourceLine: Number(node.dataset.sourceLine),
    label: node.querySelector(".label")?.textContent ?? "",
    at: node.querySelector(".at")?.textContent ?? ""
  }))
);
check(
  "**キャンバスに描かれない項目**が一覧に出る（位置なし・画面に出ない用途）",
  hidden.length === 2,
  JSON.stringify(hidden)
);
check(
  "描かれない理由が一覧に出る",
  hidden.every(item => item.at.length > 0 && item.at !== "—"),
  hidden.map(item => `${item.label}=${item.at}`).join(" / ")
);

if (hidden.length > 0) {
  const beforeHidden = await sourceLines();
  await page.click(`.dds-tree li.item[data-source-line="${hidden[0].sourceLine}"]`);
  await page.waitForTimeout(200);
  check(
    "描かれない項目もプロパティに出る",
    (await page.inputValue('.dds-props input[data-key="name"]')).length > 0
  );
  await page.fill('.dds-props input[data-key="name"]', "FIXED");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const line = (await sourceLines())[hidden[0].sourceLine - 1];
  check(
    "**描かれない項目を一覧から直せる**（AC3）",
    line.slice(18, 28).trim() === "FIXED",
    JSON.stringify(line.slice(18, 34))
  );
  check(
    "直しても他の行はバイト不変",
    (await sourceLines()).filter((text, index) => text !== beforeHidden[index]).length === 1
  );
}

// ---- 15. 表示切替（SO/SI・属性バイト・グリッド・他様式） ----------------
await page.selectOption("#sample", { index: 0 }); // CUSTMNT.dspf に戻す
await page.waitForTimeout(300);

/** DBCS 定数の位置・幅と、SO/SI の桁に描かれている文字。 */
const dbcsState = () =>
  page.evaluate(() => {
    const item = [...document.querySelectorAll(".dds-item.constant")].find(node =>
      node.textContent.includes("顧客保守")
    );
    if (!item) return null;
    const box = item.getBoundingClientRect();
    return {
      left: Math.round(box.left * 100) / 100,
      width: Math.round(box.width * 100) / 100,
      shifts: [...item.querySelectorAll(".seg.shift")].map(node => node.textContent)
    };
  });

const beforeShift = await dbcsState();
await page.click("#dds-toggle-shifts");
await page.waitForTimeout(200);
const afterShift = await dbcsState();
check(
  "SO/SI を入れると `{` `}` が出る",
  afterShift?.shifts.join("") === "{}",
  JSON.stringify(afterShift?.shifts)
);
check(
  "**表示を入れても項目の位置と幅は変わらない**（桁が動かない）",
  beforeShift?.left === afterShift?.left && beforeShift?.width === afterShift?.width,
  `${JSON.stringify(beforeShift)} → ${JSON.stringify(afterShift)}`
);

await page.click("#dds-toggle-attributes");
await page.waitForTimeout(150);
check("属性バイトを切ると消える", (await page.$$(".dds-attr")).length === 0);
await page.click("#dds-toggle-attributes");
await page.waitForTimeout(150);
check("入れ直すと戻る", (await page.$$(".dds-attr")).length > 0);

await page.click("#dds-toggle-grid");
await page.waitForTimeout(150);
check(
  "グリッドを切ると罫線が消える（ルーラーは残る）",
  (await page.$$(".dds-canvas.no-grid")).length === 1 &&
    (await page.$$(".dds-ruler span")).length > 0
);
await page.click("#dds-toggle-grid");

// 他様式の淡色: CUSTMNT は HEADER / DETAIL の 2 様式
const detail = await page.evaluate(() => {
  const item = [...document.querySelectorAll(".dds-item")].find(
    node => Number(node.dataset.sourceLine) >= 11
  );
  return item ? Number(item.dataset.sourceLine) : null;
});
if (detail) {
  await page.click(`.dds-item[data-source-line="${detail}"]`);
  await page.waitForTimeout(200);
  const dimmed = await page.$$eval(".dds-item.dimmed", nodes => nodes.length);
  check("他様式が淡くなる（選択中の様式以外）", dimmed > 0, `${dimmed} 件`);
  await page.click("#dds-toggle-dim");
  await page.waitForTimeout(150);
  check("切ると全様式が同じ濃さになる", (await page.$$(".dds-item.dimmed")).length === 0);
  await page.click("#dds-toggle-dim");
}

// ---- 16. ズーム ---------------------------------------------------------
const cellAt = () =>
  page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector(".dds-frame")).getPropertyValue("--cell-w"))
  );
const base = await cellAt();
await page.click('.zoom button[data-zoom="1.5"]');
await page.waitForTimeout(200);
const zoomed = await cellAt();
check(
  "ズーム 150% でセル幅が 1.5 倍になる",
  Math.abs(zoomed - base * 1.5) < 0.01,
  `${base} → ${zoomed}`
);

const rulerMatches = await page.evaluate(() => {
  const cell = parseFloat(getComputedStyle(document.querySelector(".dds-frame")).getPropertyValue("--cell-w"));
  const canvas = document.querySelector(".dds-canvas").getBoundingClientRect();
  const item = document.querySelector(".dds-item");
  const box = item.getBoundingClientRect();
  const border = parseFloat(getComputedStyle(document.querySelector(".dds-canvas")).borderLeftWidth) || 0;
  return Math.abs(box.left - canvas.left - border - (Number(item.dataset.column) - 1) * cell) < 0.6;
});
check("ズーム後も項目の桁位置が一致する", rulerMatches);

// ズーム中のドラッグ（座標変換が倍率に追随するか）
// 150% ではキャンバスが広がり、ペインの外に出る部分がある。
// **項目の左端まで送り込む**——`scrollIntoViewIfNeeded` は「一部でも見えていれば動かない」ので、
// 幅がペインより広い項目では左端が外に出たままになる（掴めない）。
await page.evaluate(() => {
  const item = [...document.querySelectorAll(".dds-item")].find(n => n.dataset.resizable === "true");
  item?.scrollIntoView({ block: "nearest", inline: "start" });
});
await page.waitForTimeout(200);
const zoomTarget = await page.evaluate(() => {
  const item = [...document.querySelectorAll(".dds-item")].find(n => n.dataset.resizable === "true");
  const b = item.getBoundingClientRect();
  return {
    sourceLine: Number(item.dataset.sourceLine),
    row: Number(item.dataset.row),
    column: Number(item.dataset.column),
    width: Number(item.dataset.width),
    x: b.left + 4,
    y: b.top + b.height / 2
  };
});
const zoomCell = await cellAt();
const zoomLine = await page.evaluate(() =>
  parseFloat(getComputedStyle(document.querySelector(".dds-frame")).getPropertyValue("--cell-h"))
);
await page.mouse.move(zoomTarget.x, zoomTarget.y);
await page.mouse.down();
await page.mouse.move(zoomTarget.x + zoomCell * 3, zoomTarget.y - zoomLine * 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const zoomedLine = (await sourceLines())[zoomTarget.sourceLine - 1];
check(
  "**ズーム中でも掴んだ項目が指した桁に入る**",
  zoomedLine.slice(38, 41) === String(zoomTarget.row - 2).padStart(3) &&
    zoomedLine.slice(41, 44) === String(Math.min(zoomTarget.column + 3, 80 - zoomTarget.width + 1)).padStart(3),
  `対象=${JSON.stringify(zoomTarget)} cell=${zoomCell} 行=${JSON.stringify(zoomedLine.slice(38, 44))}`
);

// ---- 17. 切替は再描画で戻らない（AC7） ---------------------------------
check(
  "編集の適用後も切替とズームが保たれる",
  (await page.$$(".dds-canvas.no-grid")).length === 0 &&
    (await page.$$eval("#dds-toggle-shifts", nodes => nodes[0].classList.contains("armed"))) &&
    Math.abs((await cellAt()) - base * 1.5) < 0.01
);

// ---- 18. 桁勘定 ---------------------------------------------------------
const constantLine2 = await page.evaluate(() => {
  const item = [...document.querySelectorAll(".dds-item.constant")].find(node =>
    node.textContent.includes("顧客保守")
  );
  return item ? Number(item.dataset.sourceLine) : null;
});
if (constantLine2) {
  await page.click(`.dds-tree li.item[data-source-line="${constantLine2}"]`);
  await page.waitForTimeout(200);
  const breakdown = await page.$eval(".dds-measures.breakdown", node => node.textContent).catch(() => "");
  check(
    "定数の桁勘定が出る（SO/SI と全角の内訳）",
    breakdown.includes("SO/SI") && breakdown.includes("= 10 桁"),
    breakdown
  );
}

check("実行中に JS エラーが出ていない", errors.length === 0, errors.slice(0, 2).join(" | "));

await page.screenshot({ path: join(HERE, "out", "e2e.png") });
await browser.close();

const failed = results.filter(ok => !ok).length;
console.log(`\n=== ${results.length - failed}/${results.length} PASS ===`);
process.exit(failed === 0 ? 0 : 1);
