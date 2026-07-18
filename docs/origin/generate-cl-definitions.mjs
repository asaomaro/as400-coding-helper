#!/usr/bin/env node
/**
 * 原典HTML(docs/origin/cl/*.html) から CL プロンプター定義 JSON を決定的に生成する。
 *
 * 生成対象は「原典から機械的に決まるもの」に限る:
 *   パラメータ集合 / required / positional / defaultValue / options とその説明 /
 *   groupKind / 入れ子構造 / maxOccurrences / singleValues /
 *   examples / errorMessages / restrictions / environment / threadSafe / source
 *
 * 判断が要るもの（dependsOn の相関規則、placeholder、子パラメータの英名）は
 * 既存 JSON から引き継ぐ。原典に書かれていないため機械的には決められない。
 *
 * 使い方:
 *   node docs/origin/generate-cl-definitions.mjs [CMD ...]   # 省略時は全件
 *   node docs/origin/generate-cl-definitions.mjs --dry-run ADDLIBLE
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
// 言語ごとに原典と出力先を分ける。既定は日本語。
const langArg = process.argv.find(a => a.startsWith("--lang="));
const LANG = langArg ? langArg.slice("--lang=".length) : "ja";
const HTML_DIR = path.join(ROOT, `docs/origin/cl${LANG === "ja" ? "" : `-${LANG}`}`);
const JSON_DIR = path.join(ROOT, `vscode-extension/resources/prompter/cl/${LANG}`);

const SOURCE_VERSION = "IBM i 7.4";
const SOURCE_BASE = `https://www.ibm.com/docs/${LANG}/ssw_ibm_i_74/cl/`;

// ---------------------------------------------------------------- HTML utils

const stripTags = html =>
  decode(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function decode(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

const matchAll = (text, re) => [...String(text).matchAll(re)];

// ------------------------------------------------------- パラメータ表の解析

/**
 * parm_table2（パラメータ表）から、キーワードごとの構造を取り出す。
 * 継続行の「修飾子 N: ラベル」「要素 N: ラベル」が入れ子構造の唯一の手掛かり。
 */
function parseParameterTable(html) {
  // 日本語版は summary="Parameters" を持つが、英語版は summary が空で
  // 見出し（Keyword/キーワード）でしか判別できない。両方に対応する。
  const table =
    html.match(/<table[^>]*summary="Parameters"[^>]*>([\s\S]*?)<\/table>/i) ||
    [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].find(m =>
      /<th[^>]*>[\s\S]{0,120}?(Keyword|キーワード)[\s\S]{0,120}?<\/th>/i.test(m[1])
    );
  if (!table) return [];

  const params = [];
  let current = null;

  for (const [, row] of matchAll(table[1], /<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = matchAll(row, /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi).map(m => m[1]);
    if (cells.length === 0 || /<th/i.test(row)) continue;

    const keyword = cells[0].match(/<strong>\s*([A-Z0-9]+)\s*<\/strong>/i);
    if (keyword && cells.length >= 4) {
      const notes = stripTags(cells[3]);
      current = {
        name: keyword[1],
        description: stripTags(cells[1]),
        choicesHtml: cells[2],
        required: /必須|Required/i.test(notes),
        positional:
          Number(notes.match(/定位置\s*(\d+)/)?.[1] ?? notes.match(/Positional\s*(\d+)/i)?.[1]) ||
          undefined,
        parts: []
      };
      params.push(current);
      continue;
    }

    if (!current || cells.length < 2) continue;
    const label = stripTags(cells[0]);
    const part = label.match(/^(修飾子|要素|Qualifier|Element)\s*(\d+)\s*[:：]\s*(.*)$/i);
    if (part) {
      current.parts.push({
        kind: /修飾子|Qualifier/i.test(part[1]) ? "qualifier" : "element",
        index: Number(part[2]),
        label: part[3].trim(),
        choicesHtml: cells[1]
      });
    }
  }

  return params;
}

/** 選択項目セルから、省略時値・定義済み値・単一値・繰り返し回数を読む。 */
function readChoices(choicesHtml) {
  const text = stripTags(choicesHtml);
  // 省略時値は下線で示される。日本語版は <strong class="underlined">、
  // 英語版は <strong><u>…</u></strong>。どちらも拾う。
  const defaults = [
    ...matchAll(choicesHtml, /<strong class="underlined">\s*([^<]+?)\s*<\/strong>/gi),
    ...matchAll(choicesHtml, /<u>\s*([^<]+?)\s*<\/u>/gi)
  ].map(m => stripTags(m[1])).filter(Boolean);

  const singleValuesRaw = text.match(/(?:単一値|Single values)\s*[:：]\s*([^]*?)(?=その他の値|Other values|$)/i);
  const singleValues = singleValuesRaw
    ? [...new Set(matchAll(singleValuesRaw[1], /\*[A-Z0-9]+/g).map(m => m[0]))]
    : [];

  const repeat =
    Number(
      text.match(/最大\s*(\d+)\s*回の繰り返し/)?.[1] ??
        text.match(/up to\s*(\d+)\s*repetitions/i)?.[1]
    ) || undefined;
  // 単独の "*"（DSPFD OUTPUT の既定値など）も定義済み値。`\*[A-Z0-9]+` だけでは拾えない。
  const specials = [...new Set(matchAll(text, /\*[A-Z0-9]*/g).map(m => m[0]))]
    .filter(v => v === "*" || v.length > 1);
  const range = text.match(/(\d+)\s*-\s*(\d+)/);

  return {
    text,
    defaultValue: defaults[0],
    singleValues,
    repeat,
    specials,
    isName: /名前|\bName\b/i.test(text),
    isInteger: /整数|\bInteger\b/i.test(text) || Boolean(range),
    isCharacter: /文字値|Character value/i.test(text)
  };
}

// --------------------------------------------- パラメータ節（説明・定義済み値）

/**
 * 各パラメータの説明節を解析する。
 * <h3> が「単一値 / 要素 N / 修飾子 N」の区切りになっており、
 * 直後の <dt>/<dd> がその区画の定義済み値と説明になる。
 */
function parseParameterSections(html, command) {
  const sections = new Map();
  // パラメータ節だけでなく COMMAND.EXAMPLES / ERROR.MESSAGES / Top_Of_Page も
  // 区切りとして扱う。終端を取り違えると例やエラー文が help に混入する。
  // パラメータ節のアンカーは版・言語で形式が違う。
  //   日本語版: <a name="CHGDTAARA.DTAARA"></a>
  //   英語版  : <div id="chgdtaara__dtaara"> / <h3 id="...">
  // 片方しか見ないと節が取れず、定義済み値の説明が丸ごと落ちる
  // （英語版で *GDA/*PDA が拾えず CI が落ちて発覚した）。
  const lower = command.toLowerCase();
  const anchors = [
    ...matchAll(html, new RegExp(`<a name="${command}\\.([A-Za-z0-9_.]+)"`, "g")),
    ...matchAll(html, new RegExp(`id="${lower}__([a-z0-9_]+)"`, "g"))
  ]
    .map(m => Object.assign([m[0], m[1].toUpperCase()], { index: m.index }))
    .sort((a, b) => a.index - b.index);
  const isParameter = name => /^[A-Z0-9]+$/.test(name);

  anchors.forEach((anchor, i) => {
    if (!isParameter(anchor[1])) return;
    const start = anchor.index;
    const end = i + 1 < anchors.length ? anchors[i + 1].index : html.length;
    const body = html.slice(start, end);

    // 見出し・注記を除いた本文（最初の数段落）を説明にする。
    const paragraphs = matchAll(body, /<p>([\s\S]*?)<\/p>/gi)
      .map(m => stripTags(m[1]))
      .filter(text => text.length > 0 && !/^注\s*[:：]/.test(text));

    // <h3> で区画に割り、区画ごとに dt/dd を集める。
    const blocks = [];
    const headings = matchAll(body, /<h3>([\s\S]*?)<\/h3>/gi);
    const pushBlock = (label, from, to) => {
      const chunk = body.slice(from, to);
      const values = [];
      for (const [, dt, dd] of matchAll(
        chunk,
        /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi
      )) {
        values.push({ value: stripTags(dt), help: stripTags(dd) });
      }
      blocks.push({ label, values });
    };

    if (headings.length === 0) {
      pushBlock(null, 0, body.length);
    } else {
      pushBlock(null, 0, headings[0].index);
      headings.forEach((heading, hi) => {
        const to = hi + 1 < headings.length ? headings[hi + 1].index : body.length;
        pushBlock(stripTags(heading[1]), heading.index, to);
      });
    }

    sections.set(anchor[1], { paragraphs, blocks });
  });

  return sections;
}

/** 「要素 1: ...」等の見出しに対応する区画の定義済み値を返す。 */
function valuesForPart(section, part) {
  if (!section) return [];
  const kind = part.kind === "qualifier" ? "修飾子" : "要素";
  const block = section.blocks.find(
    b => b.label && new RegExp(`^${kind}\\s*${part.index}\\s*[:：]`).test(b.label)
  );
  return block ? block.values : [];
}

/** 単一値／見出し無し区画の定義済み値（パラメータ本体に属するもの）。 */
function valuesForParameter(section) {
  if (!section) return [];
  return section.blocks
    .filter(b => !b.label || /^単一値/.test(b.label))
    .flatMap(b => b.values);
}

// ------------------------------------------------------------ コマンドメタ情報

/**
 * 制約事項の節を取り出す。原典は
 *   <h2><strong>制約事項</strong><strong>:</strong></h2><ul><li>…</li></ul>
 * の形。入れ子リストを含むため、ul/ol の深さを見て終端を決める。
 */
function parseRestrictions(html) {
  const heading = html.match(/<h2>(?:(?!<\/h2>)[\s\S])*?(?:制約事項|Restrictions?)[\s\S]*?<\/h2>/i);
  if (!heading) return [];

  const after = html.slice(heading.index + heading[0].length);
  const listStart = after.search(/<(?:ul|ol)\b/i);
  if (listStart === -1) return [];

  // 開始タグから、対応する閉じタグまでを深さを数えて切り出す。
  let depth = 0;
  let end = -1;
  for (const token of after.slice(listStart).matchAll(/<(\/?)(?:ul|ol)\b[^>]*>/gi)) {
    depth += token[1] ? -1 : 1;
    if (depth === 0) {
      end = listStart + token.index + token[0].length;
      break;
    }
  }
  if (end === -1) return [];

  const block = after.slice(listStart, end);

  // 最上位の <li> だけを拾う（入れ子の項目は親の本文に含める）。
  const items = [];
  let liDepth = 0;
  let start = -1;
  for (const token of block.matchAll(/<(\/?)li\b[^>]*>/gi)) {
    if (!token[1]) {
      if (liDepth === 0) start = token.index + token[0].length;
      liDepth += 1;
    } else {
      liDepth -= 1;
      if (liDepth === 0 && start !== -1) {
        const text = stripTags(block.slice(start, token.index));
        if (text) items.push(text);
        start = -1;
      }
    }
  }

  return items;
}

/**
 * 使用例の複数行を1本のコマンドに連結する。
 * CL の継続文字 `+` は「次行先頭の空白を無視して空白1個で連結」、
 * `-` は「先頭空白を保持して連結」。
 */
function joinExampleLines(code) {
  const lines = code.split(/\r?\n/);
  let result = "";
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    const trimmed = text.trimEnd();
    const marker = trimmed.slice(-1);
    if (i < lines.length - 1 && (marker === "+" || marker === "-")) {
      result += marker === "+" ? `${trimmed.slice(0, -1).trim()} ` : trimmed.slice(0, -1);
      continue;
    }
    result += `${trimmed.trim()} `;
  }
  return result.replace(/\s+/g, " ").trim();
}

/**
 * 実行可能な形の使用例か。原典の例には
 *   IF &TESTSW DO GROUP A （CLコマンドのグループ） …
 * のような説明を交えた擬似コードも含まれるため、それらは除く。
 * 判定: 括弧が釣り合っていること、日本語（全角）を含まないこと。
 */
function isRunnableExample(code) {
  if (code.length === 0) return false;
  if (/[^\x00-\x7F]/u.test(code)) return false;
  // 原典は「PGM : ENDPGM」のように、単独の `:` を省略記号として使った
  // 擬似コードを例に混ぜている。そのまま取り込むと `PGM PARM(:)` のような
  // 不正なコマンドを生成する（実機が「Label ':' not valid.」で弾いて発覚）。
  if (/(^|\s):(\s|$)/u.test(code)) return false;
  let depth = 0;
  for (const char of code) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function parseCommandMeta(html, command) {
  const plain = stripTags(html);

  const title =
    html
      .match(/<title>\s*([^<]*?)\s*(?:-\s*IBM Documentation)?\s*<\/title>/i)?.[1]
      ?.replace(/\s+/g, " ")
      .trim() ?? command;

  const intro = html.match(
    new RegExp(`<a name="${command}"></a>([\\s\\S]*?)(?=<div class="tablenoborder")`, "i")
  );
  const introParagraphs = intro
    ? matchAll(intro[1], /<p>([\s\S]*?)<\/p>/gi).map(m => stripTags(m[1])).filter(Boolean)
    : [];

  const restrictions = parseRestrictions(html);
  const help = introParagraphs
    .filter(text => !/制約事項|^Restrictions?:/i.test(text))
    .join("\n\n");

  const examples = matchAll(html, /<pre[^>]*>([\s\S]*?)<\/pre>/gi)
    .map(m => decode(m[1].replace(/<[^>]+>/g, "")).trim())
    .filter(code => new RegExp(`^${command}\\b`).test(code))
    // 複数行の例を1行目だけ切り出すと、継続文字 `+` で終わる壊れた例になる
    // （実機が「A matching parenthesis not found.」で弾いて発覚した）。
    // 継続行は連結して1本のコマンドとして保持する。
    .map(code => ({ code: joinExampleLines(code) }))
    .filter(example => isRunnableExample(example.code));

  const errorMessages = [];
  for (const [, id, text] of matchAll(
    html,
    /<dt>\s*(?:<[^>]+>\s*)*([A-Z]{3}[0-9A-F]{4})\s*(?:<\/[^>]+>\s*)*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi
  )) {
    errorMessages.push({ id, text: stripTags(text) });
  }

  return {
    description: title,
    help,
    restrictions,
    environment: plain.match(/実行可能場所\s*[:：]\s*([^。\n]+?)\s*(?:スレッド|$)/)?.[1]?.trim(),
    threadSafe: /スレッド・セーフ\s*[:：]\s*はい/.test(plain)
      ? true
      : /スレッド・セーフ\s*[:：]\s*いいえ/.test(plain)
        ? false
        : undefined,
    examples,
    errorMessages,
    source: {
      url: `${SOURCE_BASE}${command.toLowerCase()}.htm`,
      version: SOURCE_VERSION,
      updated: plain.match(/最終更新\s*[:：]\s*([\d-]+)/)?.[1]
    }
  };
}

// ------------------------------------------------------------ 型・選択肢の決定

function buildAttributes(choices) {
  // *CLS のような特殊値も受け付ける数値項目は numericOnly にできない。
  if (choices.isInteger) {
    return choices.specials.length > 0 ? { characterSet: "upper" } : { numericOnly: true };
  }
  if (choices.isName) return { characterSet: "upper", maxLength: 10 };
  if (choices.specials.length > 0) return { characterSet: "upper" };
  return undefined;
}

function buildOptions(choices, values) {
  // 定義済み値のみで構成される場合だけ dropdown にする。
  // 名前や文字値を受け付けるパラメータは自由入力（説明は help に載せる）。
  if (choices.isName || choices.isInteger || choices.isCharacter) return undefined;
  if (choices.specials.length === 0) return undefined;

  const helpByValue = new Map(values.map(v => [v.value, v.help]));
  return choices.specials.map(value => ({
    label: value,
    value,
    ...(helpByValue.get(value) ? { help: helpByValue.get(value) } : {})
  }));
}

function leafParameter(name, description, help, choices, values, extra = {}) {
  const options = buildOptions(choices, values);
  const attributes = buildAttributes(choices);
  const described = values.filter(v => v.help && !options?.some(o => o.value === v.value));

  // 名前や数値を受け付けるため dropdown にできない項目でも、
  // 指定できる特殊値（*LIBL/*USRLIBL 等）は help に明記する。
  const undocumented =
    options === undefined
      ? choices.specials.filter(value => !described.some(v => v.value === value))
      : [];

  return prune({
    name,
    description,
    help: [
      help,
      described
        // 「名前」「整数」などの型を表す見出しは値ではないため、そのまま本文にする。
        .map(v => (/^[*A-Z0-9]+$/.test(v.value) ? `${v.value}: ${v.help}` : v.help))
        .join("\n"),
      undocumented.length > 0 ? `指定できる特殊値: ${undocumented.join(", ")}` : undefined
    ]
      .filter(Boolean)
      .join("\n\n") || undefined,
    inputType: options
      ? "dropdown"
      : choices.isInteger && choices.specials.length === 0
        ? "number"
        : "text",
    required: false,
    defaultValue: choices.defaultValue,
    attributes,
    options,
    ...extra
  });
}

/** undefined / 空配列のキーを落とす（JSON を読みやすく保つ）。 */
function prune(object) {
  const result = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    result[key] = value;
  }
  return result;
}

// ------------------------------------------------------------ 構造の組み立て

/**
 * 表の「修飾子/要素」並びから、入れ子を含むパラメータ定義を組み立てる。
 *
 * 修飾子は出力順（ライブラリーが先）に並べ替える。原典は
 * 「修飾子1: オブジェクト / 修飾子2: ライブラリー」の順だが、
 * CL の構文は LIB/OBJ であり並びが逆になる。
 */
function buildParameter(param, section) {
  const choices = readChoices(param.choicesHtml);
  const help = section?.paragraphs.join("\n\n") || undefined;
  const base = {
    positional: param.positional,
    ...(choices.repeat ? { maxOccurrences: choices.repeat } : {})
  };

  if (param.parts.length === 0) {
    return {
      ...leafParameter(
        param.name,
        param.description,
        help,
        choices,
        valuesForParameter(section),
        base
      ),
      required: param.required
    };
  }

  // 要素の下にぶら下がる修飾子をまとめる（要素が無ければ修飾名パラメータそのもの）。
  const groups = [];
  for (const part of param.parts) {
    if (part.kind === "element") {
      groups.push({ element: part, qualifiers: [] });
    } else if (groups.length > 0) {
      groups[groups.length - 1].qualifiers.push(part);
    } else {
      groups.push({ element: null, qualifiers: [part] });
    }
  }

  const toChild = (part, name) =>
    leafParameter(
      name,
      part.label,
      undefined,
      readChoices(part.choicesHtml),
      valuesForPart(section, part)
    );

  // 修飾子の名前は原典のラベルと位置から決定的に決める。
  // 位置で既存名を移すと、出力順への並べ替えで名前と中身がねじれるため使わない
  // （CHGPF.SRCFILE で実際に踏んだ）。JOB(番号/ユーザー/名前) のように
  // 修飾子が3つある場合もあるため、一意性を保つ必要がある。
  const qualifierName = part => {
    if (/ライブラリー|Library/i.test(part.label)) return "LIB";
    return part.index === 1 ? param.name : `${param.name}_Q${part.index}`;
  };

  const children = groups.map(group => {
    const qualifiers = group.qualifiers.map(q => toChild(q, qualifierName(q)));

    if (group.element && qualifiers.length > 0) {
      // 要素そのものにも単一値がある（例: CHGDTAARA の要素1は
      // 「単一値: *LDA, *GDA, *PDA ／ その他の値: 修飾オブジェクト名」）。
      // ここを読まないと、その要素の定義済み値が丸ごと落ちる。
      const elementChoices = readChoices(group.element.choicesHtml);
      const ordered = qualifiers.reverse(); // 修飾子は出力順（ライブラリーが先）
      const primary = ordered[ordered.length - 1];

      if (primary && elementChoices.specials.length > 0) {
        const helpByValue = new Map(
          valuesForPart(section, group.element).map(v => [v.value, v.help])
        );
        if (primary.options) {
          primary.options = [
            ...elementChoices.specials.map(value =>
              prune({ label: value, value, help: helpByValue.get(value) })
            ),
            ...primary.options
          ];
        } else {
          primary.help = [primary.help, `指定できる特殊値: ${elementChoices.specials.join(", ")}`]
            .filter(Boolean)
            .join("\n\n");
        }
      }

      return prune({
        name: `${param.name}_E${group.element.index}`,
        description: group.element.label,
        inputType: "group",
        required: false,
        groupKind: "qualified",
        singleValues: elementChoices.singleValues,
        children: ordered
      });
    }

    if (group.element) {
      // 要素の英名は原典に無い。合成名を置き、既存 JSON があれば後で引き継ぐ。
      return toChild(group.element, `${param.name}_E${group.element.index}`);
    }

    return qualifiers.reverse();
  });

  const flatChildren = children.flat();
  const onlyQualifiers = groups.every(g => !g.element);

  // 単一値・省略時値はパラメータ本体に属する値だが、入力欄は末端にしかない。
  // 実際に入力される欄へ落とす:
  //   qualified … 修飾されるオブジェクト側（出力順の最後。*SAME 等はここに入る）
  //   elements  … 要素1
  const primary = onlyQualifiers ? flatChildren[flatChildren.length - 1] : flatChildren[0];
  if (primary && !Array.isArray(primary)) {
    if (choices.singleValues.length > 0 && primary.options) {
      const helpByValue = new Map(valuesForParameter(section).map(v => [v.value, v.help]));
      primary.options = [
        ...choices.singleValues.map(value =>
          prune({ label: value, value, help: helpByValue.get(value) })
        ),
        ...primary.options
      ];
    }
    // パラメータ本体の省略時値（単一値側）は、要素/修飾子固有の既定より優先する。
    // 例: OPNQRYF OPTIMIZE は要素1が *FIRSTIO だが、コマンドの既定は *ALLIO。
    if (choices.defaultValue) {
      primary.defaultValue = choices.defaultValue;
    }
  }

  // group 自体の required は検証されない（model.ts は末端の入力欄だけを検証する）。
  // 必須パラメータは、実際に入力が要る末端へ落とす。
  //   qualified … 修飾されるオブジェクト名（出力順の最後。ライブラリーは省略可）
  //   elements  … 要素1
  if (param.required && flatChildren.length > 0) {
    const primary = onlyQualifiers ? flatChildren[flatChildren.length - 1] : flatChildren[0];
    const target =
      primary.inputType === "group" && primary.children?.length
        ? primary.children[primary.children.length - 1]
        : primary;
    target.required = true;
  }

  return prune({
    name: param.name,
    description: param.description,
    help,
    inputType: "group",
    required: param.required,
    groupKind: onlyQualifiers ? "qualified" : "elements",
    singleValues: choices.singleValues,
    children: flatChildren,
    ...base
  });
}

// ------------------------------- 既存 JSON からの引き継ぎ（判断が要る部分のみ）

function collectLeaves(parameters, out = []) {
  for (const parameter of parameters) {
    if (parameter.inputType === "group" && parameter.children?.length) {
      collectLeaves(parameter.children, out);
    } else {
      out.push(parameter);
    }
  }
  return out;
}

/**
 * 子パラメータの英名・placeholder・dependsOn は原典に書かれていないため、
 * 既存 JSON から引き継ぐ。末端の数が一致する場合のみ位置対応で移す。
 */
function carryOver(generated, existing) {
  if (!existing || !Array.isArray(generated.parameters)) return generated;

  const byName = new Map(existing.parameters.map(p => [p.name, p]));

  for (const parameter of generated.parameters) {
    const old = byName.get(parameter.name);
    if (!old) continue;

    const newLeaves = collectLeaves([parameter]);
    const oldLeaves = collectLeaves([old]);
    if (newLeaves.length === oldLeaves.length) {
      newLeaves.forEach((leaf, i) => {
        const source = oldLeaves[i];
        // 名前を移すのは合成した要素名だけ。修飾子名は原典ラベルから確定しており、
        // 位置対応で上書きすると名前と中身がねじれる（実際に踏んだ）。
        if (source.name && /_E\d+$/.test(leaf.name)) leaf.name = source.name;
        if (source.placeholder) leaf.placeholder = source.placeholder;
        if (source.dependsOn) leaf.dependsOn = source.dependsOn;
      });
    }
    if (old.dependsOn) parameter.dependsOn = old.dependsOn;
    if (old.placeholder) parameter.placeholder = old.placeholder;
    // basic は実機の F4/F10 実測由来で原典からは決まらないため引き継ぐ。
    if (old.basic) parameter.basic = old.basic;
  }

  if (existing.constraints) generated.constraints = existing.constraints;
  return generated;
}

// ------------------------------------------------------------------ 生成本体

/**
 * 入力欄の名前をコマンド内で一意にする。
 * 名前はフォームのキーであり、重複すると複数の欄が同じ値を共有してしまう
 * （CHGJOB の OUTQ/JOBQ/SRTSEQ が全て LIB を名乗り、実際に衝突していた）。
 */
function deduplicateLeafNames(parameters) {
  // パラメータ名は CL のキーワードそのものなので先に予約し、改名の対象にしない。
  const used = new Set(parameters.map(parameter => parameter.name));

  for (const parameter of parameters) {
    // 1つのパラメータに修飾名が2つ入ることがある（CRTPRTF.FNTCHRSET は
    // 文字セットとコード・ページの2組）。正規名を名乗れるのは最初の1つだけ。
    let canonicalTaken = false;

    for (const leaf of collectLeaves([parameter])) {
      if (leaf.name === parameter.name && !canonicalTaken) {
        canonicalTaken = true;
        used.add(leaf.name);
        continue;
      }

      if (leaf.name !== parameter.name && !used.has(leaf.name)) {
        used.add(leaf.name);
        continue;
      }

      let candidate = `${parameter.name}_${leaf.name}`;
      let suffix = 2;
      while (used.has(candidate)) {
        candidate = `${parameter.name}_${leaf.name}${suffix}`;
        suffix += 1;
      }
      leaf.name = candidate;
      used.add(candidate);
    }
  }

  return parameters;
}

function generate(command) {
  const html = fs.readFileSync(path.join(HTML_DIR, `${command}.html`), "utf8");
  const meta = parseCommandMeta(html, command);
  const table = parseParameterTable(html);
  const sections = parseParameterSections(html, command);

  const definition = prune({
    keyword: command,
    description: meta.description,
    help: meta.help || undefined,
    parameters: table.map(param => buildParameter(param, sections.get(param.name))),
    threadSafe: meta.threadSafe,
    environment: meta.environment,
    restrictions: meta.restrictions,
    examples: meta.examples,
    errorMessages: meta.errorMessages,
    source: prune(meta.source)
  });

  const jsonPath = path.join(JSON_DIR, `${command}.json`);

  // 引き継ぎ元。入力欄の名前・dependsOn・constraints・basic は表示言語に
  // よらない内部情報なので、日本語版を基準にして全言語で揃える。
  // （言語ごとに合成名が変わると、同じコマンドなのに欄の名前が食い違う）
  const baseDir =
    LANG === "ja" ? JSON_DIR : path.join(ROOT, "vscode-extension/resources/prompter/cl/ja");
  const basePath = path.join(baseDir, `${command}.json`);
  const existing = fs.existsSync(basePath)
    ? JSON.parse(fs.readFileSync(basePath, "utf8"))
    : fs.existsSync(jsonPath)
      ? JSON.parse(fs.readFileSync(jsonPath, "utf8"))
      : undefined;

  const result = carryOver(definition, existing);
  if (Array.isArray(result.parameters)) {
    deduplicateLeafNames(result.parameters);
  }

  return { definition: result, jsonPath };
}

// ------------------------------------------------------------------------ CLI

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const targets = args.filter(a => !a.startsWith("--"));

// 対象は原典 HTML があるもの全て（出力先が空でも生成できるようにする）。
const commands =
  targets.length > 0
    ? targets
    : fs
        .readdirSync(HTML_DIR)
        .filter(f => f.endsWith(".html"))
        .map(f => f.slice(0, -5))
        .sort();

fs.mkdirSync(JSON_DIR, { recursive: true });

let written = 0;
const skipped = [];

for (const command of commands) {
  const { definition, jsonPath } = generate(command);

  // 無パラメータのコマンド（DO/SELECT 等）は入力欄が無いので parameters は
  // 既存のまま残すが、原典由来のメタ情報（説明・制約事項・例など）は反映する。
  if (!definition.parameters?.length) {
    const existing = fs.existsSync(jsonPath)
      ? JSON.parse(fs.readFileSync(jsonPath, "utf8"))
      : { keyword: command, parameters: [] };
    const merged = { ...existing, ...definition, parameters: existing.parameters ?? [] };

    if (!dryRun) {
      fs.writeFileSync(jsonPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
      written += 1;
    }
    skipped.push(`${command}: 原典どおり無パラメータ（メタ情報のみ反映）`);
    continue;
  }

  if (dryRun) {
    console.log(JSON.stringify(definition, null, 2));
    continue;
  }

  fs.writeFileSync(jsonPath, `${JSON.stringify(definition, null, 2)}\n`, "utf8");
  written += 1;
}

if (!dryRun) {
  console.log(`生成: ${written} 件 / スキップ: ${skipped.length} 件`);
  skipped.forEach(line => console.log(`  - ${line}`));
}
