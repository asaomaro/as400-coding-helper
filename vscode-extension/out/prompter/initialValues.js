"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractInitialValues = extractInitialValues;
const clContinuation_1 = require("../language/clContinuation");
function extractInitialValues(resolved, definition) {
    if (resolved.language === "rpg-fixed") {
        return extractRpgInitialValues(resolved, definition);
    }
    return extractClInitialValues(resolved, definition);
}
function extractRpgInitialValues(resolved, definition) {
    const line = resolved.document.lineAt(resolved.line);
    const text = line.text;
    const specCharRaw = text.length > 5 ? text.charAt(5) : " ";
    const specChar = specCharRaw.toUpperCase();
    // Prefer JSON / built-in column metadata when available
    const columnValues = extractByColumns(text, definition);
    // For D-spec, if COMMENT was not obtained from column metadata,
    // fall back to treating columns 81+ as the comment area.
    if (specChar === "D") {
        const paramNames = new Set(definition.parameters.map(parameter => parameter.name.toUpperCase()));
        if (paramNames.has("COMMENT") && !("COMMENT" in columnValues)) {
            const commentColumnIndex = 80; // column 81 (0-based index)
            if (text.length > commentColumnIndex) {
                const commentTail = text.slice(commentColumnIndex).trim();
                if (commentTail.length > 0) {
                    columnValues.COMMENT = commentTail;
                }
            }
        }
    }
    if (Object.keys(columnValues).length > 0) {
        return columnValues;
    }
    if (specChar === "C") {
        if (resolved.keyword === "C-NEW") {
            return extractRpgCnewValues(text, definition);
        }
        return extractRpgCspecValues(text, definition);
    }
    if (specChar === "D") {
        return extractRpgDspecValues(text, definition);
    }
    return {};
}
function extractByColumns(text, definition) {
    const values = {};
    for (const parameter of definition.parameters) {
        if (typeof parameter.sourceStart !== "number" ||
            typeof parameter.sourceLength !== "number" ||
            parameter.sourceStart <= 0 ||
            parameter.sourceLength <= 0) {
            continue;
        }
        const startIndex = parameter.sourceStart - 1;
        const endIndex = startIndex + parameter.sourceLength;
        if (startIndex >= text.length) {
            continue;
        }
        const slice = parameter.name.toUpperCase() === "COMMENT"
            ? text.slice(startIndex) // COMMENT: take until end of line
            : text.slice(startIndex, Math.min(endIndex, text.length));
        const trimmed = slice.trim();
        if (trimmed.length === 0) {
            continue;
        }
        values[parameter.name] = trimmed;
    }
    return values;
}
function extractRpgDspecValues(text, definition) {
    const values = {};
    // From column 7 onward, split into tokens and infer NAME / TYPE / LEN / DEC
    const tail = text.length > 6 ? text.slice(6) : "";
    const tokens = tail.trim().split(/\s+/).filter(token => token.length > 0);
    if (tokens.length === 0) {
        return values;
    }
    const paramNames = new Set(definition.parameters.map(parameter => parameter.name.toUpperCase()));
    const name = tokens[0] ?? "";
    const type = tokens.length > 1 ? tokens[1] ?? "" : "";
    const len = tokens.length > 2 ? tokens[2] ?? "" : "";
    const dec = tokens.length > 3 ? tokens[3] ?? "" : "";
    if (name && paramNames.has("NAME")) {
        values.NAME = name;
    }
    if (type && paramNames.has("TYPE")) {
        values.TYPE = type;
    }
    if (len && paramNames.has("LEN")) {
        values.LEN = len;
    }
    if (dec && paramNames.has("DEC")) {
        values.DEC = dec;
    }
    return values;
}
function extractRpgCspecValues(text, definition) {
    const values = {};
    // From column 7 onward, treat as tokens:
    // FACTOR1 / OPCODE / FACTOR2 / RESULT
    const tail = text.length > 6 ? text.slice(6) : "";
    const tokens = tail.trim().split(/\s+/).filter(token => token.length > 0);
    let factor1 = "";
    let opcode = "";
    let factor2 = "";
    let result = "";
    if (tokens.length === 1) {
        opcode = tokens[0] ?? "";
    }
    else if (tokens.length === 2) {
        opcode = tokens[0] ?? "";
        factor2 = tokens[1] ?? "";
    }
    else if (tokens.length === 3) {
        factor1 = tokens[0] ?? "";
        opcode = tokens[1] ?? "";
        factor2 = tokens[2] ?? "";
    }
    else if (tokens.length >= 4) {
        factor1 = tokens[0] ?? "";
        opcode = tokens[1] ?? "";
        factor2 = tokens[2] ?? "";
        result = tokens.slice(3).join(" ");
    }
    const paramNames = new Set(definition.parameters.map(parameter => parameter.name.toUpperCase()));
    if (opcode && paramNames.has("OPCODE")) {
        values.OPCODE = opcode;
    }
    if (factor1 && paramNames.has("FACTOR1")) {
        values.FACTOR1 = factor1;
    }
    if (factor2 && paramNames.has("FACTOR2")) {
        values.FACTOR2 = factor2;
    }
    if (result && paramNames.has("RESULT")) {
        values.RESULT = result;
    }
    return values;
}
function extractRpgCnewValues(text, definition) {
    const values = {};
    const tail = text.length > 6 ? text.slice(6) : "";
    const trimmedTail = tail.trim();
    if (!trimmedTail) {
        return values;
    }
    const tokens = trimmedTail.split(/\s+/).filter(token => token.length > 0);
    if (tokens.length === 0) {
        return values;
    }
    const opcode = tokens[0] ?? "";
    const afterOpcode = trimmedTail.slice(trimmedTail.indexOf(opcode) + opcode.length).trim();
    const paramNames = new Set(definition.parameters.map(parameter => parameter.name.toUpperCase()));
    if (opcode && paramNames.has("OPCODE")) {
        values.OPCODE = opcode;
    }
    if (afterOpcode && paramNames.has("COND")) {
        values.COND = afterOpcode;
    }
    return values;
}
function extractClInitialValues(resolved, definition) {
    const document = resolved.document;
    const logicalRange = (0, clContinuation_1.getLogicalCommandRange)(document, resolved.line).range;
    const text = document.getText(logicalRange);
    const tokens = text.trim().split(/\s+/).filter(token => token.length > 0);
    if (tokens.length === 0) {
        return {};
    }
    const values = {};
    const paramNames = new Set(definition.parameters.map(parameter => parameter.name.toUpperCase()));
    // tokens[0] is the command name (CALL, etc.)
    if (tokens.length > 1 && paramNames.has("PGM")) {
        values.PGM = tokens[1] ?? "";
    }
    if (tokens.length > 2 && paramNames.has("PARM")) {
        values.PARM = tokens.slice(2).join(" ");
    }
    return values;
}
//# sourceMappingURL=initialValues.js.map