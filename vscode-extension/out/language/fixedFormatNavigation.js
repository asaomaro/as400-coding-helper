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
exports.registerFixedFormatNavigation = registerFixedFormatNavigation;
const vscode = __importStar(require("vscode"));
function isSupportedDocument(document) {
    return document.languageId === "rpg-fixed" || document.languageId === "cl";
}
function registerFixedFormatNavigation(_context) {
    // 固定長フォーマット用のカーソル移動および
    // 矢印キーに連動したスペース挿入ロジックは廃止しました。
    //
    // 将来的に必要になった場合は、この関数内で
    // onDidChangeTextEditorSelection などのハンドラを
    // 再度登録してください。
    void vscode; // import を使用済みにして ESLint/tsc の警告を防ぐ
}
//# sourceMappingURL=fixedFormatNavigation.js.map