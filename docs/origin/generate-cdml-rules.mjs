#!/usr/bin/env node
/**
 * CDML(docs/origin/cmddef/*.xml) から DEP / PMTCTL / MapTo を取り出し、
 * 既存の CL プロンプター定義 JSON に流し込む。
 *
 * **JSON を手で直さずこのスクリプトを直す**（AGENTS.md の規約）。
 * 原典は実機の *CMD であり、散文の HTML からは復元できない情報を扱う。
 *
 * 書き込むのは 3 つだけで、既存の内容には触れない:
 *   - PrompterDefinition.dependencies      … <Cmd> 直下の <Dep>
 *   - ParameterDefinition.promptControl    … <Parm> 直下の <PmtCtl>
 *   - ParameterOption.mapTo                … <Value MapTo>（値と食い違うものだけ）
 *
 * MapTo は**規則から参照されるパラメータに限って**入れる。DEP/PMTCTL の CmpVal は
 * 内部値と比較するため変換が要るが、参照されない値まで入れても使われないため。
 *
 * 使い方:
 *   node docs/origin/generate-cdml-rules.mjs            # ja / en 両方
 *   node docs/origin/generate-cdml-rules.mjs --dry-run  # 書かずに差分だけ出す
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 数値として扱う実機のデータ型（DTD の Type）。
const NUMERIC_TYPES = new Set(["DEC", "INT2", "INT4", "UINT2", "UINT4"]);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const CMDDEF = join(HERE, "cmddef");
const LANGS = ["ja", "en"];
const DRY = process.argv.includes("--dry-run");

/* ------------------------------------------------------------------ *
 * 最小の XML 走査
 *
 * 正規表現で入れ子を追うと <Parm> の中の <PmtCtl> と、<Elem>/<Qual> の中の
 * ものを取り違える。タグを順に読んで深さを持つ方が確実。
 * CDML は機械生成でテキストノードもコメントも無いため、これで足りる。
 * ------------------------------------------------------------------ */
// `=` の前後に空白が入ることがある（`<ChoicePgmText Text= "*JOB, *HEX...">`）。
// 空白を許さないと開始タグだけ認識されず、対応する閉じタグが別の要素を閉じて
// 入れ子が崩れる。実際これで Dep の 536 件中 258 件が Cmd 直下から外れていた。
const TAG = /<(\/?)([A-Za-z]+)((?:\s+[A-Za-z]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

// XML の実体参照を戻す。戻さないと CmpVal に `X&apos;&apos;` のような文字列が
// そのまま入り、比較にも画面にも実体参照が出る。
function unescapeXml(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // &#160; はノーブレークスペース。CHGJOB の DATSEP/TIMSEP に現れるが、
    // 意味は「空白の区切り文字」なので通常の空白に寄せる。
    .replace(/&#(\d+);/g, (_all, code) =>
      Number(code) === 160 ? " " : String.fromCharCode(Number(code))
    )
    .replace(/&amp;/g, "&");
}

function attributes(text) {
  const result = {};
  for (const m of text.matchAll(/([A-Za-z]+)\s*=\s*"([^"]*)"/g)) {
    result[m[1]] = unescapeXml(m[2]);
  }
  return result;
}

/** XML を {name, attrs, children} の木にする。 */
function parseXml(xml) {
  const root = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(xml)) !== null) {
    const [, closing, name, attrText, selfClosing] = m;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = { name, attrs: attributes(attrText), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

const childrenNamed = (node, name) => node.children.filter(c => c.name === name);
const firstNamed = (node, name) => node.children.find(c => c.name === name);

/* ------------------------------------------------------------------ *
 * CDML → スキーマ
 * ------------------------------------------------------------------ */

const num = value => (value === undefined ? undefined : Number(value));

function toDependency(dep) {
  const a = dep.attrs;
  return {
    controlRelation: a.CtlKwdRel,
    ...(a.CtlKwd ? { controlParameter: a.CtlKwd } : {}),
    ...(a.CmpVal ? { controlCompareValue: a.CmpVal } : {}),
    ...(a.CmpKwd ? { controlCompareParameter: a.CmpKwd } : {}),
    // NbrTrueRel は DTD 上 #IMPLIED。無い場合は「全て成立」とみなす。
    countRelation: a.NbrTrueRel ?? "ALL",
    ...(a.NbrTrue !== undefined ? { count: num(a.NbrTrue) } : {}),
    ...(a.MsgID ? { messageId: a.MsgID } : {}),
    terms: childrenNamed(dep, "DepParm").map(term => ({
      parameter: term.attrs.Kwd,
      relation: term.attrs.Rel,
      ...(term.attrs.CmpVal !== undefined ? { compareValue: term.attrs.CmpVal } : {}),
      ...(term.attrs.CmpKwd ? { compareParameter: term.attrs.CmpKwd } : {})
    }))
  };
}

function toPromptControl(pmtCtl) {
  const a = pmtCtl.attrs;
  return {
    controlParameter: a.CtlKwd,
    countRelation: a.NbrTrueRel ?? "ALL",
    ...(a.NbrTrue !== undefined ? { count: num(a.NbrTrue) } : {}),
    ...(a.LglRel ? { logicalRelation: a.LglRel } : {}),
    conditions: childrenNamed(pmtCtl, "PmtCtlCond").map(cond => ({
      relation: cond.attrs.Rel,
      ...(cond.attrs.CmpVal !== undefined ? { compareValue: cond.attrs.CmpVal } : {})
    }))
  };
}

/** <Parm> 配下（Elem/Qual も含む）の Val→MapTo を集める。食い違うものだけ。 */
function collectMapTo(node, into) {
  for (const child of node.children) {
    if (child.name === "Value") {
      const { Val, MapTo } = child.attrs;
      if (MapTo !== undefined && Val !== undefined && Val.trim() !== MapTo.trim()) {
        into.set(Val.trim().toUpperCase(), MapTo);
      }
    }
    collectMapTo(child, into);
  }
}

/**
 * <Parm> 直下の値一覧（Values / SpcVal / SngVal）。Elem/Qual の中は含めない。
 * 制限の判定と選択肢の補完に使う。
 */
function parmValues(parm) {
  const values = [];
  for (const child of parm.children) {
    if (child.name === "Values" || child.name === "SpcVal" || child.name === "SngVal") {
      for (const value of childrenNamed(child, "Value")) {
        if (value.attrs.Val !== undefined) values.push(value.attrs.Val);
      }
    }
  }
  return values;
}

/** 定義 JSON の全パラメータ（group の子も含む）を辿る。 */
function eachParameter(parameters, visit) {
  for (const parameter of parameters) {
    visit(parameter);
    if (parameter.children) eachParameter(parameter.children, visit);
  }
}

/* ------------------------------------------------------------------ *
 * 本体
 * ------------------------------------------------------------------ */

if (!existsSync(CMDDEF)) {
  console.error(`${CMDDEF} が無い。docs/origin/collect-cmd-definitions.sh で収集する。`);
  process.exit(1);
}

const report = {
  commands: 0,
  dependencies: 0,
  promptControl: 0,
  mapTo: 0,
  unmatchedParm: new Set(),
  unmatchedValue: 0,
  unrestricted: 0,
  addedValues: 0,
  addedLength: 0,
  changedLength: 0,
  skippedLength: 0,
  mixedCase: 0,
  occurrences: 0,
  noVariable: 0,
  relations: 0,
  normalizedValues: 0,
  ranges: 0,
  numeric: 0,
  missingDefinition: []
};

for (const file of readdirSync(CMDDEF).filter(n => n.endsWith(".xml")).sort()) {
  const name = file.replace(/\.xml$/, "");
  const cmd = firstNamed(parseXml(readFileSync(join(CMDDEF, file), "utf8")), "QcdCLCmd");
  const cmdNode = cmd && firstNamed(cmd, "Cmd");
  if (!cmdNode) continue;

  const dependencies = childrenNamed(cmdNode, "Dep").map(toDependency);
  const parms = childrenNamed(cmdNode, "Parm");

  // PMTCTL は Parm 直下のものだけ（Elem/Qual の中のものは別物）。
  const promptControlByKwd = new Map();
  for (const parm of parms) {
    const groups = childrenNamed(parm, "PmtCtl").map(toPromptControl);
    if (groups.length > 0) promptControlByKwd.set(parm.attrs.Kwd, groups);
  }

  // 規則から参照されるパラメータ。ここにだけ MapTo を入れる。
  const referenced = new Set();
  for (const dep of dependencies) {
    if (dep.controlParameter) referenced.add(dep.controlParameter);
    if (dep.controlCompareParameter) referenced.add(dep.controlCompareParameter);
    for (const term of dep.terms) {
      referenced.add(term.parameter);
      if (term.compareParameter) referenced.add(term.compareParameter);
    }
  }
  for (const groups of promptControlByKwd.values()) {
    for (const group of groups) referenced.add(group.controlParameter);
  }

  const mapToByKwd = new Map();
  for (const parm of parms) {
    if (!referenced.has(parm.attrs.Kwd)) continue;
    const table = new Map();
    collectMapTo(parm, table);
    if (table.size > 0) mapToByKwd.set(parm.attrs.Kwd, table);
  }

  // 相関規則が無くても Rstd / Len は反映する。ここで飛ばすと属性が
  // 101 コマンドにしか入らない（実際に一度そうなっていた）。

  let wroteAny = false;
  for (const lang of LANGS) {
    const path = join(ROOT, `vscode-extension/resources/prompter/cl/${lang}/${name}.json`);
    if (!existsSync(path)) continue;

    const definition = JSON.parse(readFileSync(path, "utf8"));
    let changed = false;

    if (dependencies.length > 0) {
      definition.dependencies = dependencies;
      changed = true;
      if (lang === "ja") report.dependencies += dependencies.length;
    }

    for (const parameter of definition.parameters) {
      const groups = promptControlByKwd.get(parameter.name);
      if (groups) {
        // group に付けてよい。入力欄を持つ末端へ降ろすのは実装側の責任
        // （model.ts の flattenParameters）。AGENTS.md の規約に合わせる。
        parameter.promptControl = groups;
        changed = true;
        if (lang === "ja") report.promptControl += groups.length;
      }
    }

    // valueMap は規則が名指しするパラメータ（＝ CDML の Kwd）に持たせる。
    // 対象の 7 割強は options を持たない text 欄なので、options 側には置かない。
    for (const [kwd, table] of mapToByKwd) {
      const target = definition.parameters.find(p => p.name === kwd);
      if (!target) {
        if (lang === "ja") report.unmatchedParm.add(`${name}.${kwd}`);
        continue;
      }
      target.valueMap = Object.fromEntries([...table.entries()].sort());
      changed = true;
      if (lang === "ja") report.mapTo += table.size;
    }

    // --- 実機の属性を反映する（Rstd / Len） ---
    for (const parm of parms) {
      const target = definition.parameters.find(p => p.name === parm.attrs.Kwd);
      if (!target) continue;

      // 既に入っている値のノーブレークスペースも直す。補完は追加しかしないため、
      // 一度取り込んだ `&#160;` 入りの値はここで正規化しないと残る。
      for (const option of target.options ?? []) {
        if (typeof option.value === "string" && option.value.includes("\u00a0")) {
          option.value = option.value.replace(/\u00a0/g, " ");
          if (typeof option.label === "string") {
            option.label = option.label.replace(/\u00a0/g, " ");
          }
          changed = true;
          if (lang === "ja") report.normalizedValues += 1;
        }
      }

      // Rstd: 列挙した値以外を書けるか。options を持つ欄にだけ意味がある。
      if (parm.attrs.Rstd && target.options?.length) {
        const restricted = parm.attrs.Rstd === "YES";
        target.attributes = { ...(target.attributes ?? {}), restricted };
        changed = true;
        if (lang === "ja" && !restricted) report.unrestricted += 1;

        // Rstd=YES なら実機の値集合が正。原典が取りこぼした値を補う。
        if (restricted) {
          const known = new Set(
            target.options.map(o => String(o.value).trim().toUpperCase())
          );
          for (const value of parmValues(parm)) {
            if (!known.has(value.trim().toUpperCase())) {
              target.options.push({ label: value, value });
              known.add(value.trim().toUpperCase());
              changed = true;
              if (lang === "ja") report.addedValues += 1;
            }
          }
        }
      }

      // Case: MIXED は大文字小文字をそのまま渡す欄。英大文字を強制すると
      // IFS のパス（CRTBNDRPG の INCDIR など）に小文字が書けなくなる。
      if (parm.attrs.Case === "MIXED") {
        const charset = target.attributes?.characterSet;
        if (charset === "upper" || charset === "alpha" || charset === "alnum") {
          target.attributes = { ...(target.attributes ?? {}), characterSet: "any" };
          changed = true;
          if (lang === "ja") report.mixedCase += 1;
        }
      }

      // 繰り返し指定の上限。実機の Max が定義より多いと、入力欄を必要な数まで
      // 増やせない（CRTPGM の OPTION は実機 6 に対し定義 5 だった）。
      const maxValues = Number(parm.attrs.Max);
      if (Number.isFinite(maxValues) && maxValues > 1 && target.maxOccurrences !== maxValues) {
        target.maxOccurrences = maxValues;
        changed = true;
        if (lang === "ja") report.occurrences += 1;
      }

      // CL 変数を書けない欄。既定は「書ける」なので NO のときだけ記録する。
      if (parm.attrs.AlwVar === "NO") {
        target.attributes = { ...(target.attributes ?? {}), allowsVariable: false };
        changed = true;
        if (lang === "ja") report.noVariable += 1;
      }

      // 値そのものへの制約（0 以外・1 以上など）。範囲とは別に付く。
      if (parm.attrs.Rel && parm.attrs.RelVal !== undefined) {
        target.attributes = {
          ...(target.attributes ?? {}),
          valueRelation: { relation: parm.attrs.Rel, value: parm.attrs.RelVal }
        };
        changed = true;
        if (lang === "ja") report.relations += 1;
      }

      // 数値の範囲。実機が受ける下限・上限をそのまま使う。
      const rangeMin = Number(parm.attrs.RangeMinVal);
      const rangeMax = Number(parm.attrs.RangeMaxVal);
      if (Number.isFinite(rangeMin) && Number.isFinite(rangeMax)) {
        target.attributes = {
          ...(target.attributes ?? {}),
          minValue: rangeMin,
          maxValue: rangeMax
        };
        changed = true;
        if (lang === "ja") report.ranges += 1;
      }

      // 数値型。定義済み値(*SAME 等)は validate 側で対象外にしている。
      // ただし * で始まらない非数値の選択肢を持つ欄は、数値と限らないので外す。
      if (NUMERIC_TYPES.has(parm.attrs.Type) && !target.attributes?.numericOnly) {
        const hasNonNumericChoice = (target.options ?? []).some(option => {
          const value = String(option.value).trim();
          return !value.startsWith("*") && !/^[+-]?[0-9]+(?:\.[0-9]+)?$/u.test(value);
        });
        if (!hasNonNumericChoice) {
          target.attributes = { ...(target.attributes ?? {}), numericOnly: true };
          changed = true;
          if (lang === "ja") report.numeric += 1;
        }
      }

      // Len: 実機が受ける長さ。ただし MapTo を持つ欄の Len は**内部値の長さ**で、
      // そのまま入れると表示値が入力できなくなる（ADDMSGD の TYPE は Len=1 だが
      // 書くのは *CHAR）。既知の値より短い Len は採らない。
      // DEC の Len は「全体桁数.小数部桁数」（CRTPRTF の LPI は "3.1"）。
      // そのまま文字数にすると「3.1 文字以内」という誤った検査になる。
      // 符号と小数点の分を足して文字数に直す。
      const rawLen = String(parm.attrs.Len ?? "");
      const len = rawLen.includes(".")
        ? Number(rawLen.split(".")[0]) + 2
        : Number(rawLen);
      if (Number.isFinite(len) && len > 0) {
        const longest = Math.max(
          0,
          ...(target.options ?? []).map(o => String(o.value).trim().length),
          ...(target.singleValues ?? []).map(v => String(v).trim().length),
          String(target.defaultValue ?? "").trim().length
        );
        if (len >= longest) {
          const before = target.attributes?.maxLength;
          if (before !== len) {
            target.attributes = { ...(target.attributes ?? {}), maxLength: len };
            changed = true;
            if (lang === "ja") {
              if (before === undefined) report.addedLength += 1;
              else report.changedLength += 1;
            }
          }
        } else if (lang === "ja") {
          report.skippedLength += 1;
        }
      }
    }

    if (changed) {
      wroteAny = true;
      if (!DRY) writeFileSync(path, `${JSON.stringify(definition, null, 2)}\n`, "utf8");
    }
  }

  if (wroteAny) report.commands += 1;
  else report.missingDefinition.push(name);
}

console.log(`${DRY ? "[dry-run] " : ""}反映したコマンド ${report.commands} 件`);
console.log(`  dependencies  ${report.dependencies} 件`);
console.log(`  promptControl ${report.promptControl} 件`);
console.log(`  mapTo         ${report.mapTo} 件`);
console.log(`  restricted:false（任意の値を書ける欄）  ${report.unrestricted} 件`);
console.log(`  原典が取りこぼした選択肢の補完          ${report.addedValues} 件`);
console.log(`  繰り返し上限(Max)の修正                  ${report.occurrences} 件`);
console.log(`  CL 変数を書けない欄(AlwVar=NO)           ${report.noVariable} 件`);
console.log(`  値の制約(Rel/RelVal)                    ${report.relations} 件`);
console.log(`  ノーブレークスペースの正規化            ${report.normalizedValues} 件`);
console.log(`  英大文字強制をやめた欄(Case=MIXED)        ${report.mixedCase} 件`);
console.log(`  数値の範囲(RangeMinVal/RangeMaxVal)      ${report.ranges} 件`);
console.log(`  数値型(numericOnly)の補完                ${report.numeric} 件`);
console.log(`  maxLength 追加 ${report.addedLength} 件 / 変更 ${report.changedLength} 件 / 見送り ${report.skippedLength} 件`);
if (report.unmatchedParm.size > 0) {
  console.log(`  定義に無いパラメータ: ${[...report.unmatchedParm].join(", ")}`);
}
if (report.unmatchedValue > 0) {
  console.log(`  MapTo を置く options が無いパラメータ ${report.unmatchedValue} 件`);
}
if (report.missingDefinition.length > 0) {
  console.log(`  変更なし: ${report.missingDefinition.length} コマンド`);
}
