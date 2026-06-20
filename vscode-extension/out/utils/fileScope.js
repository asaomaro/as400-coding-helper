"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TARGET_EXTENSIONS = void 0;
exports.isInScopeDocument = isInScopeDocument;
exports.isInScopeUri = isInScopeUri;
/**
 * ルーラー表示・制御コード(SOSI)表示などの入力補助機能の対象とする拡張子。
 * 先頭ドットなし・小文字で定義する（AGENTS.md の指定に一致）。
 */
exports.TARGET_EXTENSIONS = [
    "rpg",
    "rpgle",
    "clp",
    "dds",
    "dspf",
    "prtf",
    "cmd",
];
const TARGET_LANGUAGE_IDS = ["rpg-fixed", "cl"];
function hasTargetExtension(fsPath) {
    const lower = fsPath.toLowerCase();
    return exports.TARGET_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`));
}
function isInScopeDocument(document) {
    if (TARGET_LANGUAGE_IDS.includes(document.languageId)) {
        return true;
    }
    return hasTargetExtension(document.uri.fsPath);
}
function isInScopeUri(uri) {
    return hasTargetExtension(uri.fsPath);
}
//# sourceMappingURL=fileScope.js.map