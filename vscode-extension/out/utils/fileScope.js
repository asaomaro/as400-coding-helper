"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInScopeDocument = isInScopeDocument;
exports.isInScopeUri = isInScopeUri;
function isInScopeDocument(document) {
    if (document.languageId === "rpg-fixed" || document.languageId === "cl") {
        return true;
    }
    const lower = document.uri.fsPath.toLowerCase();
    return lower.endsWith(".rpgle") || lower.endsWith(".clp");
}
function isInScopeUri(uri) {
    const lower = uri.fsPath.toLowerCase();
    return lower.endsWith(".rpgle") || lower.endsWith(".clp");
}
//# sourceMappingURL=fileScope.js.map