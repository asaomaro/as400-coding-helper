#!/usr/bin/env node
/**
 * `dds-conditioning.json` が原典と一致し、**実機の判定とも食い違わない**ことを検査する。
 *
 * 見るのは 3 つ:
 *   1. 生成し直しても中身が変わらないこと（生成物が最新である）
 *   2. **実機で確かめた 5 件**と一致すること
 *   3. 抽出した件数が極端に減っていないこと（原典の書き方が変わったときの気付き）
 *
 * 2 が要点。抽出は決まり文句の正規表現なので、**当たっているかどうかは原典の中だけでは
 * 分からない**。実機で `CRTDSPF` に通した結果を錨にしている。
 *
 * 使い方:  node docs/origin/verify-dds-conditioning.mjs
 * 終了コード: 0=OK / 1=不一致
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const OUT = join(ROOT, "vscode-extension/resources/completion/dds-conditioning.json");

/**
 * **実機（IBM i 7.3・2026-08-27）で `CRTDSPF` に通した結果。**
 *
 * `.aidev/works/20260827-dds-conditional-edtcde/verify/probe-conditionable-keywords.mjs`
 * が再現する。キーワードだけの行に条件標識を付けてコンパイルし、通るかどうかを見た。
 */
const MACHINE = [
  { kind: "DSPF", keyword: "DSPATR", conditionable: true },
  { kind: "DSPF", keyword: "COLOR", conditionable: true },
  { kind: "DSPF", keyword: "EDTCDE", conditionable: false },
  { kind: "DSPF", keyword: "EDTWRD", conditionable: false },
  { kind: "DSPF", keyword: "CHECK", conditionable: false }
];

/** 抽出できた件数の下限（原典の書き方が変わって取りこぼしたときに気付くため）。 */
const MINIMUM = { DSPF: 140, PRTF: 60 };

const before = readFileSync(OUT, "utf8");
execFileSync(process.execPath, [join(HERE, "generate-dds-conditioning.mjs")], { stdio: "pipe" });
const after = readFileSync(OUT, "utf8");

const failures = [];

if (before !== after) {
  failures.push("生成し直すと中身が変わる（生成物が最新でない）");
}

const data = JSON.parse(after);

for (const { kind, keyword, conditionable } of MACHINE) {
  const got = data.keywords[kind]?.[keyword];
  if (got !== conditionable) {
    failures.push(
      `実機と食い違う: ${kind} の ${keyword} は実機で` +
        `${conditionable ? "通る" : "通らない"}が、原典からは ${String(got)}`
    );
  }
}

for (const [kind, minimum] of Object.entries(MINIMUM)) {
  const total = Object.keys(data.keywords[kind] ?? {}).length;
  if (total < minimum) {
    failures.push(`${kind} の判定が ${total} 件しかない（${minimum} 件以上あるはず）`);
  }
}

const counts = data.counts ?? {};
console.log(
  `条件付けの可否の検査（DSPF ${Object.keys(data.keywords.DSPF ?? {}).length} 件 / ` +
    `PRTF ${Object.keys(data.keywords.PRTF ?? {}).length} 件`
    + `、判定なし DSPF ${counts.DSPF?.unknown ?? "?"} / PRTF ${counts.PRTF?.unknown ?? "?"}）`
);

if (failures.length > 0) {
  console.error(`\n✗ 条件付けの可否 NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("✓ 条件付けの可否 OK（原典と一致し、実機で確かめた 5 件とも食い違わない）");
