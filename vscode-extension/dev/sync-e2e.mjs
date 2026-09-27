/**
 * 一括の送受信の画面を、単独起動ハーネス（`dev/sync-standalone.ts`）で**実際に操作して**確かめる e2e。
 *
 * 見るのは「押して動くか」: 向きの切り替え・チェックボックス（全選択を含む）・差分・転送・上書きの確認。
 * ハーネスは製品と同じコア（`bulkSync.ts`）で突き合わせるので、UI とコアの繋ぎ目もここで落ちる。
 *
 *   npm install --no-save playwright-core
 *   npm run compile:webview
 *   node dev/sync-e2e.mjs
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PAGE = join(HERE, "out", "sync.html");

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
    for (const candidate of [join(cache, entry, "chrome-linux64", "chrome"), join(cache, entry, "chrome-linux", "chrome")]) {
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
  console.error("dev/out/sync.html がありません。先に `npm run compile:webview` を実行してください。");
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
const dialogs = [];
let dialogAnswer = false;
page.on("dialog", async dialog => {
  dialogs.push(dialog.message());
  if (dialogAnswer) await dialog.accept(); else await dialog.dismiss();
});

await page.goto(pathToFileURL(PAGE).href, { waitUntil: "load" });
await page.waitForSelector("tr[data-member]");

const settle = () => page.waitForTimeout(80);
const key = k => `[data-key="${k}"]`;
const members = () => page.$$eval("tr[data-member]", ns => ns.map(n => n.dataset.member));
const cellText = (member, index) => page.$eval(`tr[data-member="${member}"]`, (n, i) => n.children[i].textContent, index);
const state = member => cellText(member, 4);
const enabled = selector => page.$eval(selector, n => !n.disabled);
const posted = () => page.evaluate(() => window.__posted.filter(m => m.type !== "ready"));
const log = () => page.$eval("#log", n => n.textContent);

// ---- 1. 開いた一覧（ダウンロード向き） ---------------------------------------

check("見出しにソース・ファイルとフォルダが出る",
  (await page.$eval(".sync-title", n => n.textContent)) === "IBM i MYLIB/QRPGSRC ⇔ src/MYLIB/QRPGSRC");
check("IBM i とローカルの両方のメンバーが名前順に並ぶ",
  (await members()).join(",") === "1BAD.rpgle,CUST10,LOCAL1,ORDR01,ORDR02,PRTORD", (await members()).join(","));
check("見出しの列は 転送元（IBM i）/ 転送先（ローカル）",
  (await page.$$eval("thead th", ns => ns.map(n => n.textContent))).slice(2, 4).join("|") === "転送元（IBM i）|転送先（ローカル）");
check("状態: 同じ日時 / 転送元が新しい / 転送先が新しい / 転送先に無し",
  [await state("CUST10"), await state("ORDR01"), await state("PRTORD"), await state("ORDR02")].join("|")
    === "同じ日時|転送元が新しい|転送先が新しい|転送先に無し（新規）");
check("新しい方の列に印が付く",
  await page.$eval('tr[data-member="ORDR01"] td:nth-child(3)', n => n.classList.contains("newer"))
    && await page.$eval('tr[data-member="PRTORD"] td:nth-child(4)', n => n.classList.contains("newer")));
check("転送元に無いもの・名前が読めないものは選べず、理由が出る",
  !(await enabled(key("select:LOCAL1"))) && (await state("LOCAL1")) === "転送元にありません。"
    && !(await enabled(key("select:1BAD.rpgle"))) && (await state("1BAD.rpgle")).includes("メンバー名として読めません"));
check("差分ボタンは両側にあるものだけ",
  (await page.$$eval('[data-key^="diff:"]', ns => ns.map(n => n.dataset.key))).join(",") === "diff:CUST10,diff:ORDR01,diff:PRTORD");
check("何も選んでいなければ転送は押せない", !(await enabled(key("transfer"))));

// ---- 2. 選ぶ -----------------------------------------------------------------

await page.click(key("select:ORDR01"));
await settle();
check("選ぶと転送ボタンに件数が出る", (await page.$eval(key("transfer"), n => n.textContent)) === "転送（1 件）");
check("一部だけ選ぶと全選択は中間の表示", await page.$eval(key("select-all"), n => n.indeterminate));
await page.click(key("select-all"));
await settle();
check("全選択は選べるものだけを選ぶ（4 件）", (await page.$eval(key("transfer"), n => n.textContent)) === "転送（4 件）");
await page.click(key("select-all"));
await settle();
check("全選択をもう一度押すと全部外れる", (await page.$eval(key("transfer"), n => n.textContent)) === "転送");

// ---- 3. 差分 -------------------------------------------------------------------

await page.click(key("diff:ORDR01"));
await settle();
check("差分ボタンはそのメンバーの差分をホストに頼む",
  JSON.stringify((await posted()).at(-1)) === JSON.stringify({ type: "diff", name: "ORDR01" }) && (await log()).includes("差分: ORDR01"));

// ---- 4. 転送と上書きの確認 -----------------------------------------------------

await page.click(key("select:PRTORD"));
await page.click(key("select:ORDR02"));
await settle();
dialogAnswer = false;
await page.click(key("transfer"));
await settle();
check("転送先の方が新しいもの（PRTORD）を含むと確認が出る", dialogs.length === 1 && dialogs[0].includes("PRTORD") && !dialogs[0].includes("ORDR02"), dialogs.join(" / "));
check("確認を取り消すと何も転送しない", !(await log()).includes("転送:"));
check("取り消しても選択は残る", (await page.$eval(key("transfer"), n => n.textContent)) === "転送（2 件）");
check("画面が送ったのは選んだ名前だけ（一覧の順）",
  JSON.stringify((await posted()).at(-1)) === JSON.stringify({ type: "transfer", names: ["ORDR02", "PRTORD"] }));

dialogAnswer = true;
await page.click(key("transfer"));
await page.waitForSelector(".sync-notice.info");
check("確認で上書きを選ぶと転送する", (await log()).includes("転送: download ORDR02,PRTORD"));
check("転送が終わると選択が外れる", (await page.$eval(key("transfer"), n => n.textContent)) === "転送");
check("新しく落としたメンバーはローカルに メンバー名-記述.タイプ で入り、状態が「同じ日時」になる",
  (await state("ORDR02")) === "同じ日時" && (await cellText("ORDR02", 3)).includes("ORDR02-受注 CL.clle"),
  await cellText("ORDR02", 3));
check("結果の通知が出る", (await page.$eval(".sync-notice", n => n.textContent)) === "2 件を転送しました。");

// ---- 5. 向きを切り替える -------------------------------------------------------

await page.click(key("direction:upload"));
await page.waitForFunction(() => document.querySelector('[data-key="direction:upload"]').getAttribute("aria-checked") === "true");
await settle();
check("アップロード向きでは列が 転送元（ローカル）/ 転送先（IBM i）",
  (await page.$$eval("thead th", ns => ns.map(n => n.textContent))).slice(2, 4).join("|") === "転送元（ローカル）|転送先（IBM i）");
check("IBM i にしか無いものは選べず、ローカルにしか無いものは新規として選べる",
  (await state("LOCAL1")) === "転送先に無し（新規）" && (await enabled(key("select:LOCAL1"))));
await page.click(key("select:LOCAL1"));
await settle();
await page.click(key("transfer"));
await page.waitForFunction(() => document.querySelector("#log").textContent.includes("転送: upload"));
await settle();
check("アップロードもそのまま転送できる", (await log()).includes("転送: upload LOCAL1") && (await state("LOCAL1")) === "同じ日時");

check("画面の例外・コンソールのエラーが無い", errors.length === 0, errors.join(" / "));
await page.screenshot({ path: join(HERE, "out", "sync-e2e.png"), fullPage: true });
await browser.close();

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} PASS`);
process.exit(passed === results.length ? 0 : 1);
