/**
 * F4 プロンプターの単独起動ハーネスを**実際に操作して**確かめる e2e。
 *
 * ## なぜ要るか
 *
 * プロンプターの中身は WebView で、**拡張ホストからは触れない**
 * （統合テストは「例外なく開けた」までしか見られない。`20260828-f4-integration-test`）。
 * 一方でこの機能の中身は「打つ・選ぶ・組を増やす・ヘルプを出す・確定する」という
 * **操作そのもの**。HTML に文字列が含まれることを確かめても、**押して動くか**は分からない。
 *
 * 実際、`dependencies` は WebView に渡っておらず**一度も画面に出ていなかった**のに、
 * `buildInitialState()` を見る単体テストは通っていた（PR#93〜#98 で 3 回）。
 *
 * ここではハーネスをブラウザで開いて実際に操作し、**確定した値と書き戻される行**まで見る。
 * UI とコアが繋がって初めて通るので、繋ぎ目の取り違えもここで落ちる。
 *
 * ## 動かし方
 *
 *   npm install --no-save playwright-core     # 依存には入れない（CI にブラウザが無いため）
 *   npm run compile:webview
 *   node dev/prompter-e2e.mjs
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PAGE = join(HERE, "out", "prompter.html");

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
  console.error("dev/out/prompter.html がありません。先に `npm run compile:webview` を実行してください。");
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => {
  if (message.type() === "error") errors.push(message.text());
});

await page.goto(pathToFileURL(PAGE).href, { waitUntil: "load" });
await page.waitForSelector(".field[data-field-name]");

// --- 小物 -------------------------------------------------------------------

const settle = () => page.waitForTimeout(120);
const pick = async label => {
  await page.selectOption("#sample", { label });
  await settle();
};
const shownFields = () =>
  page.$$eval(".field[data-field-name]:not(.hidden)", ns => ns.map(n => n.dataset.fieldName));
const requiredFields = () =>
  page.$$eval(".field[data-field-name]", ns =>
    ns
      .filter(n => n.querySelector(".required-mark")?.textContent?.trim() === "*")
      .map(n => n.dataset.fieldName)
  );
const groupsOf = base =>
  page.$$eval(
    ".group-field[data-group-name]",
    (ns, b) => ns.map(n => n.dataset.groupName).filter(x => x === b || x.startsWith(b + "#")),
    base
  );
const fieldErrors = () =>
  page.$$eval("#root .field .error", ns =>
    ns.filter(n => n.textContent.trim()).map(n => n.closest(".field").dataset.fieldName)
  );
const outcome = () => page.$eval("#outcome", n => n.textContent);
const resultLine = () => page.$eval("#result", n => n.textContent);
const activeName = () => page.evaluate(() => document.activeElement?.getAttribute("name") ?? null);

// ---- 1. VSCode の外で画面ができる ------------------------------------------

check(
  "**VSCode 無しで定義から画面が組み上がる**（SBMJOB の 47 欄）",
  (await page.$$eval(".field[data-field-name]", ns => ns.length)) === 47,
  `${await page.$$eval(".field[data-field-name]", ns => ns.length)} 欄`
);
check(
  "見出しがコマンド名になっている",
  (await page.$eval(".prompter-title", n => n.textContent)).startsWith("SBMJOB プロンプター")
);
check(
  "開いたら最初の欄にフォーカスがある（キーボードだけで始められる）",
  (await activeName()) === "CMD",
  String(await activeName())
);

// ---- 2. グルーピング --------------------------------------------------------

const groupLabels = await page.$$eval(".group-field legend", ns => ns.map(n => n.textContent));
check(
  "修飾名が 1 つの囲みに入り、見出しが付く",
  groupLabels.includes("ジョブ記述") && groupLabels.length >= 4,
  groupLabels.slice(0, 4).join(" / ")
);
check(
  "囲みの中は末端の入力欄（group そのものには欄が無い）",
  (await page.$$eval('.group-field[data-group-name="JOBD"] input[name]', ns =>
    ns.map(n => n.name)
  )).join(",") === "LIB,JOBD"
);

// ---- 3. 追加パラメーター（F10）---------------------------------------------

const basicCount = (await shownFields()).length;
await page.keyboard.press("F10");
await settle();
const expandedCount = (await shownFields()).length;
check(
  "F10 で追加パラメーターが現れる",
  basicCount === 11 && expandedCount === 47,
  `${basicCount} → ${expandedCount}`
);
check(
  "ボタンの文言が切り替わる",
  (await page.$eval(".toggle-additional", n => n.textContent)) === "追加パラメーターを隠す (F10)"
);
await page.keyboard.press("F10");
await settle();
check("もう一度 F10 で畳まれる", (await shownFields()).length === basicCount);

// ---- 4. 連続して打てる（描き直しでフォーカスが飛ばない）--------------------

await page.click('[name="CMD"]');
await page.keyboard.type("CALL PGM(MYPGM)");
check(
  "**1 文字ごとに描き直してもフォーカスとカーソルが飛ばない**",
  (await page.$eval('[name="CMD"]', n => n.value)) === "CALL PGM(MYPGM)" &&
    (await activeName()) === "CMD" &&
    (await page.$eval('[name="CMD"]', n => n.selectionStart)) === 15,
  `値 "${await page.$eval('[name="CMD"]', n => n.value)}" / 位置 ${await page.$eval('[name="CMD"]', n => n.selectionStart)}`
);

// ---- 5. 値がコマンドの欄で、さらにプロンプターを開く（F4 in F4）------------

// 構成を作り直す操作（F10・組の増減）を挟んでも、入れた値が消えないこと。
// **描き直しは毎回コアから作り直す**ので、値の持ち回りを落とすと静かに消える。
await page.keyboard.press("F10");
await settle();
await page.keyboard.press("F10");
await settle();
check(
  "**構成を作り直しても入力した値が残る**（F10 を挟んでも消えない）",
  (await page.$eval('[name="CMD"]', n => n.value)) === "CALL PGM(MYPGM)",
  await page.$eval('[name="CMD"]', n => n.value)
);

check(
  "値がコマンドの欄にだけ F4 の印が出る",
  (await page.$$eval(".prompt-indicator", ns => ns.map(n => n.dataset.parameterName))).join(",") ===
    "CMD"
);
await page.keyboard.press("F4");
await settle();
check(
  "F4 で入れ子のプロンプターが開く",
  !(await page.$eval("#nested", n => n.classList.contains("hidden"))) &&
    (await page.$eval("#nested-keyword", n => n.textContent)) === "CALL",
  `開いた定義: ${await page.$eval("#nested-keyword", n => n.textContent)}`
);
check(
  "**欄に書いてあった値が入れ子に引き継がれる**",
  (await page.$eval('#nested-root [name="PGM"]', n => n.value)) === "MYPGM",
  await page.$eval('#nested-root [name="PGM"]', n => n.value)
);
await page.fill('#nested-root [name="PGM"]', "OTHERPGM");
await page.click("#nested-root button[type=submit]");
await settle();
check(
  "入れ子で確定すると、素の 1 行コマンドが欄に戻る（桁揃えも折り返しもしない）",
  (await page.$eval('[name="CMD"]', n => n.value)) === "CALL PGM(*LIBL/OTHERPGM)",
  await page.$eval('[name="CMD"]', n => n.value)
);

// ---- 6. 確定と書き戻し ------------------------------------------------------

await page.click("#root button[type=submit]");
await settle();
check("確定できる", (await outcome()) === "確定");
check(
  "**書き戻される行が桁どおり**（1-13 ラベル欄・14 桁目からコマンド）",
  (await resultLine()) === "             SBMJOB     CMD(CALL PGM(*LIBL/OTHERPGM))",
  JSON.stringify(await resultLine())
);

// ---- 7. 取り消し ------------------------------------------------------------

await page.keyboard.press("Escape");
await settle();
check("Esc で取り消しになる", (await outcome()) === "取り消し");
await page.click("#root .cancel");
await settle();
check("Cancel ボタンでも取り消しになる", (await outcome()) === "取り消し");

// ---- 8. 条件で必須が変わる（dependsOn）-------------------------------------

await pick("SNDPGMMSG — 条件必須・相関制約");
const beforeRequired = await requiredFields();
await page.fill('[name="MSGID"]', "CPF9898");
await settle();
const afterRequired = await requiredFields();
check(
  "**メッセージ ID を入れると メッセージ・ファイル が必須になる**（group の規則が末端に効く）",
  !beforeRequired.includes("MSGF") && afterRequired.includes("MSGF"),
  `${beforeRequired.join(",") || "なし"} → ${afterRequired.join(",")}`
);

// ---- 8b. CDML(PMTCTL) の条件表示 -------------------------------------------

await pick("SAVOBJ — PMTCTL の条件表示");
// 保管ファイルの欄は追加パラメーター側にあるので、まず F10 で開く
// （**畳んだままだと PMTCTL ではなく F10 で隠れていることになり、検査にならない**）。
await page.keyboard.press("F10");
await settle();
const savePane = async () => {
  const fields = await shownFields();
  return ["SAVF", "MEDDFN"].filter(name => fields.includes(name)).join(",") || "どちらも無し";
};
check("装置を選ぶ前は保管ファイルの欄が出ていない", (await savePane()) === "どちらも無し", await savePane());
await page.fill('[name="DEV"]', "*SAVF");
await settle();
check(
  "**装置に *SAVF を入れると保管ファイルの欄が現れる**（PMTCTL が入力に追従する）",
  (await savePane()) === "SAVF",
  await savePane()
);
await page.fill('[name="DEV"]', "*MEDDFN");
await settle();
check("装置を替えると入れ替わる", (await savePane()) === "MEDDFN", await savePane());

await pick("SNDPGMMSG — 条件必須・相関制約");
await page.fill('[name="MSGID"]', "CPF9898");
await settle();

// ---- 9. 必須が空なら確定しない ---------------------------------------------

await page.click("#root button[type=submit]");
await settle();
check(
  "必須が空のままなら確定しない",
  (await outcome()) === "" && (await fieldErrors()).includes("MSGF"),
  `outcome=${JSON.stringify(await outcome())} 赤字=${(await fieldErrors()).join(",")}`
);
check("止めた欄にフォーカスが移る", (await activeName()) === "MSGF", String(await activeName()));
await page.fill('[name="MSGF"]', "QCPFMSG");
await settle();
await page.click("#root button[type=submit]");
await settle();
check(
  "埋めれば確定できる",
  (await outcome()) === "確定" &&
    (await resultLine()) === "             SNDPGMMSG  MSGID(CPF9898) MSGF(*LIBL/QCPFMSG)",
  JSON.stringify(await resultLine())
);

// ---- 10. 相関制約（コマンド単位）-------------------------------------------

await pick("SNDPGMMSG — 条件必須・相関制約");
await page.fill('[name="MSG"]', "hello");
await page.fill('[name="MSGID"]', "CPF9898");
await settle();
const banner = await page.$eval(".constraint-errors", n => n.textContent);
check(
  "**排他の相関（MSG と MSGID）が帯に出る**",
  !(await page.$eval(".constraint-errors", n => n.classList.contains("hidden"))) &&
    banner.includes("MSGID"),
  banner.split("\n")[0]
);
await page.click("#root button[type=submit]");
await settle();
check("相関に違反している間は確定しない", (await outcome()) === "");

// ---- 11. 繰り返し指定の組 ---------------------------------------------------

await pick("PARM — 繰り返しの組");
check(
  "繰り返し group にだけ「追加」が出る",
  (await page.$$eval(".group-add", ns => ns.map(n => n.dataset.group))).sort().join(",") ===
    "SNGVAL,SPCVAL"
);
check("1 組目には「削除」を出さない（消すとパラメータ自体が無くなる）",
  (await page.$$(".group-remove")).length === 0);

await page.click('.group-add[data-group="SNGVAL"]');
await settle();
await page.click('.group-add[data-group="SNGVAL"]');
await settle();
check(
  "追加すると組が増え、入力欄名に連番が付く",
  (await groupsOf("SNGVAL")).join(",") === "SNGVAL,SNGVAL#2,SNGVAL#3",
  (await groupsOf("SNGVAL")).join(",")
);
check(
  "2 組目以降にだけ「削除」が出る",
  (await page.$$eval(".group-remove", ns => ns.map(n => n.dataset.group))).join(",") ===
    "SNGVAL#2,SNGVAL#3"
);

await page.fill('[name="KWD"]', "KEEPME");
await settle();
await page.click('.group-add[data-group="SPCVAL"]');
await settle();
check(
  "組を増やしても、他の欄に入れた値が残る",
  (await page.$eval('[name="KWD"]', n => n.value)) === "KEEPME",
  await page.$eval('[name="KWD"]', n => n.value)
);

await page.fill('[name="SNGVAL_E1#2"]', "SECOND");
await page.fill('[name="SNGVAL_E1#3"]', "THIRD");
await settle();
await page.click('.group-remove[data-group="SNGVAL#2"]');
await settle();
check(
  "**途中の組を消すと後ろが繰り上がる**（連番が飛ぶと値と入力欄名の対応が崩れる）",
  (await groupsOf("SNGVAL")).join(",") === "SNGVAL,SNGVAL#2" &&
    (await page.$eval('[name="SNGVAL_E1#2"]', n => n.value)) === "THIRD" &&
    (await page.$('[name="SNGVAL_E1#3"]')) === null,
  `組=${(await groupsOf("SNGVAL")).join(",")} 2組目=${await page.$eval('[name="SNGVAL_E1#2"]', n => n.value)}`
);

// ---- 12. 複数値の欄 ---------------------------------------------------------

await pick("CALL — 入れ子で開く先");
check(
  "上限のある欄は複数値欄になる（CALL の PARM は 255 件）",
  (await page.$$eval(".multi-field", ns => ns.map(n => n.dataset.name + ":" + n.dataset.max))).join(
    ","
  ) === "PARM:255"
);
await page.click(".multi-add");
await settle();
await page.click(".multi-add");
await settle();
check("「追加」で入力欄が増える", (await page.$$(".multi-item")).length === 3);

const items = await page.$$(".multi-field input");
await items[0].fill("'A'");
await items[1].fill("'B'");
await page.fill('[name="PGM"]', "MYPGM");
await settle();
await page.click("#root button[type=submit]");
await settle();
check(
  "**空の欄は落として配列で確定する**",
  JSON.parse(await page.$eval("#values", n => n.textContent)).PARM.join(",") === "'A','B'",
  await page.$eval("#values", n => n.textContent.replace(/\s+/gu, " "))
);
check(
  "複数値は空白区切りで書き戻される",
  (await resultLine()) === "             CALL       PGM(*LIBL/MYPGM) PARM('A' 'B')",
  JSON.stringify(await resultLine())
);
await page.click(".multi-remove");
await settle();
check("「-」で入力欄を減らせる", (await page.$$(".multi-item")).length === 2);

// ---- 13. オブジェクト名の候補 ----------------------------------------------

await pick("CRTBNDRPG — 候補一覧・条件表示");
check(
  "種類ごとに候補一覧が出る",
  // **欄ごとの候補（`choices-*`）と混ぜて数えない。** ここが見たいのは
  // 「オブジェクト名の候補が種類ごとに出ているか」だけ。
  (await page.$$eval("datalist[id^='objects-']", ns => ns.map(n => n.id))).join(",") ===
    "objects-program,objects-file,objects-dataArea",
  (await page.$$eval("datalist[id^='objects-']", ns => ns.map(n => n.id))).join(",")
);
check(
  "**欄に候補が紐づく**（定義に objectKind があるだけでは死蔵）",
  (await page.$eval('[name="PGM"]', n => n.getAttribute("list"))) === "objects-program" &&
    (await page.$eval('[name="SRCFILE"]', n => n.getAttribute("list"))) === "objects-file"
);

// ---- 13b. 候補にすぎない選択欄（一覧に無い値も打てる）----------------------

await pick("ADDPFM — 候補にすぎない選択欄");
await page.keyboard.press("F10"); // SRCTYPE は追加パラメーター側
await settle();

check(
  "**候補にすぎない欄は自由入力になる**（`<select>` では一覧に無い値を打てない）",
  (await page.$eval('[name="SRCTYPE"]', n => n.tagName)) === "INPUT" &&
    (await page.$eval('[name="SRCTYPE"]', n => n.getAttribute("list"))) === "choices-SRCTYPE",
  await page.$eval('[name="SRCTYPE"]', n => n.tagName + " list=" + n.getAttribute("list"))
);
check(
  "候補は一覧として見える（打ちながら選べる）",
  (await page.$$eval("#choices-SRCTYPE option", ns => ns.map(n => n.value))).join(",") === "*NONE",
  (await page.$$eval("#choices-SRCTYPE option", ns => ns.map(n => n.value))).join(",")
);
check(
  "**制限のある欄は `<select>` のまま**（振る舞いを変えない）",
  (await page.$$eval("#root select[name]", ns => ns.length)) > 0,
  `${await page.$$eval("#root select[name]", ns => ns.length)} 欄`
);

await page.fill('[name="SRCTYPE"]', "RPGLE");
await page.fill('[name="FILE"]', "QRPGLESRC");
await page.fill('[name="MBR"]', "MYPGM");
await settle();
check(
  "一覧に無い値を打っても咎めない（実機は Rstd=NO で受ける）",
  (await fieldErrors()).length === 0,
  (await fieldErrors()).join(",")
);
await page.click("#root button[type=submit]");
await settle();
check(
  "**打った値が確定して書き戻しに乗る**",
  (await outcome()) === "確定" && (await resultLine()).includes("SRCTYPE(RPGLE)"),
  JSON.stringify(await resultLine())
);

// ---- 14. CL 変数の余地（maxlength）-----------------------------------------

await pick("SNDPGMMSG — 条件必須・相関制約");
const msgid = await page.$eval('[name="MSGID"]', n => ({
  size: n.size,
  max: n.maxLength
}));
await page.fill('[name="MSGID"]', "&MSGIDVAR");
check(
  "**CL 変数が maxlength で打ち切られない**（MSGID は 7 文字だが & + 名前 10 まで）",
  msgid.max === 11 && (await page.$eval('[name="MSGID"]', n => n.value)) === "&MSGIDVAR",
  `size=${msgid.size} maxlength=${msgid.max} 値=${await page.$eval('[name="MSGID"]', n => n.value)}`
);

// ---- 15. ヘルプ（F1）-------------------------------------------------------

await page.click('[name="MSGID"]');
await page.keyboard.press("F1");
await settle();
check(
  "F1 でヘルプが開く",
  (await page.$eval(".help-overlay", n => n.classList.contains("visible"))) &&
    (await page.$eval(".help-content", n => n.textContent)).length > 20
);
await page.keyboard.press("Escape");
await settle();
check(
  "**Esc で閉じ、フォーカスが元の欄へ戻る**（戻さないとキーボード操作がここで途切れる）",
  !(await page.$eval(".help-overlay", n => n.classList.contains("visible"))) &&
    (await activeName()) === "MSGID",
  String(await activeName())
);
await page.click(".field[data-field-name='MSGID'] .help-indicator");
await settle();
check("印をクリックしても開く", await page.$eval(".help-overlay", n => n.classList.contains("visible")));
// 中央は台紙が覆っているので、隅を押す（利用者も見えている所を押す）。
await page.click(".help-backdrop", { position: { x: 5, y: 5 } });
await settle();
check("背景をクリックすると閉じる", !(await page.$eval(".help-overlay", n => n.classList.contains("visible"))));

await page.click("#command-help");
await settle();
check(
  "コマンド全体のヘルプも開く",
  (await page.$eval(".help-content", n => n.textContent)).includes("SNDPGMMSG")
);
await page.keyboard.press("Escape");
await settle();

// ---- 16. Tab の巡回 --------------------------------------------------------

await page.click('[name="MSG"]');
const visited = [];
for (let index = 0; index < 40; index += 1) {
  await page.keyboard.press("Tab");
  visited.push(await page.evaluate(() => {
    const active = document.activeElement;
    return active?.getAttribute("name") ?? active?.textContent ?? null;
  }));
  if (visited.length > 1 && visited[visited.length - 1] === visited[0]) break;
}
check(
  "**Tab だけでフォームを一周して先頭へ戻る**（既定の巡回は WebView の外へ抜ける）",
  visited.includes("OK") && visited.includes("Cancel") && visited[visited.length - 1] === visited[0],
  `${visited.length} 個を巡回`
);
check(
  "隠れている欄は巡回に入らない",
  !visited.some(name => name === null),
  visited.filter(n => n === null).length + " 個の不明"
);

await page.click('[name="MSG"]');
await page.keyboard.press("F1");
await settle();
await page.keyboard.press("Tab");
await settle();
check(
  "ヘルプ表示中の Tab は、ヘルプを閉じてから巡回する",
  !(await page.$eval(".help-overlay", n => n.classList.contains("visible")))
);

// ---- 17. 見えない欄は確定を止めない ----------------------------------------

await pick("FIXTURE — 見えない欄は咎めない（検証用）");
check(
  "条件を満たさない欄は出ていない",
  !(await shownFields()).includes("DETAIL"),
  (await shownFields()).join(",")
);
await page.click("#root button[type=submit]");
await settle();
check(
  "**隠れている必須の欄（条件・F10 の両方）は確定を止めない**",
  (await outcome()) === "確定",
  `outcome=${JSON.stringify(await outcome())} 赤字=${(await fieldErrors()).join(",")}`
);

await page.selectOption('[name="MODE"]', "*DETAIL");
await settle();
check("条件を満たすと欄が現れる", (await shownFields()).includes("DETAIL"));
await page.click("#root button[type=submit]");
await settle();
check(
  "現れた必須の欄は確定を止める",
  (await outcome()) === "" && (await fieldErrors()).includes("DETAIL"),
  (await fieldErrors()).join(",")
);

await page.fill('[name="DETAIL"]', "X");
await settle();
await page.keyboard.press("F10");
await settle();
check("F10 で追加パラメーターの必須欄が現れる", (await shownFields()).includes("EXTRA"));
await page.click("#root button[type=submit]");
await settle();
check(
  "展開したら、その必須欄は確定を止める",
  (await outcome()) === "" && (await fieldErrors()).includes("EXTRA"),
  (await fieldErrors()).join(",")
);

// ---- 18. CSP を守れる形になっているか --------------------------------------

check(
  "**インラインの style 属性を使っていない**（CSP から 'unsafe-inline' を外したので黙って落ちる）",
  (await page.$$eval("#root [style]", ns => ns.length)) === 0,
  `${await page.$$eval("#root [style]", ns => ns.length)} 個`
);

check("実行中に JS エラーが出ていない", errors.length === 0, errors.slice(0, 2).join(" | "));

await page.screenshot({ path: join(HERE, "out", "prompter-e2e.png"), fullPage: true });
await browser.close();

const failed = results.filter(ok => !ok).length;
console.log(`\n=== ${results.length - failed}/${results.length} PASS ===`);
process.exit(failed === 0 ? 0 : 1);
