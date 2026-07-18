"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePosition = resolvePosition;
const dialect_1 = require("./dialect");
const specClassifier_1 = require("./specClassifier");
const clContinuation_1 = require("../language/clContinuation");
const clCommandParser_1 = require("./clCommandParser");
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
    // CL は継続行(+/-)で複数行に跨る。カーソルがどの行にあっても、
    // コマンドは論理行の先頭にしか無い。行頭の語をそのまま採ると、
    // 継続行では SRCFILE(...) のような引数を命令名と見なしてしまう。
    let commandLine = position.line;
    if (language === "cl") {
        const logical = (0, clContinuation_1.getLogicalCommandRange)(document, position.line).range;
        commandLine = logical.start.line;
        const lines = [];
        for (let line = logical.start.line; line <= logical.end.line; line += 1) {
            lines.push(document.lineAt(line).text);
        }
        // ラベル(`TAG1:`)やコメントの扱いは解析器に任せる（書き戻しと同じ経路）。
        const parsed = (0, clCommandParser_1.parseClCommand)((0, clCommandParser_1.joinContinuationLines)(lines));
        keyword = parsed?.keyword ?? "";
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
        line: commandLine,
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