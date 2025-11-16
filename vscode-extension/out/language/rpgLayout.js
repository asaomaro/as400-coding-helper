"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNextTabStop = getNextTabStop;
exports.getLine = getLine;
const RPG_TAB_STOPS = [6, 10, 20, 30, 40, 50, 60, 70];
function getNextTabStop(column) {
    return RPG_TAB_STOPS.find(stop => stop > column);
}
function getLine(document, line) {
    return document.lineAt(line);
}
//# sourceMappingURL=rpgLayout.js.map