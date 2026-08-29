#!/usr/bin/env node
/**
 * **コンパイル・リストから「どの行の・どの桁が・どのメッセージで咎められたか」を取る。**
 *
 * 前回（20260829-dds-restricted-enable）はこれを項目名の grep で代用して 2 回まちがえた。
 *
 * 1. **リストは 2 部構成**（ソース → 展開後ソース）。後半にも項目名が出るので、
 *    素朴に名前で引くと後半が前半を上書きする（37 中 25 が「有効」に見えた）。
 * 2. **ページ境界で指摘行が親から離れる**。指摘は直前のソース行に属するが、
 *    間にページ見出しが割り込む。これで `V`(DSPF 35 桁) の指摘が見えず
 *    「一括の読み取りは当てにならない」と結論していた。**当てにならないのは読み取りの方**。
 *
 * 対処は 2 つとも構造で解く。前半だけを見る。ページ見出しと空行を飛ばして親を探す。
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** ページ見出し・欄見出し・空行。ソース行ではない。 */
const NOISE = /^\s*$|^\s*5770SS1|^\s*SEQNBR|Data Description|Expanded Source|^\s*\d+\s*$/u;
/** ソース行: 行番号 ＋ 6 桁目の `A`。 */
const SOURCE = /^\s*(\d+)\s{2,}(A)\s/u;
/** 指摘行: 先頭が `*`、メッセージ番号、`-` に続く `*` の並びが桁を指す。 */
const MARK = /^\*\s+(CP[DF]\d{4})-(\*+)/u;

/**
 * @returns {{seq:number, text:string, marks:{id:string,column:number,width:number}[]}[]}
 *   ソース行ごとに、その行に付いた指摘（メッセージ番号と**指す桁**）を返す。
 */
export function parseListing(text) {
  // **前半（ソース）だけを見る。**
  const head = text.split(/E N D\s+O F\s+S O U R C E/u)[0] ?? text;
  const lines = head.split("\n");
  const out = [];
  let current = null, base = -1;

  for (const line of lines) {
    const s = line.match(SOURCE);
    if (s) {
      // 6 桁目の `A` の位置を基準にする（桁の換算はこれだけで決まる）。
      base = line.indexOf(s[2], line.indexOf(s[1]) + s[1].length);
      current = { seq: Number(s[1]), text: line.trimEnd(), marks: [] };
      out.push(current);
      continue;
    }
    const m = line.match(MARK);
    if (m && current) {
      // `-` の直後から `*` が始まる。その位置が指す桁（6 桁目の `A` を基準に換算）。
      const at = line.indexOf(`-${m[2]}`) + 1;
      current.marks.push({ id: m[1], column: at - base + 6, width: m[2].length });
      continue;
    }
    // ページ見出し・空行は**親を切らない**（ここが前回の欠陥）。
    if (!NOISE.test(line) && line.trim()) current = null;
  }
  return out;
}

/** `column` の 1 文字を差し替えた検証ソースの結果を、文字ごとに分類する。 */
export function classify(rows, column, chars) {
  const result = new Map();
  const fields = rows.filter(r => /^\s*\d+\s+A\s+\S/u.test(r.text) || r.marks.length >= 0);
  chars.forEach((ch, i) => {
    const row = fields[i];
    if (!row) { result.set(ch, { verdict: "行なし", marks: [] }); return; }
    const own = row.marks.filter(m => m.column === column);
    const other = row.marks.filter(m => m.column !== column);
    result.set(ch, {
      verdict: own.length ? "この桁を咎められた" : other.length ? "他の桁を咎められた" : "指摘なし",
      marks: row.marks, seq: row.seq, text: row.text
    });
  });
  return result;
}

// **直接実行のときだけ動かす。** import されたときに走ると、
// 呼び出し側の引数（`--dry` 等）をファイル名と誤って読みに行く。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2]) {
  const rows = parseListing(readFileSync(process.argv[2], "utf8"));
  for (const r of rows) {
    console.log(`${String(r.seq).padStart(5)} ${r.text.slice(0, 62).padEnd(62)} ${r.marks.map(m => `${m.id}@${m.column}`).join(" ")}`);
  }
}
