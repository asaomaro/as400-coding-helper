let f = null;
for (const fr of win.frames()) {
  try { const app = await fr.$(".dds-app"); const b = app && await app.boundingBox(); if (b && b.width > 0) f = fr; } catch {}
}
h.source = async () => f ? f.evaluate(() => document.querySelector(".dds-source")?.innerText ?? "") : null;
if (await win.locator(".context-view .hover-contents").count()) { await win.mouse.click(200, 700); await h.sleep(300); }
await win.mouse.move(900, 700); await h.sleep(150);
const CW = 7.83, CH = 15;
const src = () => h.source();
async function selectRecord(name) {
  const li = f.locator(".dds-outline li.record").filter({ hasText: new RegExp(`^R ${name}\\b`) }).first();
  await li.click({ position: { x: 12, y: 6 } });
  await h.sleep(400);
}
async function quick() { return (await win.locator(".quick-input-widget").isVisible()) ? await win.locator(".quick-input-widget").innerText() : null; }
/** kind: "field" | "constant"。answers は順に出る入力欄への回答（null で Esc）。返り値は各段の入力欄の文言 */
async function place(kind, row, col, answers) {
  await f.click(kind === "field" ? "#dds-add-field" : "#dds-add-constant"); await h.sleep(400);
  const box = await reveal(row, col);
  await win.mouse.click(box.x + CW * (col - 1) + 3, box.y + CH * (row - 1) + 7);
  for (let i = 0; i < 10 && !(await quick()); i++) await h.sleep(200);
  const prompts = [];
  for (const a of answers) {
    prompts.push(await quick());
    if (a === null) { await win.keyboard.press("Escape"); break; }
    await win.keyboard.type(a); await win.keyboard.press("Enter"); await h.sleep(700);
  }
  prompts.push(await quick());
  return prompts;
}
/** 対象の桁・行が .dds-main の見える範囲に入るよう横・縦に送り、送ったあとのキャンバスの位置を返す */
async function reveal(row, col) {
  await f.evaluate(([row, col, cw, ch]) => {
    const main = document.querySelector(".dds-main");
    const x = cw * (col - 1), y = ch * (row - 1);
    if (x < main.scrollLeft + 40 || x > main.scrollLeft + main.clientWidth - 80) main.scrollLeft = Math.max(0, x - main.clientWidth / 2);
    if (y < main.scrollTop + 20 || y > main.scrollTop + main.clientHeight - 40) main.scrollTop = Math.max(0, y - main.clientHeight / 2);
  }, [row, col, CW, CH]);
  await h.sleep(250);
  return (await f.$(".dds-canvas")).boundingBox();
}
async function selectItem(text) {
  await f.click(`.dds-outline li.item:has-text("${text}")`); await h.sleep(400);
}
async function setRaw(text) {
  await f.fill(".dds-properties .kw-raw", text); await f.press(".dds-properties .kw-raw", "Enter"); await h.sleep(1000);
}
async function props() { return f.evaluate(() => document.querySelector(".dds-properties").innerText); }
async function status() { return f.evaluate(() => document.querySelector(".status")?.innerText ?? ""); }
async function diag() {
  await f.click("#dds-tab-diagnostics"); await h.sleep(500);
  const t = await f.evaluate(() => document.querySelector(".dds-diagnostics").innerText);
  await f.click("#dds-tab-source"); return t;
}
async function clickCell(row, col) {
  const box = await reveal(row, col);
  await win.mouse.click(box.x + CW * (col - 1) + 3, box.y + CH * (row - 1) + 7); await h.sleep(400);
}
async function deleteAt(row, col) { await clickCell(row, col); await win.keyboard.press("Delete"); await h.sleep(900); }
async function setProp(key, val) { await f.fill(`.dds-properties input[data-key=${key}]`, val); await f.press(`.dds-properties input[data-key=${key}]`, "Enter"); await h.sleep(900); }
async function setUsage(u) { await f.selectOption(".dds-properties select[data-key=usage]", u); await h.sleep(900); }
async function useEditor(prefix) {
  for (const fr of win.frames()) {
    try { if ((await fr.$(".dds-app")) && (await fr.evaluate(() => document.querySelector(".dds-toolbar").innerText)).startsWith(prefix)) f = fr; } catch {}
  }
}
