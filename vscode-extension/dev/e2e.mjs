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

// ---- 19. 条件標識（表示だけを変える。ソースは 1 文字も変わらない） -------
await page.selectOption("#sample", { label: "indicators.dspf" });
await page.waitForTimeout(250);

const indicatorList = () => page.$$eval(".ind-row .no", nodes => nodes.map(n => n.textContent));
// SO/SI 表示が入っていると `{部門名}` の形で出るので、**含むか**で見る（完全一致では落ちる）。
const drawnLabels = () => page.$$eval(".dds-item", nodes => nodes.map(n => n.textContent));
const treeText = () => page.$eval(".dds-outline", node => node.textContent);
const setInd = async (indicator, value) => {
  await page.click(`.ind-choice button[data-indicator="${indicator}"][data-value="${value}"]`);
  await page.waitForTimeout(120);
};

check(
  "標識の一覧にキーワードだけの行の標識も出る（30）",
  JSON.stringify(await indicatorList()) === JSON.stringify(["01", "02", "30", "50"]),
  JSON.stringify(await indicatorList())
);

const drawnBefore = await drawnLabels();
const sourceBefore = await sourceLines();

await setInd("50", "on");
const drawnOn = await drawnLabels();
check(
  "標識をオンにすると不成立の項目がキャンバスから消える",
  drawnOn.some(l => l.includes("部門名")) && !drawnOn.some(l => l.includes("未定")),
  JSON.stringify(drawnOn)
);
check("消えた項目は一覧に理由付きで残る", (await treeText()).includes("条件で非表示"));

await setInd("50", "off");
const drawnOff = await drawnLabels();
check(
  "オフにすると逆の項目が出る（N50）",
  drawnOff.some(l => l.includes("未定")) && !drawnOff.some(l => l.includes("部門名")),
  JSON.stringify(drawnOff)
);

check(
  "**標識を切り替えてもソースは変わらない**",
  JSON.stringify(await sourceLines()) === JSON.stringify(sourceBefore) &&
    (await changedLines()).length === 0
);

// 未設定を含む条件は消さない（01 だけ倒しても 02 の項目は残る）。
await setInd("01", "off");
check(
  "未設定を含む条件の項目は消えない",
  (await drawnLabels()).filter(label => label.startsWith("XXXX")).length === 1,
  JSON.stringify(await drawnLabels())
);

// ---- 19b. 条件つきの DSPATR（キーワードにも条件が付く）------------------
//
// `30 DSPATR(RI)` は FLD2 のキーワードだけを条件付ける。**項目は出たまま反転表示だけ消える。**
// 直す前は条件が捨てられており、標識を倒しても反転したままだった。
await setInd("01", "unset");
const fld2Classes = () =>
  page.$$eval(".dds-item", nodes =>
    nodes.filter(n => n.textContent.startsWith("XXXX")).map(n => n.className)
  );

check(
  "既定では条件つき DSPATR も効く（未設定は決まらない＝効かせる）",
  (await fld2Classes()).some(c => c.includes("reverse")),
  JSON.stringify(await fld2Classes())
);

await setInd("30", "off");
const offClasses = await fld2Classes();
check(
  "**条件つき DSPATR は不成立で効かなくなる（項目は残る）**",
  offClasses.length === 2 && !offClasses.some(c => c.includes("reverse")),
  JSON.stringify(offClasses)
);

await setInd("30", "on");
check(
  "成立させると戻る",
  (await fld2Classes()).some(c => c.includes("reverse")),
  JSON.stringify(await fld2Classes())
);

// プロパティにキーワード行とその条件が出る。
await page.click(".dds-item:has-text('XXXX') >> nth=1");
await page.waitForTimeout(150);
const kwRowText = await page
  .$eval(".dds-conditional-keyword .kw", node => node.textContent)
  .catch(() => "");
const kwCondValue = () =>
  page.inputValue('.dds-props input[data-key="keywordCondition"]');
check(
  "プロパティでキーワード行が読める",
  kwRowText.includes("DSPATR(RI)"),
  kwRowText
);
check("その行の条件が短い形で読める", (await kwCondValue()) === "30", await kwCondValue());

await setInd("30", "unset");
check(
  "**条件を切り替えてもソースは変わらない**",
  JSON.stringify(await sourceLines()) === JSON.stringify(sourceBefore) &&
    (await changedLines()).length === 0
);

await setInd("01", "off");

// その状態での重なり（AC6）。
const diagnostics = () => page.$eval(".dds-diagnostics", node => node.textContent);
check("指定していない標識では状態つきの重なりを出さない", !(await diagnostics()).includes("重なります"));
await setInd("01", "on");
await setInd("02", "on");
check(
  "**その標識の状態で同時に出る項目の重なりを指摘する**",
  (await diagnostics()).includes("01=オン") && (await diagnostics()).includes("重なります"),
  (await diagnostics()).slice(0, 120)
);

// 矢印キーはキャンバスへ漏らさない（AC-I5）。
await page.click(".dds-item");
await page.waitForTimeout(120);
const selectedLine = await page.$eval(".dds-item.selected", node => Number(node.dataset.sourceLine));
const beforeArrowKey = (await sourceLines())[selectedLine - 1];
await page.click('.ind-choice button[data-indicator="30"][data-value="unset"]');
await page.waitForTimeout(120);
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(150);
check(
  "**標識の矢印キーがキャンバスの項目を動かさない**",
  (await sourceLines())[selectedLine - 1] === beforeArrowKey,
  `行=${selectedLine}`
);
check(
  "矢印キーで値が変わる（APG のラジオグループ）",
  await page.$eval('.ind-choice button[data-indicator="30"][data-value="on"]', node =>
    node.getAttribute("aria-checked") === "true"
  )
);
check(
  "切替の直後もフォーカスがその標識に残る",
  await page.evaluate(() => {
    const active = document.activeElement;
    return active?.dataset?.indicator === "30" && active.getAttribute("aria-checked") === "true";
  })
);

await page.click(".ind-reset");
await page.waitForTimeout(150);
check(
  "すべて未設定で元の見え方に戻る",
  JSON.stringify(await drawnLabels()) === JSON.stringify(drawnBefore),
  JSON.stringify(await drawnLabels())
);
check("すべて未設定は設定が無いと押せない", await page.$eval(".ind-reset", node => node.disabled));

// ---- 19c. 条件標識の編集（7-16 桁への書き戻し）--------------------------
//
// **OR では行が増える**（原典: 項目は最後の標識と同じ行）。桁を手で打たせず、
// 短い形（AND は空白 / OR はカンマ）で受けて core が書き戻す。
const conditionValue = () => page.inputValue('.dds-props input[data-key="condition"]');
const setCondition = async text => {
  await page.fill('.dds-props input[data-key="condition"]', text);
  await page.press('.dds-props input[data-key="condition"]', "Enter");
  await page.waitForTimeout(200);
};

// **FLD2（`02` で条件付けた項目）を選ぶ。** FLD1 と重なっており、下の FLD1 は
// クリックが届かない（重なりはこの様式がわざと持っている形）。並び順に頼らず
// 「フィールドのうち最後」で引く。
await page.locator(".dds-item").filter({ hasText: "XXXX" }).last().click();
await page.waitForTimeout(150);
check(
  "条件が短い形で読める",
  (await conditionValue()) === "02",
  await conditionValue()
);

const linesBeforeCondition = await sourceLines();
await setCondition("N02 03");
check(
  "**条件を書き換えるとソースの 7-16 桁が変わる**",
  (await sourceLines()).some(l => l.slice(6, 16).includes("N02 03")),
  JSON.stringify((await sourceLines()).filter(l => l.includes("N02")))
);
check("書き換えた条件が読み戻せる", (await conditionValue()) === "N02 03", await conditionValue());

await setCondition("50, 60");
const orLines = await sourceLines();
check(
  "**OR にすると行が増え、2 つ目の 7 桁目に O が入る**",
  orLines.length === linesBeforeCondition.length + 1 &&
    orLines.some(l => l.charAt(6) === "O" && l.slice(6, 16).includes("60")),
  JSON.stringify(orLines.filter(l => l.charAt(6) === "O"))
);
check("OR も読み戻せる", (await conditionValue()) === "50, 60", await conditionValue());

await setCondition("");
check(
  "空にすると条件が消え、行数も戻る",
  (await sourceLines()).length === linesBeforeCondition.length &&
    (await conditionValue()) === "",
  `${(await sourceLines()).length} 行 / ${JSON.stringify(await conditionValue())}`
);

// 読めない形は送らない（ソースが変わらない）。
const beforeBad = await sourceLines();
await setCondition("abc");
check(
  "**読めない形はソースを変えない**",
  JSON.stringify(await sourceLines()) === JSON.stringify(beforeBad),
  await page.$eval(".status", node => node.textContent)
);
check(
  "断った理由が出る",
  (await page.$eval(".status", node => node.textContent)).includes("標識"),
  await page.$eval(".status", node => node.textContent)
);

// 画面サイズ条件名（`*DS3` 等）も同じ欄で書ける。標識とは別の欄の使い方。
await setCondition("*DS3");
check(
  "**画面サイズ条件名も書ける（名前は 9 桁目から。実機は 8 桁目を通さない）**",
  (await sourceLines()).some(
    line => line.slice(6, 8) === "  " && line.slice(8, 16).trimEnd() === "*DS3"
  ),
  JSON.stringify((await sourceLines()).filter(l => l.includes("*DS3")))
);
check("画面サイズ条件名が読み戻せる", (await conditionValue()) === "*DS3", await conditionValue());

// 形が違えば送らない。
const beforeBadSize = await sourceLines();
await setCondition("*TOOLONGNAME");
check(
  "形の違う画面サイズ条件名はソースを変えない",
  JSON.stringify(await sourceLines()) === JSON.stringify(beforeBadSize),
  await page.$eval(".status", node => node.textContent)
);

await setCondition("");

// ---- 19d. キーワード行の条件の編集 --------------------------------------
//
// `30 DSPATR(RI)` の `30`。**宛先は項目ではなくキーワードの行**。
await page.locator(".dds-item").filter({ hasText: "XXXX" }).last().click();
await page.waitForTimeout(150);
const setKwCondition = async text => {
  await page.fill('.dds-props input[data-key="keywordCondition"]', text);
  await page.press('.dds-props input[data-key="keywordCondition"]', "Enter");
  await page.waitForTimeout(220);
};

const kwLineBefore = (await sourceLines()).findIndex(l => l.includes("DSPATR(RI)"));
await setKwCondition("N40");
check(
  "**キーワード行の条件だけを書き換える（項目の行は動かない）**",
  (await sourceLines())[kwLineBefore].slice(6, 16).includes("N40") &&
    (await sourceLines()).filter(l => l.includes("XXXX") || l.includes("FLD")).length ===
      linesBeforeCondition.filter(l => l.includes("FLD")).length,
  (await sourceLines())[kwLineBefore]
);
check("書き換えた条件が読み戻せる", (await kwCondValue()) === "N40", await kwCondValue());

await setKwCondition("");
check(
  "空にするとキーワード行の条件が消える",
  (await sourceLines())[kwLineBefore].slice(6, 16).trim() === "" &&
    (await sourceLines())[kwLineBefore].includes("DSPATR(RI)"),
  (await sourceLines())[kwLineBefore]
);
check("条件なしとして読み戻せる", (await kwCondValue()) === "", await kwCondValue());

// ---- 19e. ファイル・レベルのキーワード ---------------------------------
//
// `DSPSIZ` / `REF` / `INDARA` / `PRINT` は**最初の様式より前**にあり、
// 論理単位にならないので一覧にもプロパティにも出てこなかった。
await page.selectOption("#sample", { label: "CUSTMNT.dspf" });
await page.waitForTimeout(250);

const fileLevelLabels = () =>
  page.$$eval(".dds-tree > li.file-level > ul > li.file-keyword .label", nodes =>
    nodes.map(n => n.textContent)
  );
check(
  "**ファイル・レベルのキーワードが一覧に出る**",
  JSON.stringify(await fileLevelLabels()) ===
    JSON.stringify(["DSPSIZ(24 80 *DS3)", "REF(CUSTMST)", "INDARA", "PRINT"]),
  JSON.stringify(await fileLevelLabels())
);

await page.click(".dds-tree > li.file-level > ul > li.file-keyword >> nth=0");
await page.waitForTimeout(180);
check(
  "選ぶとプロパティに出る",
  (await page.$eval(".dds-props-title, .dds-record-title", n => n.textContent)).includes(
    "ファイル・レベル"
  ),
  await page.$eval(".dds-record-title", n => n.textContent)
);
check(
  "チップに分かれて原典の解説が引ける",
  (await page.$$eval(".kw-chip", nodes => nodes.map(n => n.textContent))).some(t =>
    t.startsWith("DSPSIZ")
  ),
  JSON.stringify(await page.$$eval(".kw-chip", nodes => nodes.map(n => n.textContent)))
);
// **`＋` を出す。** 候補は使用レベルで絞っており、ファイル・レベルの一覧は
// 原典から生成済み（DSPF 47 件）。前 work では「一覧がまだ無い」と見立てて出していなかった。
check(
  "**候補からの追加（`＋`）が出る**",
  (await page.$$eval(".kw-chip", nodes => nodes.map(n => n.textContent))).some(t =>
    t.includes("追加")
  ),
  JSON.stringify(await page.$$eval(".kw-chip", nodes => nodes.map(n => n.textContent)))
);
await page.click(".kw-chip.add");
await page.waitForTimeout(150);
const fileOptions = await page.$$eval(".kw-add-input + datalist option, datalist option", nodes =>
  nodes.map(n => n.value)
);
check(
  "**候補はファイル・レベルのものに絞られている**（DSPSIZ が出て COLOR が出ない）",
  fileOptions.includes("DSPSIZ") && !fileOptions.includes("COLOR"),
  `${fileOptions.length} 件 / DSPSIZ=${fileOptions.includes("DSPSIZ")} COLOR=${fileOptions.includes("COLOR")}`
);

// **総称（CFnn）はそのまま送らない。** 大文字にすると `CFNN` になり実機が通さない。
await page.fill(".kw-add-input", "CFnn");
await page.press(".kw-add-input", "Enter");
await page.waitForTimeout(250);
check(
  "**総称のキーワードはソースに入らない**",
  !(await sourceLines()).some(line => line.includes("CFNN")),
  JSON.stringify((await sourceLines()).filter(l => l.includes("CF")))
);
check(
  "番号の場所より前が入力欄に残る",
  (await page.$eval(".kw-add-input", n => n.value)) === "CF",
  await page.$eval(".kw-add-input", n => n.value)
);
check(
  "**使える番号の範囲が出る**（原典の説明文から）",
  (await page.$eval(".status", n => n.textContent)).includes("CF01 - CF24"),
  await page.$eval(".status", n => n.textContent)
);

// **選んだ候補がソースに入る。** 一覧を出すだけでは届いていない。
const beforeFileAdd = await sourceLines();
const dspsizAt = beforeFileAdd.findIndex(l => l.includes("DSPSIZ"));
await page.fill(".kw-add-input", "PRINT");
await page.press(".kw-add-input", "Enter");
await page.waitForTimeout(250);
check(
  "**候補から足したキーワードがファイル・レベルの行に入る**",
  (await sourceLines())[dspsizAt].includes("PRINT"),
  (await sourceLines())[dspsizAt]
);
check(
  "足しても行数は変わらない",
  (await sourceLines()).length === beforeFileAdd.length,
  `${(await sourceLines()).length} / ${beforeFileAdd.length}`
);
await page.fill(".kw-raw", "DSPSIZ(24 80 *DS3)");
await page.press(".kw-raw", "Enter");
await page.waitForTimeout(250);

// **編集はできる。** 宛先は `ddsEdit` が生の行から引く（論理単位にならないため）。
const beforeFileLevel = await sourceLines();
const dspsizLine = beforeFileLevel.findIndex(l => l.includes("DSPSIZ"));
await page.fill(".kw-raw", "DSPSIZ(24 80 *DS3) PRINT");
await page.press(".kw-raw", "Enter");
await page.waitForTimeout(250);
check(
  "**ファイル・レベルのキーワードを編集できる**",
  (await sourceLines())[dspsizLine].includes("DSPSIZ(24 80 *DS3) PRINT"),
  (await sourceLines())[dspsizLine]
);
check(
  "行数は変わらない（他のファイル・レベル行を巻き込まない）",
  (await sourceLines()).length === beforeFileLevel.length,
  `${(await sourceLines()).length} / ${beforeFileLevel.length}`
);

await page.fill(".kw-raw", "DSPSIZ(24 80 *DS3)");
await page.press(".kw-raw", "Enter");
await page.waitForTimeout(250);
check(
  "戻すと元のソースに一致する",
  JSON.stringify(await sourceLines()) === JSON.stringify(beforeFileLevel),
  (await sourceLines())[dspsizLine]
);

// ---- 19f. 2 次画面サイズ ------------------------------------------------
//
// **位置の上書き行**（条件名 ＋ 位置だけの行）が 2 次画面サイズでの位置を与える。
// 直す前は上書き行を「次の単位への前置き」と見なして捨てており、
// 2 次画面での見え方が一切見えなかった。
await page.selectOption("#sample", { label: "two-sizes.dspf" });
await page.waitForTimeout(250);

const canvasSize = () =>
  page.$eval(".dds-canvas", node => ({
    rows: Number(node.dataset.rows),
    columns: Number(node.dataset.columns)
  }));
const itemAt = async label => {
  const found = await page.$$eval(".dds-item", nodes =>
    nodes.map(n => ({
      text: n.textContent,
      row: Number(n.dataset.row),
      column: Number(n.dataset.column)
    }))
  );
  return found.find(item => item.text.includes(label));
};

check("2 次画面サイズがあると切替が出る", !(await page.$eval("#dds-toggle-secondary", n => n.hidden)));
check(
  "1 次では 24x80 で、項目は宣言どおりの位置",
  JSON.stringify(await canvasSize()) === JSON.stringify({ rows: 24, columns: 80 }) &&
    (await itemAt("XXXX"))?.row === 23,
  JSON.stringify(await canvasSize())
);

const sourceBeforeSecondary = await sourceLines();
await page.click("#dds-toggle-secondary");
await page.waitForTimeout(220);
check(
  "**2 次に切り替えると画面が 27x132 になり、上書きの位置で描く**",
  JSON.stringify(await canvasSize()) === JSON.stringify({ rows: 27, columns: 132 }) &&
    (await itemAt("XXXX"))?.row === 26 &&
    (await itemAt("XXXX"))?.column === 40,
  JSON.stringify(await canvasSize()) + " " + JSON.stringify(await itemAt("XXXX"))
);
check(
  "上書きの無い項目は 2 次でも同じ位置",
  (await page.$$eval(".dds-item", nodes =>
    nodes.filter(n => n.textContent.includes("XXXX")).map(n => Number(n.dataset.row))
  )).includes(5)
);

// **2 次でも動かせる。** 宛先は項目自身の行ではなく**位置の上書き行**
// （無ければ作る）。項目の行を書き換えると 1 次の位置が黙って変わる。
//
// 掴む対象は `.dds-item` の**要素そのもの**（端の掴み手＝`data-role="resize"` を
// 避けて中央を掴む）。要素は選択で描き直されるので、掴む直前に取り直す。
// 掴む対象は **`data-row` で選ぶ**。項目はどれも `XXXXXXXXXX` と描かれるので、
// 文字で選ぶと別の項目を掴む（最初にそれで constant を掴んで通らなかった）。
const grabAtRow = async row => {
  for (const handle of await page.$$(".dds-item")) {
    if ((await handle.getAttribute("data-row")) === String(row)) return handle;
  }
  throw new Error(`${row} 行目の項目が無い`);
};
const dragBy = async (handle, dx, dy) => {
  // **先に見える位置へ送る。** 27 行の画面では下端の項目が横スクロールバーに
  // 隠れ、掴んだつもりでキャンバスを掴む（送信そのものが起きない）。
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(260);
};
/** 上書き行（条件名 ＋ 位置だけの行）だけを取り出す。 */
const overrideLines = async () =>
  (await sourceLines()).filter(line => line.slice(6, 16).trim().startsWith("*"));

// FLDA は既に上書き行を持つ（2 次では 26,40 に描かれる）。動かしても**増えない**。
const fldaLineBefore = (await sourceLines()).find(line => line.includes("FLDA"));
const overrideBefore = (await overrideLines())[0];
await dragBy(await grabAtRow(26), 60, -30);
check(
  "**2 次で動かすと上書き行が書き換わる（項目の行は変わらない）**",
  (await sourceLines()).find(line => line.includes("FLDA")) === fldaLineBefore &&
    (await overrideLines()).length === 1 &&
    (await overrideLines())[0] !== overrideBefore,
  JSON.stringify(await overrideLines())
);
check(
  "1 次の位置（項目の行）は変わらない",
  (await sourceLines()).find(line => line.includes("FLDA")).slice(38, 44) ===
    fldaLineBefore.slice(38, 44),
  (await sourceLines()).find(line => line.includes("FLDA"))
);

// **上書き行の無い項目を動かすと作られる。** FLDB は 1 次の位置しか持たない
// （2 次でも 5,2 に描かれる）。
const fldbLineBefore = (await sourceLines()).find(line => line.includes("FLDB"));
await dragBy(await grabAtRow(5), 40, 40);
check(
  "**上書き行が無い項目を動かすと 1 本作られる**",
  (await overrideLines()).length === 2,
  JSON.stringify(await overrideLines())
);
check(
  "作られた上書き行は条件名と位置だけを持つ",
  (await overrideLines()).every(
    line => line.slice(16, 38).trim() === "" && line.slice(44).trim() === ""
  ),
  JSON.stringify(await overrideLines())
);
check(
  "作った側の項目の行も変わらない",
  (await sourceLines()).find(line => line.includes("FLDB")) === fldbLineBefore
);

// **長さは変えられない**（上書き行は長さ欄を持てない＝実機で確認）。
const lengthBefore = (await sourceLines()).find(line => line.includes("FLDA")).slice(29, 34);
const resizeHandle = await page.$('.dds-item [data-role="resize"]');
if (resizeHandle) {
  const rbox = await resizeHandle.boundingBox();
  await page.mouse.move(rbox.x + rbox.width / 2, rbox.y + rbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rbox.x + 60, rbox.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(220);
}
check(
  "**2 次では長さを変えられない**",
  (await sourceLines()).find(line => line.includes("FLDA")).slice(29, 34) === lengthBefore,
  (await sourceLines()).find(line => line.includes("FLDA"))
);

// **Delete は「項目を消す」ではなく「上書き行を消す」。**
// 直前のドラッグで上書き行を作った FLDB を選ぶ（2 次で 9 行目に来ている）。
await (await grabAtRow(7)).click();
await page.waitForTimeout(150);
const itemCountBefore = (await sourceLines()).filter(line => line.includes("FLD")).length;
await page.keyboard.press("Delete");
await page.waitForTimeout(260);
check(
  "**2 次の Delete は上書き行だけを消す（項目は残る）**",
  (await sourceLines()).filter(line => line.includes("FLD")).length === itemCountBefore &&
    (await overrideLines()).length === 1,
  JSON.stringify(await overrideLines())
);

await page.click("#dds-toggle-secondary");
await page.waitForTimeout(220);
check(
  "戻すと 1 次に戻る",
  JSON.stringify(await canvasSize()) === JSON.stringify({ rows: 24, columns: 80 })
);

// ---- 19g. 名前変更の参照追随 --------------------------------------------
//
// 項目の名前を変えると、その項目を**指しているキーワードの引数**も一緒に変わる。
// 直す前はプロパティに「追随しません（SFLCTL 等）」と出ていたが、`SFLCTL` が
// 指すのは項目ではなく**様式**で、項目の改名では元から影響しなかった。
await page.selectOption("#sample", { label: "references.dspf" });
await page.waitForTimeout(250);

const lineWith = async token => (await sourceLines()).find(line => line.includes(token));
/** 一覧から項目を選び、名前の欄を書き換えて確定する。 */
const rename = async (label, next) => {
  const rows = await page.$$(".dds-tree li.item");
  for (const row of rows) {
    if (((await row.textContent()) ?? "").includes(label)) {
      await row.click();
      break;
    }
  }
  await page.waitForTimeout(180);
  const name = await page.$('.dds-props input[data-key="name"]');
  await name.fill(next);
  await name.press("Enter");
  await page.waitForTimeout(280);
};

check(
  "断り書きが「一緒に変わる」を伝える",
  (await page.$$eval(".dds-note", nodes => nodes.map(n => n.textContent))).some(t =>
    t.includes("一緒に変わります")
  ),
  JSON.stringify(await page.$$eval(".dds-note", nodes => nodes.map(n => n.textContent)))
);

await rename("CSRROW", "NEWROW");
check(
  "**定位置の参照（CSRLOC）が追随する**",
  (await lineWith("CSRLOC")).includes("CSRLOC(NEWROW CSRCOL)"),
  await lineWith("CSRLOC")
);
check(
  "**外部を指す REF は同じ名前でも変わらない**",
  (await lineWith("REF(")).includes("REF(CSRROW)"),
  await lineWith("REF(")
);
check(
  "何か所変わったかがステータスに出る",
  (await page.$eval(".status", n => n.textContent)).includes("参照"),
  await page.$eval(".status", n => n.textContent)
);

await rename("SFLRRN", "NEWRRN");
check(
  "**`&` の参照が追随する**",
  (await lineWith("SFLCSRRRN")).includes("SFLCSRRRN(&NEWRRN)"),
  await lineWith("SFLCSRRRN")
);

// **様式の改名。** 名前の欄は様式のプロパティにもある。
// **見出しの `.label` を押す。** `li.record` の中心は入れ子の項目行に当たることが
// あり、UI 側は「一番内側の li が自分か」で見分けるので選択が起きない。
const selectRecord = async label => {
  for (const row of await page.$$(".dds-tree li.record > .label")) {
    if (((await row.textContent()) ?? "").trim() === `R ${label}`) {
      await row.click();
      return;
    }
  }
  throw new Error(`様式 ${label} が一覧に無い`);
};
await selectRecord("MAIN");
await page.waitForTimeout(180);
check(
  "**様式にも名前の欄が出る**",
  (await page.$('.dds-props input[data-key="recordName"]')) !== null
);
const recordName = await page.$('.dds-props input[data-key="recordName"]');
await recordName.fill("NEWMAIN");
await recordName.press("Enter");
await page.waitForTimeout(280);
check(
  "**様式の名前が変わる**",
  (await lineWith("R NEWMAIN")) !== undefined,
  JSON.stringify(await sourceLines())
);
check(
  "**様式を指す参照（PASSRCD / ERASE）も一緒に変わる**",
  (await lineWith("PASSRCD")).includes("PASSRCD(NEWMAIN)") &&
    (await lineWith("ERASE")).includes("ERASE(NEWMAIN)"),
  `${await lineWith("PASSRCD")} / ${await lineWith("ERASE")}`
);
// `ERASE(MAIN)` は `OVERLAY +` の継続の先にある。物理行だけを見ると
// `ERASE(` が別の行にあり参照と分からない——結合したテキストで探す経路。
check(
  "**継続にまたがる参照も追える**（OVERLAY + の先の ERASE）",
  (await lineWith("ERASE(NEWMAIN)")) !== undefined &&
    (await sourceLines()).some(line => line.includes("OVERLAY")) &&
    !(await sourceLines()).some(line => line.includes("ERASE(MAIN)")),
  JSON.stringify((await sourceLines()).filter(l => /OVERLAY|ERASE/.test(l)))
);
check(
  "**項目を指す参照（CSRLOC）は巻き込まれない**",
  (await lineWith("CSRLOC")).includes("CSRLOC(NEWROW CSRCOL)"),
  await lineWith("CSRLOC")
);

// **既にある様式の名前には変えられない**（実機が同じ名前の様式を 2 つ通さない）。
const beforeClash = await sourceLines();
const clashInput = await page.$('.dds-props input[data-key="recordName"]');
await clashInput.fill("OTHER");
await clashInput.press("Enter");
await page.waitForTimeout(280);
check(
  "**名前が重なる改名は拒否され、ソースは変わらない**",
  JSON.stringify(await sourceLines()) === JSON.stringify(beforeClash),
  JSON.stringify(await sourceLines())
);
check(
  "拒否の理由が出る",
  (await page.$eval(".dds-reject", n => n.textContent)).includes("既にあります"),
  await page.$eval(".dds-reject", n => n.textContent)
);

const beforePlain = await sourceLines();
await rename("CUSTNO", "NEWNO");
check(
  "参照の無い項目の改名は他の行を変えない",
  (await sourceLines()).filter((line, i) => line !== beforePlain[i]).length === 1,
  JSON.stringify((await sourceLines()).filter((line, i) => line !== beforePlain[i]))
);

// ---- 20. キーワードのチップと原典ヘルプ -------------------------------
// 題材を実物（CUSTMNT.dspf）に戻す。読み込み直しなので文書は元の状態になる。
await page.selectOption("#sample", { label: "CUSTMNT.dspf" });
await page.waitForTimeout(250);

// `＋ 追加` と「未設定」はキーワードではないので数えない。
const chipTexts = () =>
  page.$$eval(".kw-chip:not(.add):not(.none)", nodes => nodes.map(n => n.textContent));
const helpText = () => page.$eval(".kw-help", node => node.textContent).catch(() => "");
const selectTreeItem = async label => {
  const line = await page.evaluate(name => {
    const node = [...document.querySelectorAll(".dds-tree li.item")].find(n =>
      n.textContent.includes(name)
    );
    return node ? Number(node.dataset.sourceLine) : null;
  }, label);
  await page.click(`.dds-tree li.item[data-source-line="${line}"]`);
  await page.waitForTimeout(150);
  return line;
};

const custnoLine = await selectTreeItem("CUSTNO");
check(
  "キーワードがチップに分かれて出る",
  JSON.stringify(await chipTexts()) === JSON.stringify(["CHECK(RZ)"]),
  JSON.stringify(await chipTexts())
);
check(
  "生テキストも残っている（桁を数える手段を消さない）",
  (await page.$eval(".kw-raw", node => node.value)) === "CHECK(RZ)"
);

await page.click(".kw-chip.keyword");
await page.waitForTimeout(150);
check(
  "**チップを押すと原典の解説が出る**",
  (await helpText()).includes("検査") && (await helpText()).includes("CHECK("),
  (await helpText()).slice(0, 80)
);
check("解説を開いてもフォーカスはそのチップに残る", await page.evaluate(() =>
  document.activeElement?.classList.contains("kw-chip")
));

await page.click(".kw-chip.keyword");
await page.waitForTimeout(150);
check("もう一度押すと閉じる", (await page.$(".kw-help")) === null);

// F1 でも開く（この PJ のプロンプターと同じ作法）。
await page.focus(".kw-chip.keyword");
await page.keyboard.press("F1");
await page.waitForTimeout(150);
check("**F1 でも解説が開く**", (await helpText()).includes("検査"));

// キーをキャンバスへ漏らさない（AC-I5）。
const beforeDelete = (await sourceLines())[custnoLine - 1];
await page.keyboard.press("Delete");
await page.waitForTimeout(200);
check(
  "**チップ上の Delete でキャンバスの項目が消えない**",
  (await sourceLines())[custnoLine - 1] === beforeDelete,
  `行=${custnoLine}`
);

// 定数のリテラルは「原典に無いキーワード」ではない。
await selectTreeItem("顧客保守");
check(
  "定数のリテラルに「原典に無い」の印が付かない",
  (await page.$$(".kw-chip.literal")).length === 1 &&
    (await page.$$(".kw-chip.unknown")).length === 0,
  JSON.stringify(await chipTexts())
);

// 様式（レコード・レベル）のキーワード。CF03 は原典の総称 CFnn に当たる。
await page.click(".dds-tree li.record .label");
await page.waitForTimeout(200);
check(
  "**様式を選ぶとレコード・レベルのキーワードが出る**",
  JSON.stringify(await chipTexts()) === JSON.stringify(["OVERLAY", "CF03(03 '終了')"]),
  JSON.stringify(await chipTexts())
);
await page.click('.kw-chip[data-keyword="CF03"]');
await page.waitForTimeout(150);
check(
  "**CF03 が原典の総称 CFnn の解説に当たる**",
  (await helpText()).includes("CFnn") && (await helpText()).includes("コマンド機能"),
  (await helpText()).slice(0, 60)
);

// 様式を選んでも項目のクリックは項目を選ぶ（入れ子の見分け）。
await selectTreeItem("CUSTNM");
check(
  "様式の中の項目をクリックしたら項目が選ばれる",
  // 名前は input の値なので textContent には出ない。値を直接読む。
  (await page.$eval('.dds-properties input[data-key="name"]', node => node.value)) === "CUSTNM"
);

// ---- 21. キーワードの編集（追加・削除・引数の変更と折り返し） -----------
const msgtxtLine = await selectTreeItem("MSGTXT");
const rawValue = () => page.$eval(".kw-raw", node => node.value);
const sourceAt = async line => (await sourceLines())[line - 1];

check("生テキストが編集できる（読み取り専用ではない）", await page.$eval(".kw-raw", n => !n.readOnly));

// 36 桁に収まらない並びを入れて、切れ目で折られることを見る。
await page.fill(".kw-raw", "COLOR(RED) DSPATR(RI HI ND) CHECK(RZ) DSPATR(UL)");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
check(
  "**読み直しても同じ並びに戻る**（折っても値が変わらない）",
  (await rawValue()) === "COLOR(RED) DSPATR(RI HI ND) CHECK(RZ) DSPATR(UL)",
  await rawValue()
);
const folded = [await sourceAt(msgtxtLine), await sourceAt(msgtxtLine + 1)];
check(
  "**桁が溢れたら次の行へ折られる**（どの行も 80 桁以内）",
  folded.every(line => line.length <= 80) && folded[1].slice(0, 44).trim() === "A",
  JSON.stringify(folded)
);
check(
  "切れ目で折るので継続記号を使わない",
  !folded[0].trimEnd().endsWith("-"),
  folded[0]
);

// チップの ✕ で 1 つ外す。
const chipsBefore = (await chipTexts()).length;
await page.click(".kw-x");
await page.waitForTimeout(400);
check(
  "**チップの ✕ でキーワードが 1 つ消える**",
  (await chipTexts()).length === chipsBefore - 1,
  `${chipsBefore} → ${(await chipTexts()).length}`
);
check("消したぶんは生テキストからも消える", !(await rawValue()).includes("COLOR(RED)"), await rawValue());

// ＋ で足す（原典の一覧が候補に出る）。
await page.click(".kw-chip.add");
await page.waitForTimeout(150);
check(
  "＋ で候補つきの入力欄が開く（原典の一覧から）",
  (await page.$eval(".kw-add-input", n => !n.hidden)) &&
    (await page.$$eval(`datalist#dds-kw-field option`, ns => ns.length)) > 50
);
await page.fill(".kw-add-input", "DSPATR");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
check("**足したキーワードがソースに入る**", (await rawValue()).includes("DSPATR()"), await rawValue());

// **様式のキーワードも編集できる**（OVERLAY / CFnn は様式にしか書けない）。
await page.click(".dds-tree li.record .label");
await page.waitForTimeout(200);
const recordBefore = await rawValue();
await page.fill(".kw-raw", `${recordBefore} PUTOVR`);
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
check(
  "**様式のキーワードを足せる**",
  (await rawValue()).includes("PUTOVR") && (await sourceAt(6)).includes("R HEADER"),
  await sourceAt(6)
);

// 定数からリテラルを消す編集は拒否される。
// **行番号は直前の編集でずれている**（様式の 2 行が 1 行にまとまった）ので、選択から採る。
const literalLine = await selectTreeItem("顧客保守");
await page.fill(".kw-raw", "DSPATR(HI)");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
check(
  "**定数からリテラルを消す編集は拒否される**",
  (await page.$eval(".dds-reject", node => node.textContent)).includes("リテラル"),
  await page.$eval(".dds-reject", node => node.textContent)
);
check(
  "拒否されたらソースは変わらない",
  (await sourceAt(literalLine)).includes("顧客保守"),
  await sourceAt(literalLine)
);

// ---- 22. 5250 の配色 ----------------------------------------------------
// **題材を読み直す。** 直前の節でキーワードを編集しているので、素の状態から見る。
await page.selectOption("#sample", { label: "hidden-items.dspf" });
await page.waitForTimeout(200);
await page.selectOption("#sample", { label: "CUSTMNT.dspf" });
await page.waitForTimeout(300);

const colorClasses = () => page.$$eval(".dds-item", ns => ns.map(n => n.className));
const msgLine = await selectTreeItem("MSGTXT");

check(
  "配色は既定で入っている（実機の見え方を出すのが目的）",
  await page.$eval("#dds-toggle-colors", n => n.classList.contains("armed"))
);
check(
  "COLOR を書かない項目は緑（原典: 緑はデフォルトの色）",
  (await page.$$eval(".dds-item.constant", ns => ns.map(n => n.className))).every(c =>
    c.includes("c-green")
  ),
  JSON.stringify(await colorClasses())
);
check(
  "**COLOR(RED) を書いた項目は赤**（実サンプルの MSGTXT）",
  await page.$eval(`.dds-item[data-source-line="${msgLine}"]`, n => n.classList.contains("c-red")),
  JSON.stringify(await colorClasses())
);

const boxBefore = await page.$eval(`.dds-item[data-source-line="${msgLine}"]`, n => {
  const r = n.getBoundingClientRect();
  return { left: Math.round(r.left), width: Math.round(r.width) };
});

await page.fill(".kw-raw", "COLOR(YLW) DSPATR(RI)");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
check(
  "**COLOR(YLW) DSPATR(RI) が黄の反転表示になる**",
  await page.$eval(`.dds-item[data-source-line="${msgLine}"]`, n =>
    n.classList.contains("c-yellow") && n.classList.contains("reverse")
  )
);
const boxAfter = await page.$eval(`.dds-item[data-source-line="${msgLine}"]`, n => {
  const r = n.getBoundingClientRect();
  return { left: Math.round(r.left), width: Math.round(r.width) };
});
check(
  "**配色を変えても桁と位置は変わらない**",
  boxBefore.left === boxAfter.left && boxBefore.width === boxAfter.width,
  `${JSON.stringify(boxBefore)} → ${JSON.stringify(boxAfter)}`
);

// 書いたのに出ない組み合わせ。
await page.fill(".kw-raw", "DSPATR(UL HI RI)");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
check(
  "**UL＋HI＋RI が非表示として描かれる**（コンパイルも通り警告も出ない組み合わせ）",
  await page.$eval(`.dds-item[data-source-line="${msgLine}"]`, n =>
    n.classList.contains("non-display")
  )
);
check(
  "非表示でも枠は残る（選べなくならない）",
  await page.$eval(`.dds-item[data-source-line="${msgLine}"]`, n =>
    n.getBoundingClientRect().width > 0
  )
);

// 切ると今までの見え方に戻る。
await page.click("#dds-toggle-colors");
await page.waitForTimeout(200);
check(
  "配色を切ると色の付いた項目が無くなる",
  (await colorClasses()).every(c => !c.includes("colored")),
  JSON.stringify(await colorClasses())
);
await page.click("#dds-toggle-colors");
await page.waitForTimeout(200);

// ---- 23. 帳票（PRTF）--------------------------------------------------
await page.selectOption("#sample", { label: "CUSTRPT.prtf" });
await page.waitForTimeout(400);

check(
  "**帳票を開ける**（紙面は CRTPRTF の既定 66 × 132）",
  (await page.$eval(".dds-metrics", n => n.textContent)).includes("66×132"),
  await page.$eval(".dds-metrics", n => n.textContent)
);
check(
  "種別が分かる",
  (await page.$eval(".record-name", n => n.textContent)).startsWith("帳票"),
  await page.$eval(".record-name", n => n.textContent)
);
check(
  "**行送り（SKIPB / SPACEA）で決まった行に描かれる**",
  JSON.stringify(await page.$$eval(".dds-item", ns => ns.map(n => `${n.dataset.row},${n.dataset.column}`))) ===
    JSON.stringify(["1,30", "3,5", "3,15", "3,50"]),
  JSON.stringify(await page.$$eval(".dds-item", ns => ns.map(n => `${n.dataset.row},${n.dataset.column}`)))
);
check(
  "**帳票に無いものを出さない**（属性文字）",
  (await page.$$(".dds-attr")).length === 0 &&
    (await page.$eval("#dds-toggle-attributes", n => n.hidden))
);
// **見え方は帳票にもある**——語彙は違う（太字・下線・カラー）が、
// 「見え方を出すかどうか」という切替の意味は同じ。
check(
  "見え方の切替は帳票でも出る",
  !(await page.$eval("#dds-toggle-colors", n => n.hidden))
);
check(
  "**帳票の項目は画面の 5250 配色では描かれない**（DSPATR は帳票に無い）",
  (await page.$$(".dds-item.colored")).length === 0 &&
    (await page.$$(".dds-item.printed")).length > 0,
  JSON.stringify(await page.$$eval(".dds-item", ns => ns.map(n => n.className)))
);
// ---- 帳票の強調 --------------------------------------------------------
//
// 画面の 5250 配色とは**語彙が違う**——太字・下線・カラーだけで、
// 反転表示も明滅も非表示も無い（帳票に `DSPATR` は無く、実機も通さない）。
await page.selectOption("#sample", { label: "report-emphasis.prtf" });
await page.waitForTimeout(250);

const printClasses = async label =>
  (await page.$$eval(".dds-item", ns =>
    ns.map(n => ({ text: n.textContent, cls: n.className }))
  )).find(item => item.text.includes(label))?.cls ?? "";

check(
  "**様式の HIGHLIGHT が中の項目に太字で効く**（原典: 全フィールドに適用）",
  (await printClasses("MONTHLY REPORT")).includes("bold") &&
    (await printClasses("PAGE")).includes("bold"),
  await printClasses("MONTHLY REPORT")
);
check(
  "別の様式の項目は太字にならない",
  !(await printClasses("XXXXXXXXXX")).includes("bold"),
  await printClasses("XXXXXXXXXX")
);
check(
  "**UNDERLINE が下線で出る**",
  (await page.$$(".dds-item.printed.underline")).length === 1,
  JSON.stringify(await page.$$eval(".dds-item", ns => ns.map(n => n.className)))
);
check(
  "**COLOR(RED) が赤で出る**（帳票のカラー名）",
  (await page.$$(".dds-item.p-red")).length === 1,
  JSON.stringify(await page.$$eval(".dds-item", ns => ns.map(n => n.className)))
);
// 原典が「出力装置によって異なります」と書く形。**色を決めない。**
check(
  "**装置依存のカラー（*RGB）は色を決めず、指定があることだけ示す**",
  (await page.$$(".dds-item.device-color")).length === 1 &&
    (await page.$$(".dds-item.device-color.p-blk")).length === 1,
  JSON.stringify(await page.$$eval(".dds-item", ns => ns.map(n => n.className)))
);
check(
  "見え方を切ると強調が消える",
  await (async () => {
    await page.click("#dds-toggle-colors");
    await page.waitForTimeout(200);
    const none = (await page.$$(".dds-item.printed")).length === 0;
    await page.click("#dds-toggle-colors");
    await page.waitForTimeout(200);
    return none;
  })()
);

// ---- 複数ページの帳票 --------------------------------------------------
//
// 原典（`LPI`）: 「ある行番号へのスキップを指定した場合に、それが**現在位置より
// 前の位置**であれば…**改ページが生じます**」。
await page.selectOption("#sample", { label: "multi-page.prtf" });
await page.waitForTimeout(250);

const pageLabel = async () =>
  (await page.$(".density .page-number")) === null
    ? ""
    : await page.$eval(".density .page-number", n => n.textContent);
const itemTexts = async () =>
  await page.$$eval(".dds-item", ns => ns.map(n => n.textContent));

check(
  "**ページ送りが出る**（2 ページある）",
  (await pageLabel()) === "1 / 2",
  await pageLabel()
);
check(
  "1 ページ目には 1 ページ目の項目だけが出る",
  (await itemTexts()).some(t => t.includes("PAGE ONE")) &&
    !(await itemTexts()).some(t => t.includes("PAGE TWO")),
  JSON.stringify(await itemTexts())
);
check("戻るは最初のページで押せない", await page.$eval('[data-key="page:prev"]', n => n.disabled));

await page.click('[data-key="page:next"]');
await page.waitForTimeout(220);
check(
  "**次のページに送れる**",
  (await pageLabel()) === "2 / 2" &&
    (await itemTexts()).some(t => t.includes("PAGE TWO")) &&
    !(await itemTexts()).some(t => t.includes("PAGE ONE")),
  `${await pageLabel()} ${JSON.stringify(await itemTexts())}`
);
check("進むは最後のページで押せない", await page.$eval('[data-key="page:next"]', n => n.disabled));

await page.click('[data-key="page:prev"]');
await page.waitForTimeout(220);
check("戻れる", (await pageLabel()) === "1 / 2", await pageLabel());

await page.selectOption("#sample", { label: "CUSTRPT.prtf" });
await page.waitForTimeout(250);

check(
  "**1 ページの帳票にはページ送りを出さない**",
  (await page.$(".density .page-number")) === null
);
check(
  "オーバーフロー行が引かれる（CRTPRTF の OVRFLW）",
  (await page.$$(".dds-overflow")).length === 1
);
check(
  "一覧が「位置なし」にならない（行送りで位置は決まっている）",
  !(await page.$eval(".dds-outline", n => n.textContent)).includes("位置なし"),
  await page.$eval(".dds-outline", n => n.textContent)
);

// 桁だけのドラッグ（縦には動かない）。
const prtfCell = await cellAt();
const prtfLine = await page.evaluate(() =>
  parseFloat(getComputedStyle(document.querySelector(".dds-frame")).getPropertyValue("--cell-h"))
);
const prtfTarget = await page.$eval('.dds-item[data-row="3"][data-column="5"]', node => {
  const r = node.getBoundingClientRect();
  return { sourceLine: Number(node.dataset.sourceLine), x: r.left + 3, y: r.top + r.height / 2 };
});
await page.mouse.move(prtfTarget.x, prtfTarget.y);
await page.mouse.down();
// **右 4 桁・下 5 行**に引く。下方向は効かないはず。
await page.mouse.move(prtfTarget.x + prtfCell * 4, prtfTarget.y + prtfLine * 5, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(400);

const prtfMoved = (await sourceLines())[prtfTarget.sourceLine - 1];
check(
  "**桁だけ動く**（右へ 4 桁）",
  prtfMoved.slice(41, 44) === "  9",
  JSON.stringify(prtfMoved)
);
check(
  "**行欄には書き込まない**（書き込むと行送りが無効になる）",
  prtfMoved.slice(38, 41).trim() === "",
  JSON.stringify(prtfMoved)
);
check(
  "縦には動いていない",
  (await page.$$eval(".dds-item", ns => ns.map(n => n.dataset.row))).every(r => r === "1" || r === "3"),
  JSON.stringify(await page.$$eval(".dds-item", ns => ns.map(n => n.dataset.row)))
);

// ---- 24. 帳票のプレビュー（CPI / LPI）----------------------------------
const frameVar = name =>
  page.evaluate(
    key => parseFloat(getComputedStyle(document.querySelector(".dds-frame")).getPropertyValue(key)),
    name
  );
const paperText = () => page.$eval(".density .paper", node => node.textContent);

// **倍率を 100% に戻してから見る。** 前の節で 150% にしてあり、
// 紙の比率と倍率は掛け合わさる（それ自体は正しい。下で確かめる）。
await page.click('.zoom button[data-zoom="1"]');
await page.waitForTimeout(200);

const gridCell = { w: await frameVar("--cell-w"), h: await frameVar("--cell-h") };
check("プレビューは既定で切（升目のまま）", !(await page.$eval("#dds-toggle-preview", n => n.classList.contains("armed"))));

await page.click("#dds-toggle-preview");
await page.waitForTimeout(300);
const paperCell = { w: await frameVar("--cell-w"), h: await frameVar("--cell-h") };
check(
  "**紙の比率になる**（1 桁 = 1/CPI インチ・1 行 = 1/LPI インチ。96px/インチ）",
  Math.abs(paperCell.w - 96 / 10) < 0.01 && Math.abs(paperCell.h - 96 / 6) < 0.01,
  JSON.stringify(paperCell)
);
check(
  "**用紙の大きさがインチで出る**（原典: 66 行 / 6 LPI = 11.0 インチ）",
  (await paperText()).includes("13.2") && (await paperText()).includes("11.0"),
  await paperText()
);

await page.selectOption('select[data-key="density:cpi"]', "15");
await page.waitForTimeout(300);
check(
  "**CPI を変えると比率が変わる**",
  Math.abs((await frameVar("--cell-w")) - 96 / 15) < 0.01 && (await paperText()).includes("8.8"),
  `${await frameVar("--cell-w")} / ${await paperText()}`
);
await page.selectOption('select[data-key="density:lpi"]', "8");
await page.waitForTimeout(300);
check(
  "LPI を変えると高さが変わる",
  Math.abs((await frameVar("--cell-h")) - 96 / 8) < 0.01,
  String(await frameVar("--cell-h"))
);

// **プレビュー中でも掴んで動かせる**（桁が指したとおりに入る）。
const previewCell = await frameVar("--cell-w");
const previewTarget = await page.$eval('.dds-item[data-row="3"]', node => {
  const r = node.getBoundingClientRect();
  return {
    sourceLine: Number(node.dataset.sourceLine),
    column: Number(node.dataset.column),
    x: r.left + 2,
    y: r.top + r.height / 2
  };
});
await page.mouse.move(previewTarget.x, previewTarget.y);
await page.mouse.down();
await page.mouse.move(previewTarget.x + previewCell * 3, previewTarget.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(400);
check(
  "**プレビュー中でも掴んだ項目が指した桁に入る**",
  (await sourceLines())[previewTarget.sourceLine - 1].slice(41, 44) ===
    String(previewTarget.column + 3).padStart(3),
  JSON.stringify((await sourceLines())[previewTarget.sourceLine - 1])
);

// 倍率と掛け合わさること（紙の比率 × 倍率）。
await page.click('.zoom button[data-zoom="1.5"]');
await page.waitForTimeout(200);
check(
  "**紙の比率と倍率は掛け合わさる**",
  Math.abs((await frameVar("--cell-w")) - (96 / 15) * 1.5) < 0.01,
  String(await frameVar("--cell-w"))
);
await page.click('.zoom button[data-zoom="1"]');
await page.waitForTimeout(200);

await page.click("#dds-toggle-preview");
await page.waitForTimeout(300);
check(
  "切ると升目に戻る",
  Math.abs((await frameVar("--cell-w")) - gridCell.w) < 0.01,
  `${await frameVar("--cell-w")} / ${gridCell.w}`
);
check("升目に戻ると CPI / LPI は出ない", await page.$eval(".density", n => n.hidden));

// 画面ファイルではプレビューを出さない。
await page.selectOption("#sample", { label: "CUSTMNT.dspf" });
await page.waitForTimeout(300);
check("**画面ファイルではプレビューの切替を出さない**（CPI / LPI は帳票のもの）",
  await page.$eval("#dds-toggle-preview", n => n.hidden));

check("実行中に JS エラーが出ていない", errors.length === 0, errors.slice(0, 2).join(" | "));

await page.screenshot({ path: join(HERE, "out", "e2e.png") });
await browser.close();

const failed = results.filter(ok => !ok).length;
console.log(`\n=== ${results.length - failed}/${results.length} PASS ===`);
process.exit(failed === 0 ? 0 : 1);
