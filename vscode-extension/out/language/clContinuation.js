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
exports.getLogicalCommandRange = getLogicalCommandRange;
const vscode = __importStar(require("vscode"));
function getLogicalCommandRange(document, lineNumber) {
    let start = lineNumber;
    let end = lineNumber;
    for (let line = lineNumber - 1; line >= 0; line -= 1) {
        const text = document.lineAt(line).text;
        if (text.trimEnd().endsWith("+")) {
            start = line;
        }
        else {
            break;
        }
    }
    for (let line = lineNumber + 1; line < document.lineCount; line += 1) {
        const text = document.lineAt(line).text;
        if (document.lineAt(line - 1).text.trimEnd().endsWith("+")) {
            end = line;
        }
        else {
            break;
        }
    }
    const startPos = new vscode.Position(start, 0);
    const endLine = document.lineAt(end);
    const endPos = new vscode.Position(end, endLine.text.length);
    return {
        range: new vscode.Range(startPos, endPos)
    };
}
//# sourceMappingURL=clContinuation.js.map