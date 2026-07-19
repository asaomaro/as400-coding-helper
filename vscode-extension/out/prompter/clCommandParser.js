"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isContinuedLine = isContinuedLine;
exports.joinContinuationLines = joinContinuationLines;
exports.extractComments = extractComments;
exports.splitTopLevel = splitTopLevel;
exports.parseClCommand = parseClCommand;
exports.assignParameterValue = assignParameterValue;
exports.mapParsedCommandToValues = mapParsedCommandToValues;
const occurrences_1 = require("./occurrences");
/**
 * 継続行を1本の論理コマンドに連結する。
 *
 * CL の継続文字:
 *   `+` … 次行の先頭の空白を無視し、空白1個を補って連結する
 *   `-` … 次行の先頭の空白を保持したまま連結する（リテラル内の継続に使う）
 * どちらも引用符の内側にある場合は継続文字ではない。
 */
/**
 * その行が次の行へ続くか（CL の継続記号）。
 * `+` は次行先頭の空白を詰め、`-` はそのまま繋ぐ。どちらも継続である。
 * 引用符の中の記号は継続ではないので除く。
 */
function isContinuedLine(text) {
    const trimmed = stripComments(text).trimEnd();
    const marker = trimmed.slice(-1);
    return ((marker === "+" || marker === "-") && !isInsideQuotes(trimmed.slice(0, -1)));
}
function joinContinuationLines(lines) {
    let result = "";
    for (let index = 0; index < lines.length; index += 1) {
        let text = stripComments(lines[index] ?? "");
        const isLast = index === lines.length - 1;
        if (!isLast) {
            const trimmed = text.trimEnd();
            const marker = trimmed.slice(-1);
            if ((marker === "+" || marker === "-") && !isInsideQuotes(trimmed.slice(0, -1))) {
                text = trimmed.slice(0, -1);
                result += marker === "+" ? `${text} ` : text;
                // `-` は次行の先頭空白を保持するため、ここでは何も削らない。
                continue;
            }
        }
        result += `${text} `;
    }
    return result.trim();
}
/** コメント `/*` の直前として妥当な文字か（行頭・空白・開き括弧）。 */
function isCommentBoundary(previous) {
    return previous === undefined || /[\s(]/u.test(previous);
}
/** `/* ... *​/` のコメントを取り除く（引用符の内側は対象外）。 */
function stripComments(line) {
    let result = "";
    let quote;
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const next = line[i + 1];
        if (quote) {
            result += char;
            if (char === quote) {
                quote = undefined;
            }
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            result += char;
            continue;
        }
        // コメント開始とみなすのは `/*` の直前が区切り（行頭か空白か開き括弧）のときだけ。
        // 修飾名の総称指定 `OBJ(MYLIB/*ALL)` にも `/*` が現れるため、無条件に
        // コメント開始と扱うとコマンドが途中で切れる。
        // 実機(IBM i)で `DSPOBJD OBJ(MYLIB/*ALL)` が受理され、
        // `... OBJTYPE(*FILE) /* コメント */` もコメントとして受理されることを確認済み。
        if (char === "/" && next === "*" && isCommentBoundary(line[i - 1])) {
            const close = line.indexOf("*/", i + 2);
            if (close === -1) {
                return result;
            }
            i = close + 1;
            continue;
        }
        result += char;
    }
    return result;
}
/**
 * 論理コマンドに含まれるコメント `/* ... *​/` を順に取り出す。
 * プロンプターで確定しても利用者が書いたコメントを失わないために使う。
 */
function extractComments(lines) {
    const comments = [];
    for (const line of lines) {
        let quote;
        for (let i = 0; i < line.length; i += 1) {
            const char = line[i];
            if (quote) {
                if (char === quote)
                    quote = undefined;
                continue;
            }
            if (char === "'" || char === '"') {
                quote = char;
                continue;
            }
            // 取り除く側と同じ規則で判定する（片方だけ直すと食い違う）。
            if (char === "/" && line[i + 1] === "*" && isCommentBoundary(line[i - 1])) {
                const close = line.indexOf("*/", i + 2);
                const body = (close === -1 ? line.slice(i + 2) : line.slice(i + 2, close)).trim();
                if (body.length > 0)
                    comments.push(body);
                if (close === -1)
                    break;
                i = close + 1;
            }
        }
    }
    return comments;
}
function isInsideQuotes(text) {
    let quote;
    for (const char of text) {
        if (quote) {
            if (char === quote)
                quote = undefined;
        }
        else if (char === "'" || char === '"') {
            quote = char;
        }
    }
    return quote !== undefined;
}
/**
 * 引用符と括弧の入れ子を尊重して、最上位のトークンに分割する。
 * `separator` を省略すると空白区切り。`/` を渡すと修飾名の分割になる。
 */
function splitTopLevel(text, separator) {
    const tokens = [];
    let current = "";
    let depth = 0;
    let quote;
    const flush = () => {
        if (current.trim().length > 0)
            tokens.push(current.trim());
        current = "";
    };
    for (const char of text) {
        if (quote) {
            current += char;
            if (char === quote)
                quote = undefined;
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            current += char;
            continue;
        }
        if (char === "(")
            depth += 1;
        if (char === ")")
            depth = Math.max(0, depth - 1);
        const isSeparator = separator ? char === separator : /\s/u.test(char);
        if (depth === 0 && isSeparator) {
            flush();
            continue;
        }
        current += char;
    }
    flush();
    return tokens;
}
/** 論理コマンド1本を解析する。コマンド名が取れなければ undefined。 */
function parseClCommand(text) {
    const tokens = splitTopLevel(text);
    if (tokens.length === 0)
        return undefined;
    let index = 0;
    let label;
    // ラベルは `NAME:` の形でコマンドの前に置かれる。
    const first = tokens[0] ?? "";
    if (first.endsWith(":")) {
        label = first.slice(0, -1);
        index += 1;
    }
    else if (first.includes(":")) {
        const [labelPart, rest] = first.split(/:(.*)/su);
        label = labelPart;
        tokens[0] = rest ?? "";
        if (tokens[0].length === 0)
            index += 1;
    }
    const keyword = tokens[index];
    if (!keyword)
        return undefined;
    index += 1;
    const parameters = {};
    const positional = [];
    for (; index < tokens.length; index += 1) {
        const token = tokens[index] ?? "";
        const match = /^([A-Za-z][A-Za-z0-9]*)\(([\s\S]*)\)$/u.exec(token);
        if (match) {
            parameters[match[1].toUpperCase()] = match[2];
        }
        else {
            positional.push(token);
        }
    }
    return { label, keyword: keyword.toUpperCase(), parameters, positional };
}
/** 括弧で1重に包まれていれば外す（繰り返し指定の `OBJ((...))` 用）。 */
function unwrapOuterParens(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith("(") || !trimmed.endsWith(")"))
        return trimmed;
    // 先頭の "(" が末尾の ")" と対応している場合のみ外す。
    let depth = 0;
    for (let i = 0; i < trimmed.length; i += 1) {
        if (trimmed[i] === "(")
            depth += 1;
        if (trimmed[i] === ")") {
            depth -= 1;
            if (depth === 0)
                return i === trimmed.length - 1 ? trimmed.slice(1, -1).trim() : trimmed;
        }
    }
    return trimmed;
}
const leafOf = (parameter) => parameter.inputType !== "group" || !parameter.children?.length;
/** group の「主」となる入力欄。単一値はここに入る（生成側と同じ規則）。 */
/**
 * 単一値（*SAME 等）を入れる欄を返す。
 *
 * 入れ子の末端まで降りること。要素リストの要素がさらに修飾名になっている場合
 * （CHGPRTF の USRDFNOBJ）、途中の group に値を入れても、group は入力欄を持たない
 * ため書き戻しで拾われず、値が黙って消える。
 *
 * 修飾名は最後の子（LIB が先、オブジェクトが後）、要素リストは最初の子が主。
 */
function primaryChild(parameter) {
    let current = parameter;
    while (current && !leafOf(current)) {
        const children = current.children ?? [];
        if (children.length === 0)
            return undefined;
        current =
            (current.groupKind ?? "qualified") === "qualified"
                ? children[children.length - 1]
                : children[0];
    }
    return current;
}
/**
 * パラメータの生テキストを、入力欄ごとの値に割り当てる。
 * applyChanges.ts の buildParameterBody の逆変換。
 */
function assignParameterValue(parameter, raw, values, 
// 繰り返し指定の何件目か（0 始まり）。入れ子の末端まで引き継ぐ。
occurrence = 0) {
    const text = raw.trim();
    if (leafOf(parameter)) {
        values[(0, occurrences_1.occurrenceName)(parameter.name, occurrence)] = text;
        return;
    }
    // 単一値（*FIRST 等）は主の欄に入れ、他の欄は使わない。
    const singleValues = parameter.singleValues ?? [];
    if (singleValues.some(value => value.toUpperCase() === text.toUpperCase())) {
        const primary = primaryChild(parameter);
        if (primary)
            values[(0, occurrences_1.occurrenceName)(primary.name, occurrence)] = text;
        return;
    }
    // 繰り返し指定は各出現が括弧で包まれる: OBJ((A ...) (B ...))
    if ((0, occurrences_1.isRepeatableGroup)(parameter)) {
        const occurrences = splitTopLevel(text);
        const limit = Math.min(occurrences.length, parameter.maxOccurrences ?? 1);
        for (let index = 0; index < limit; index += 1) {
            assignGroupBody(parameter, unwrapOuterParens(occurrences[index] ?? ""), values, index);
        }
        return;
    }
    assignGroupBody(parameter, text, values, occurrence);
}
/** group 1件分（括弧を剥がした中身）を子の入力欄へ割り当てる。 */
function assignGroupBody(parameter, body, values, occurrence) {
    const children = parameter.children ?? [];
    if ((parameter.groupKind ?? "qualified") === "qualified") {
        // 修飾名は右詰め。`MYPGM` は LIB を省略した形で、オブジェクト側に入る。
        const parts = splitTopLevel(body, "/");
        const offset = children.length - parts.length;
        parts.forEach((part, i) => {
            const child = children[offset + i];
            if (child)
                assignParameterValue(child, part, values, occurrence);
        });
        return;
    }
    const parts = splitTopLevel(body);
    parts.forEach((part, i) => {
        const child = children[i];
        if (!child)
            return;
        // *N は「その要素を省略した」印なので空欄に戻す。
        assignParameterValue(child, part.toUpperCase() === "*N" ? "" : part, values, occurrence);
    });
}
/**
 * 解析済みコマンドを、定義に沿って入力欄の値へ展開する。
 * 定位置指定（キーワードを伴わない値）は positional 順で対応付ける。
 */
function mapParsedCommandToValues(definition, parsed) {
    const values = {};
    for (const parameter of definition.parameters) {
        const raw = parsed.parameters[parameter.name.toUpperCase()];
        if (raw !== undefined) {
            assignParameterValue(parameter, raw, values);
        }
    }
    if (parsed.positional.length > 0) {
        const byPosition = definition.parameters
            .filter(parameter => typeof parameter.positional === "number")
            .sort((a, b) => (a.positional ?? 0) - (b.positional ?? 0));
        parsed.positional.forEach((raw, index) => {
            const parameter = byPosition[index];
            // キーワード指定が既にある場合はそちらを優先する。
            if (parameter && parsed.parameters[parameter.name.toUpperCase()] === undefined) {
                assignParameterValue(parameter, raw, values);
            }
        });
    }
    return values;
}
//# sourceMappingURL=clCommandParser.js.map