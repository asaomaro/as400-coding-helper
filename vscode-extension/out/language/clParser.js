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
exports.parseClDocument = parseClDocument;
const vscode = __importStar(require("vscode"));
function parseClDocument(document) {
    const diagnostics = [];
    for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
        const line = document.lineAt(lineNumber);
        const text = line.text;
        const singleQuotes = (text.match(/'/g) ?? []).length;
        if (singleQuotes % 2 === 1) {
            const range = new vscode.Range(new vscode.Position(lineNumber, 0), new vscode.Position(lineNumber, text.length));
            diagnostics.push(new vscode.Diagnostic(range, "Unmatched single quote in CL command line.", vscode.DiagnosticSeverity.Warning));
        }
        const doubleQuotes = (text.match(/"/g) ?? []).length;
        if (doubleQuotes % 2 === 1) {
            const range = new vscode.Range(new vscode.Position(lineNumber, 0), new vscode.Position(lineNumber, text.length));
            diagnostics.push(new vscode.Diagnostic(range, "Unmatched double quote in CL command line.", vscode.DiagnosticSeverity.Warning));
        }
    }
    return diagnostics;
}
//# sourceMappingURL=clParser.js.map