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
exports.registerClCommentToggle = registerClCommentToggle;
const vscode = __importStar(require("vscode"));
function registerClCommentToggle(context) {
    const disposable = vscode.commands.registerCommand("rpgClSupport.toggleComment.cl", () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const { document } = editor;
        if (document.languageId !== "cl") {
            return;
        }
        const targetLines = collectTargetLines(editor);
        if (targetLines.length === 0) {
            return;
        }
        const allCommented = targetLines.every(lineNumber => {
            const text = document.lineAt(lineNumber).text;
            const trimmed = text.trimStart();
            return trimmed.startsWith("/*");
        });
        void editor.edit(editBuilder => {
            for (const lineNumber of targetLines) {
                const line = document.lineAt(lineNumber);
                const originalText = line.text;
                const match = originalText.match(/^(\s*)/);
                const leading = match ? match[1] : "";
                const body = originalText.slice(leading.length);
                let newText;
                if (allCommented) {
                    if (body.startsWith("/* ")) {
                        newText = leading + body.slice(3);
                    }
                    else if (body.startsWith("/*")) {
                        newText = leading + body.slice(2);
                    }
                    else {
                        newText = originalText;
                    }
                }
                else {
                    newText = `${leading}/* ${body}`;
                }
                const range = new vscode.Range(new vscode.Position(lineNumber, 0), new vscode.Position(lineNumber, originalText.length));
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
//# sourceMappingURL=clCommentToggle.js.map