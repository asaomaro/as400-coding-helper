"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyChanges = applyChanges;
exports.buildClCommandText = buildClCommandText;
const vscode = __importStar(require("vscode"));
const clContinuation_1 = require("../language/clContinuation");
const rpgEditGuards_1 = require("../language/rpgEditGuards");
async function applyChanges(editor, definition, resolved, values) {
    const { document } = editor;
    if (resolved.language === "cl") {
        const logical = (0, clContinuation_1.getLogicalCommandRange)(document, resolved.line);
        const newText = buildClCommandText(definition, values);
        await editor.edit(editBuilder => {
            editBuilder.replace(logical.range, newText);
        });
        return;
    }
    const line = document.lineAt(resolved.line);
    const range = new vscode.Range(new vscode.Position(resolved.line, 0), new vscode.Position(resolved.line, line.text.length));
    if (!(0, rpgEditGuards_1.isEditAllowedRange)(document, range)) {
        console.log("[rpgClSupport] RPG edit not allowed", JSON.stringify({
            uri: document.uri.toString(),
            line: resolved.line,
            start: range.start.character,
            end: range.end.character
        }));
        return;
    }
    const newText = buildRpgLineText(line.text, definition, values);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, range, newText);
    const success = await vscode.workspace.applyEdit(edit);
    console.log("[rpgClSupport] editor.edit finished", JSON.stringify({
        uri: document.uri.toString(),
        line: resolved.line,
        success
    }));
}
// CL コマンド行の組み立ては vscode API に依存しない純粋関数のため、検証用に公開する。
function buildClCommandText(definition, values) {
    const keyword = definition.keyword.toUpperCase();
    // Columns 1–13: label area, column 14: command.
    const labelArea = " ".repeat(13);
    let line = labelArea + keyword;
    // Parameters start at column 25.
    const paramStartColumn = 25; // 1-based
    const desiredParamIndex = paramStartColumn - 1; // 0-based
    if (line.length < desiredParamIndex) {
        line = line.padEnd(desiredParamIndex, " ");
    }
    else {
        line += " ";
    }
    const paramTokens = [];
    for (const parameter of definition.parameters) {
        const token = buildParameterToken(parameter, values);
        if (token) {
            paramTokens.push(token);
        }
    }
    if (paramTokens.length > 0) {
        line += paramTokens.join(" ");
    }
    return line;
}
/** 1つの入力値を、前後空白を落とした文字列として取り出す。 */
function readSingle(raw) {
    return (Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").trim();
}
/** 反復入力（maxOccurrences）を空要素を除いた配列として取り出す。 */
function readMultiple(raw) {
    const list = Array.isArray(raw)
        ? raw
        : typeof raw === "string" && raw.length > 0
            ? raw.split(/\r?\n/u)
            : [];
    return list.map(value => String(value ?? "").trim()).filter(value => value.length > 0);
}
/**
 * パラメータの「中身」（NAME(...) の括弧の内側）を組み立てる。空なら undefined。
 * group は入れ子になりうるため再帰する。
 *
 *  - singleValues に該当する値が先頭の子に入っていれば単一値として返す。
 *    例: POSITION → "*FIRST"（参照ライブラリーは伴わない）
 *  - qualified は "/" 連結。空の修飾子は落とす。例: "MYLIB/MYPGM" / "MYPGM"
 *    子は出力順（ライブラリーが先）で定義する。原典の修飾子N の並びとは逆になる。
 *  - elements は " " 連結。末尾の空要素は落とし、途中の空要素は CL の
 *    省略指定 *N に置き換える。例: "*AFTER REFLIB"
 */
function buildParameterBody(parameter, values) {
    const children = parameter.children ?? [];
    if (parameter.inputType !== "group" || children.length === 0) {
        const single = readSingle(values[parameter.name]);
        return single.length > 0 ? single : undefined;
    }
    const childBodies = children.map(child => buildParameterBody(child, values) ?? "");
    // 単一値はどの入力欄に入っているとは限らない。修飾名では
    // ライブラリーではなくオブジェクト側の欄に *SAME 等が入る。
    // 単一値が指定されたら、他の欄（ライブラリーの *LIBL 等）は無視する。
    const singleValues = parameter.singleValues ?? [];
    const single = childBodies.find(body => body.length > 0 &&
        singleValues.some(candidate => candidate.toUpperCase() === body.toUpperCase()));
    if (single) {
        return single;
    }
    if (childBodies.every(value => value.length === 0)) {
        return undefined;
    }
    if ((parameter.groupKind ?? "qualified") === "qualified") {
        return childBodies.filter(value => value.length > 0).join("/");
    }
    let lastFilled = -1;
    for (let i = 0; i < childBodies.length; i += 1) {
        if (childBodies[i].length > 0) {
            lastFilled = i;
        }
    }
    return childBodies
        .slice(0, lastFilled + 1)
        .map(value => (value.length > 0 ? value : "*N"))
        .join(" ");
}
/**
 * パラメータ1つを `NAME(VALUE)` トークンに組み立てる。値が空なら undefined。
 *
 * 繰り返し指定の group は、各出現を括弧で包む必要がある。
 * 例: ALCOBJ OBJ((LIBB/FILEA *FILE *EXCL MEMBERA))
 */
function buildParameterToken(parameter, values) {
    const isRepeatable = typeof parameter.maxOccurrences === "number" && parameter.maxOccurrences > 1;
    if (isRepeatable && parameter.inputType === "group") {
        const body = buildParameterBody(parameter, values);
        return body ? `${parameter.name}((${body}))` : undefined;
    }
    if (isRepeatable) {
        const list = readMultiple(values[parameter.name]);
        return list.length > 0 ? `${parameter.name}(${list.join(" ")})` : undefined;
    }
    const body = buildParameterBody(parameter, values);
    return body ? `${parameter.name}(${body})` : undefined;
}
function buildRpgLineText(original, definition, values) {
    const hasColumnInfo = definition.parameters.some(parameter => typeof parameter.sourceStart === "number" &&
        typeof parameter.sourceLength === "number" &&
        parameter.sourceStart > 0 &&
        parameter.sourceLength > 0);
    if (!hasColumnInfo) {
        console.log("[rpgClSupport] buildRpgLineText: no column info", JSON.stringify({
            keyword: definition.keyword,
            parameterNames: definition.parameters.map(parameter => parameter.name)
        }));
        return original;
    }
    const chars = original.split("");
    for (const parameter of definition.parameters) {
        const paramName = parameter.name.toUpperCase();
        if (paramName === "COMMENT" &&
            (typeof parameter.sourceStart !== "number" ||
                typeof parameter.sourceLength !== "number")) {
            const rawComment = (values[parameter.name] ?? "").toString();
            const trimmedComment = rawComment.trim();
            const maxCommentLength = parameter.attributes?.maxLength ?? 50;
            const commentStartIndex = 80; // column 81 (0-based index)
            const commentEndIndex = commentStartIndex + maxCommentLength;
            if (chars.length < commentEndIndex) {
                for (let i = chars.length; i < commentEndIndex; i += 1) {
                    chars[i] = " ";
                }
            }
            for (let i = commentStartIndex; i < commentEndIndex; i += 1) {
                chars[i] = " ";
            }
            if (trimmedComment.length > 0) {
                const commentText = trimmedComment.length > maxCommentLength
                    ? trimmedComment.slice(0, maxCommentLength)
                    : trimmedComment;
                for (let i = 0; i < commentText.length; i += 1) {
                    const idx = commentStartIndex + i;
                    chars[idx] = commentText.charAt(i);
                }
            }
            continue;
        }
        if (typeof parameter.sourceStart !== "number" ||
            typeof parameter.sourceLength !== "number" ||
            parameter.sourceStart <= 0 ||
            parameter.sourceLength <= 0) {
            continue;
        }
        const rawValue = values[parameter.name];
        const raw = (Array.isArray(rawValue) ? rawValue[0] ?? "" : rawValue ?? "").toString();
        const trimmed = raw.trim();
        const isNumericField = parameter.inputType === "number" || parameter.attributes?.numericOnly;
        const padded = (() => {
            if (trimmed.length > parameter.sourceLength) {
                return trimmed.slice(-parameter.sourceLength);
            }
            if (isNumericField) {
                return trimmed.padStart(parameter.sourceLength, " ");
            }
            return trimmed.padEnd(parameter.sourceLength, " ");
        })();
        const startIndex = parameter.sourceStart - 1;
        const endIndex = startIndex + parameter.sourceLength;
        if (chars.length < endIndex) {
            for (let i = chars.length; i < endIndex; i += 1) {
                chars[i] = " ";
            }
        }
        for (let i = 0; i < padded.length; i += 1) {
            const idx = startIndex + i;
            chars[idx] = padded.charAt(i);
        }
    }
    const result = chars.join("").replace(/\s+$/u, "");
    console.log("[rpgClSupport] buildRpgLineText result", JSON.stringify({
        keyword: definition.keyword,
        original,
        values,
        result
    }));
    return result;
}
//# sourceMappingURL=applyChanges.js.map