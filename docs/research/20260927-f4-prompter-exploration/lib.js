const WS = "/workspaces/ibmi-dogubako/docs/research/20260927-f4-prompter-exploration/ws";
const fs = await import("node:fs");
if (await win.locator(".context-view .hover-contents").count()) { await win.mouse.click(150, 800); await h.sleep(200); }
const S = ms => h.sleep(ms);
async function open(name) {
  const p = WS + "/" + name; if (!fs.existsSync(p)) fs.writeFileSync(p, "");
  await win.keyboard.press("Control+P"); await S(400); await win.keyboard.type(name); await S(700); await win.keyboard.press("Enter"); await S(900);
}
async function gotoLine(n, col = 1) { await win.keyboard.press("Control+G"); await S(300); await win.keyboard.type(`${n}:${col}`); await win.keyboard.press("Enter"); await S(300); }
async function save() { await win.keyboard.press("Control+S"); await S(400); }
function disk(name) { return fs.readFileSync(WS + "/" + name, "utf8"); }
function ruled(text) { return text.split("\n").map((l, i) => String(i + 1).padStart(3) + "|" + l); }
/** 行末に新しい行を足して text を打つ */
async function newLine(text) { await win.keyboard.press("End"); await win.keyboard.press("Enter"); await win.keyboard.press("Home"); await win.keyboard.press("Shift+Home"); if (text) await win.keyboard.type(text); await S(150); }
async function f4() { await win.keyboard.press("F4"); for (let i = 0; i < 20; i++) { await S(300); const f = await web(); if (f) { await S(300); return f; } } return null; }
async function notices() { return win.locator(".notification-toast").allInnerTexts().catch(() => []); }
async function fields(f) { return f.$$eval(".field[data-field-name]", ns => ns.filter(n => !n.classList.contains("hidden") && n.offsetParent !== null).map(n => { const c = n.querySelector("input[name],select[name],textarea[name]"); return { name: n.dataset.fieldName, label: n.querySelector(".field-label")?.textContent, value: c?.value, tag: c?.tagName, opts: c?.tagName === "SELECT" ? [...c.options].map(o => o.value).join("|") : undefined, err: n.querySelector(".error")?.textContent || undefined }; })); }
async function setv(f, name, v) { const c = f.locator(`[name="${name}"]`).first(); const tag = await c.evaluate(n => n.tagName); if (tag === "SELECT") await c.selectOption(v); else await c.fill(v); await S(80); }
async function fill(f, vals) { for (const [k, v] of Object.entries(vals)) await setv(f, k, v); }
async function ok(f) { await f.click(".buttons button[type=submit]"); await S(900); const still = await web(); if (still) { return { stillOpen: true, errs: await still.$$eval(".error", ns => ns.map(n => n.textContent).filter(Boolean)) }; } return { stillOpen: false }; }
async function cancel(f) { await f.click(".buttons .cancel"); await S(600); }
async function replaceLine(n, text) { await gotoLine(n); await win.keyboard.press("Home"); await win.keyboard.press("Home"); await win.keyboard.press("Shift+End"); await win.keyboard.type(text); await S(100); }
/** 現在行の下に "     X" を足して F4、vals を入れて OK。戻り値 {r, line} */
async function viaPrompt(spec, vals, file) { await newLine("     " + spec); const f = await f4(); if (!f) return { err: "no prompter", n: await notices() }; await fill(f, vals); const r = await ok(f); if (r.stillOpen) { await h.shot("blocked-" + Date.now()); await cancel(await web()); } await save(); const lines = disk(file).split("\n"); return { r: r.stillOpen ? r : "ok", written: lines.length }; }
function lineAt(file, n) { return disk(file).split("\n")[n - 1]; }
function put(line, col, text) { const a = line.padEnd(col - 1 + text.length, " ").split(""); for (let i = 0; i < text.length; i++) a[col - 1 + i] = text[i]; return a.join("").replace(/\s+$/, ""); }
/** 手入力: n 行目の col 桁以降を text で上書き（エディタで打ち直す） */
async function handPut(file, n, col, text) { await replaceLine(n, put(lineAt(file, n), col, text)); await save(); }
const log = [];
async function cnew(F, op, cond, extra = {}) { await newLine(put("     C", 26, op)); await win.keyboard.press("End"); const f = await f4(); if (!f) { log.push({ op, err: "noprompter", n: await notices() }); return; } const title = await f.$eval(".prompter-title", n => n.textContent); const vals = { ...extra }; if (cond !== null) vals.COND = cond; await fill(f, vals); const r = await ok(f); if (r.stillOpen) { await h.shot(`blocked-${op}`); await cancel(await web()); } await save(); log.push({ op, title, r: r.stillOpen ? r.errs : "ok" }); }
async function cold(F, vals) { await newLine("     C"); const f = await f4(); const title = await f.$eval(".prompter-title", n => n.textContent); await fill(f, vals); const r = await ok(f); if (r.stillOpen) { await h.shot(`blocked-${vals.OPCODE}`); await cancel(await web()); } await save(); log.push({ op: vals.OPCODE, title, r: r.stillOpen ? r.errs : "ok" }); }
async function pline(F, vals) { await newLine("     P"); const f = await f4(); const title = await f.$eval(".prompter-title", n => n.textContent); const fl = await fields(f); await fill(f, vals); const r = await ok(f); if (r.stillOpen) { await h.shot(`blocked-P-${vals.BEGINEND}`); await cancel(await web()); } await save(); log.push({ op: "P" + vals.BEGINEND, title, fl: fl.map(x => x.name + ":" + (x.opts ?? "")).join(","), r: r.stillOpen ? r.errs : "ok" }); }
async function clcmd(F, cmd, vals, opts = {}) { await newLine(opts.raw ?? ("             " + cmd)); await win.keyboard.press("End"); const f = await f4(); if (!f) { log.push({ cmd, err: "no prompter", n: await notices() }); return null; } const title = await f.$eval(".prompter-title", n => n.textContent); if (opts.inspect) return f; await fill(f, vals); const r = await ok(f); if (r.stillOpen) { await h.shot("blocked-" + cmd); await cancel(await web()); } await save(); log.push({ cmd, title, r: r.stillOpen ? r.errs : "ok" }); return null; }
