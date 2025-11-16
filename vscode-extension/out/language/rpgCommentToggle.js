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
exports.registerRpgCommentToggle = registerRpgCommentToggle;
const vscode = __importStar(require("vscode"));
const rpgEditGuards_1 = require("./rpgEditGuards");
function registerRpgCommentToggle(context) {
    const disposable = vscode.commands.registerCommand("rpgClSupport.toggleComment.rpg", () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const { document } = editor;
        if (document.languageId !== "rpg-fixed") {
            return;
        }
        const targetLines = collectTargetLines(editor);
        if (targetLines.length === 0) {
            return;
        }
        void editor.edit(editBuilder => {
            for (const lineNumber of targetLines) {
                const line = document.lineAt(lineNumber);
                const originalText = line.text;
                const base = originalText.padEnd(7, " ");
                const marker = base.charAt(6);
                const isCommented = marker === "*";
                const replacementChar = isCommented ? " " : "*";
                const newText = base.substring(0, 6) +
                    replacementChar +
                    base.substring(7, base.length);
                const range = new vscode.Range(new vscode.Position(lineNumber, 0), new vscode.Position(lineNumber, originalText.length));
                if (!(0, rpgEditGuards_1.isEditAllowedRange)(document, range)) {
                    continue;
                }
                editBuilder.replace(range, newText);
            }
        });
    });
    context.subscriptions.push(disposable);
}
function collectTargetLines(editor) {
    const lines = new Set();
    for (const selection of editor.selections) {
        const start = selection.start.line;
        const end = selection.end.line;
        for (let line = start; line <= end; line += 1) {
            lines.add(line);
        }
    }
    if (lines.size === 0) {
        lines.add(editor.selection.active.line);
    }
    return [...lines].sort((a, b) => a - b);
}
//# sourceMappingURL=rpgCommentToggle.js.map