"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePosition = resolvePosition;
const dialect_1 = require("./dialect");
const specClassifier_1 = require("./specClassifier");
function resolvePosition(document, position) {
    const language = getLanguageId(document);
    if (!language) {
        return undefined;
    }
    const line = document.lineAt(position.line);
    const text = line.text;
    if (!text.trim()) {
        return undefined;
    }
    let keyword = "";
    let dialect;
    if (language === "cl") {
        const trimmed = text.trimStart();
        const parts = trimmed.split(/\s+/);
        keyword = (parts[0] ?? "").toUpperCase();
    }
    else {
        dialect = (0, dialect_1.resolveDialect)(document);
        // スペック種別は specClassifier に集約（ruler.ts と共有＝ドリフト防止）。
        // H/F/D/I/O/P/C すべて解決し、C は dialect 依存で新旧判定する。
        // I/O 仕様書は F 仕様書（22 桁目）でプログラム記述/外部記述が決まるため、
        // その行より上の行を渡す。
        const precedingLines = [];
        for (let above = 0; above < position.line; above += 1) {
            precedingLines.push(document.lineAt(above).text);
        }
        const resolved = (0, specClassifier_1.classifyRpgSpecKeyword)(text, dialect, precedingLines);
        if (!resolved) {
            return undefined;
        }
        keyword = resolved;
    }
    if (!keyword) {
        return undefined;
    }
    return {
        language,
        dialect,
        document,
        position,
        line: position.line,
        column: position.character,
        keyword
    };
}
function getLanguageId(document) {
    if (document.languageId === "rpg-fixed") {
        return "rpg-fixed";
    }
    if (document.languageId === "cl") {
        return "cl";
    }
    const lower = document.uri.fsPath.toLowerCase();
    if (/\.(sqlrpgle|rpgle|sqlrpg|rpg)$/u.test(lower)) {
        return "rpg-fixed";
    }
    if (/\.(clle|clp)$/u.test(lower)) {
        return "cl";
    }
    return undefined;
}
//# sourceMappingURL=positionResolver.js.map