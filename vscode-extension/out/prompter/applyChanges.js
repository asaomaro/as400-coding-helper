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
    if (keyword === "CALL") {
        const liblRaw = values.LIBL;
        const objRaw = values.OBJ;
        const libl = (Array.isArray(liblRaw) ? liblRaw[0] ?? "" : liblRaw ?? "").trim();
        const obj = (Array.isArray(objRaw) ? objRaw[0] ?? "" : objRaw ?? "").trim();
        if (obj.length > 0) {
            const pgmArg = libl.length > 0 ? `${libl}/${obj}` : obj;
            paramTokens.push(`PGM(${pgmArg})`);
        }
        const parmRaw = values.PARM;
        const parmValues = Array.isArray(parmRaw)
            ? parmRaw
            : typeof parmRaw === "string" && parmRaw.length > 0
                ? parmRaw.split(/\r?\n/u)
                : [];
        const cleaned = [];
        for (const raw of parmValues) {
            const trimmed = String(raw ?? "").trim();
            if (trimmed.length === 0) {
                continue;
            }
            cleaned.push(trimmed);
        }
        if (cleaned.length > 0) {
            paramTokens.push(`PARM(${cleaned.join(" ")})`);
        }
    }
    else {
        // Generic CL command: NAME(VALUE)
        for (const parameter of definition.parameters) {
            const raw = values[parameter.name];
            const single = (Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").trim();
            if (single.length === 0) {
                continue;
            }
            paramTokens.push(`${parameter.name}(${single})`);
        }
    }
    if (paramTokens.length > 0) {
        line += paramTokens.join(" ");
    }
    return line;
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