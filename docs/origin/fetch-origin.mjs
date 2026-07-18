// 原典 HTML 収集スクリプト。
//   sources.mjs の対象を Playwright(chromium) で描画し、描画後 outerHTML を
//   docs/origin/<category>/<name>.html に保存、結果を manifest.yml に記録する。
//
// 使い方（playwright は本体依存に入れない。外部導入先を PLAYWRIGHT_PKG で渡す。
// ESM は NODE_PATH で解決しないため、絶対パスを動的 import する）:
//   cd /tmp && npm i playwright && npx playwright install chromium   # 初回のみ
//   PLAYWRIGHT_PKG=/tmp/node_modules/playwright/index.js node docs/origin/fetch-origin.mjs            # 全カテゴリ
//   PLAYWRIGHT_PKG=/tmp/node_modules/playwright/index.js node docs/origin/fetch-origin.mjs --only=cl  # 一部のみ(他は既存manifestを維持)
//
// 保存方針: 描画後 document.documentElement.outerHTML から <script>/<noscript> を
//   除去（本文・表・桁構造・<style> は保持）。manifest items/gaps は JSON フロー記法
//   （＝有効な YAML）で書き、再実行時に読み戻してマージできるようにする。

// Playwright はブラウザ描画が要る取得先だけで使う。topic(コンテンツAPI)で
// 取れるものは不要なので、遅延読み込みにする（未導入でも API 取得は動く）。
let chromium = null;
async function loadChromium() {
  if (chromium) return chromium;
  const pw = await import(process.env.PLAYWRIGHT_PKG || 'playwright');
  chromium = pw.chromium || (pw.default && pw.default.chromium);
  return chromium;
}
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, 'manifest.yml');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const { version, categories } = await import('./sources.mjs');

// --- args ---
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : Object.keys(categories);
// 取得言語。日本語(ja)が既定。英語(en)は docs/origin/<category>-en/ に保存する。
const langArg = process.argv.find((a) => a.startsWith('--lang='));
const lang = langArg ? langArg.slice('--lang='.length) : 'ja';
const suffix = lang === 'ja' ? '' : `-${lang}`;

const namesArg = process.argv.find((a) => a.startsWith('--names=')); // 特定 name のみ再取得（任意）
const onlyNames = namesArg ? new Set(namesArg.slice('--names='.length).split(',').map((s) => s.trim()).filter(Boolean)) : null;

// IBM の bot ブロック等は status 200・十分な本文長で「The page you requested cannot be displayed」
// 通知ページを返すことがある。これを成功と誤判定しないための検出。
const BOT_NOTICE = /cannot be displayed|IBM notice|HTTP response code 5\d\d|要求されたページを表示できません/i;

// --- 既存 manifest を読み戻す（他カテゴリの結果をマージ保持） ---
function loadExisting() {
  const items = new Map(); // key: `${category}/${name}` -> obj
  const gaps = new Map();
  if (!existsSync(MANIFEST)) return { items, gaps };
  const text = readFileSync(MANIFEST, 'utf8');
  let section = null;
  for (const line of text.split('\n')) {
    if (/^items:/.test(line)) { section = 'items'; continue; }
    if (/^gaps:/.test(line)) { section = 'gaps'; continue; }
    if (/^notes:/.test(line) || /^[a-z_]+:/.test(line)) { section = null; }
    const m = line.match(/^\s*-\s*(\{.*\})\s*$/);
    if (!m || !section) continue;
    try {
      const obj = JSON.parse(m[1]);
      const key = `${obj.category}/${obj.name}`;
      (section === 'items' ? items : gaps).set(key, obj);
    } catch { /* skip unparmsable */ }
  }
  return { items, gaps };
}

const { items, gaps } = loadExisting();

function urlOf(cat, item) {
  const c = categories[cat];
  if (item.url) return item.url;
  if (c.urlFor) return c.urlFor(item.name);
  throw new Error(`no url for ${cat}/${item.name}`);
}

let browser = null;
let ctx = null;
async function browserContext() {
  if (ctx) return ctx;
  browser = await (await loadChromium()).launch({ headless: true });
  ctx = await browser.newContext({ userAgent: UA });
  return ctx;
}

// IBM Documentation は本文をコンテンツ API から取得して描画する。
// `?topic=` 形式のページは描画完了の判定が難しく、本文が空のまま保存されて
// しまうことがある（実際に ilerpg で桁表が1つも取れていなかった）。
// item.topic が指定されている場合は、この API を直接叩いて本文だけを取る。
const contentApi = (topic) =>
  `https://www.ibm.com/docs/api/v1/content/${encodeURIComponent(topic)}?parsebody=true&lang=${lang}`;

async function fetchViaApi(cat, item, topic) {
  const key = `${cat}${suffix}/${item.name}`;
  const outRel = `${cat}${suffix}/${item.name}.html`;
  const outAbs = join(HERE, outRel);
  const url = contentApi(topic);

  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA } });
    const body = resp.ok ? await resp.text() : '';
    const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (!resp.ok || text.length < 200 || BOT_NOTICE.test(text)) {
      const reason = !resp.ok ? `http ${resp.status}` : `本文が短い (${text.length})`;
      gaps.set(key, { category: cat, name: item.name, source_url: url, reason });
      items.delete(key);
      console.log(`GAP  ${key}  ${reason}`);
      return;
    }

    const title = (body.match(/<h1[^>]*>(.*?)<\/h1>/s) || [, item.name])[1]
      .replace(/<[^>]+>/g, '').trim();
    const html = `<!DOCTYPE html>\n<html lang="ja"><head><meta charset="utf-8"><title>${title}</title></head>\n<body>\n${body}\n</body></html>\n`;

    mkdirSync(dirname(outAbs), { recursive: true });
    writeFileSync(outAbs, html);
    const bytes = statSync(outAbs).size;

    // 桁位置の記述（「N 桁目」「N から M 桁目」）と表の数を記録する。
    // これが 0 のまま「取得成功」と扱ったことが、今回の取りこぼしの原因。
    const columns = (text.match(/\d+\s*(?:から\s*\d+\s*)?桁目/g) || []).length;
    const tables = (body.match(/<table/g) || []).length;

    items.set(key, {
      file: outRel, category: cat, name: item.name, source_url: url,
      topic, lang, http_status: resp.status, title, bytes,
      columns, tables, fetched_at: new Date().toISOString(),
      ...(item.note ? { note: item.note } : {}),
    });
    gaps.delete(key);
    console.log(`OK   ${outRel}  (${resp.status}, ${bytes}b, 桁記述 ${columns}, 表 ${tables}) ${title}`);
  } catch (e) {
    gaps.set(key, { category: cat, name: item.name, source_url: url, reason: String(e.message || e).slice(0, 160) });
    items.delete(key);
    console.log(`GAP  ${key}  ${e.message}`);
  }
}

async function fetchOne(cat, item) {
  // topic 指定（item 個別）またはカテゴリの topicFor があれば API 経由で取る。
  const topic = item.topic ?? categories[cat].topicFor?.(item.name);
  if (topic) return fetchViaApi(cat, item, topic);

  const url = urlOf(cat, item);
  const key = `${cat}/${item.name}`;
  const outRel = `${cat}/${item.name}.html`;
  const outAbs = join(HERE, outRel);
  const page = await (await browserContext()).newPage();
  const attempt = async () => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const status = resp ? resp.status() : -1;
    await page.waitForFunction(() => document.body && document.body.innerText.length > 2000, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const bodyText = document.body ? document.body.innerText : '';
      for (const el of document.querySelectorAll('script,noscript')) el.remove();
      return {
        title: document.title,
        textLen: bodyText.length,
        bodyText: bodyText.slice(0, 4000),
        html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
        finalUrl: location.href,
      };
    });
    const botBlocked = BOT_NOTICE.test(info.title) || BOT_NOTICE.test(info.bodyText);
    return { status, botBlocked, ...info };
  };
  try {
    let r = await attempt();
    if (r.status !== 200 || r.textLen < 1000 || r.botBlocked) {
      await page.waitForTimeout(2000);
      r = await attempt(); // 1 回リトライ（bot ブロックは少し長く待つ）
    }
    if (r.status === 200 && r.textLen >= 1000 && !r.botBlocked) {
      mkdirSync(dirname(outAbs), { recursive: true });
      writeFileSync(outAbs, r.html);
      const bytes = statSync(outAbs).size;
      items.set(key, { file: outRel, category: cat, name: item.name, source_url: url, final_url: r.finalUrl, http_status: r.status, title: r.title, bytes, fetched_at: new Date().toISOString(), ...(item.note ? { note: item.note } : {}) });
      gaps.delete(key);
      console.log(`OK   ${outRel}  (${r.status}, ${bytes}b) ${r.title}`);
    } else {
      const reason = r.botBlocked ? `bot-notice page (http ${r.status})` : `http ${r.status} / textLen ${r.textLen}`;
      gaps.set(key, { category: cat, name: item.name, source_url: url, reason });
      items.delete(key);
      console.log(`GAP  ${key}  ${reason}`);
    }
  } catch (e) {
    gaps.set(key, { category: cat, name: item.name, source_url: url, reason: String(e.message || e).slice(0, 160) });
    items.delete(key);
    console.log(`GAP  ${key}  ${e.message}`);
  } finally {
    await page.close();
  }
}

for (const cat of only) {
  const c = categories[cat];
  if (!c) { console.log(`(skip unknown category ${cat})`); continue; }
  const targets = onlyNames ? c.items.filter((it) => onlyNames.has(it.name)) : c.items;
  console.log(`\n=== ${cat} (${targets.length}${onlyNames ? `/${c.items.length}` : ''}) ===`);
  for (const item of targets) {
    await fetchOne(cat, item);
    await new Promise((r) => setTimeout(r, 800)); // リクエスト過多回避
  }
}

if (browser) await browser.close();

// --- manifest 出力 ---
function emit(map) {
  return [...map.values()]
    .sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name))
    .map((o) => `  - ${JSON.stringify(o)}`)
    .join('\n');
}
const okCount = items.size, gapCount = gaps.size;
const manifest = [
  `# 原典 HTML 収集マニフェスト（fetch-origin.mjs が生成）`,
  `generated_at: ${new Date().toISOString()}`,
  `version: ${version}  # IBM i 7.4（cl/ilerpg）。rpg3 は jaymoseley（下記 notes）`,
  `fetch_method: "playwright chromium, rendered document.documentElement.outerHTML, <script>/<noscript> stripped"`,
  `counts: { items: ${okCount}, gaps: ${gapCount} }`,
  `items:`,
  emit(items),
  `gaps:`,
  gapCount ? emit(gaps) : '  []',
  `notes:`,
  `  rpg3: "第三者(jaymoseley) RPG II/III チュートリアル。IBM 正典 = RPG/400 Reference (SC09-1817系, PDF; ibm.com/docs に生HTML無し)"`,
  ``,
].join('\n');
writeFileSync(MANIFEST, manifest);
console.log(`\nmanifest -> ${MANIFEST}  items=${okCount} gaps=${gapCount}`);
