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
exports.registerDbcsShiftMarkers = registerDbcsShiftMarkers;
const vscode = __importStar(require("vscode"));
const fileScope_1 = require("../utils/fileScope");
let shiftOutDecoration;
let shiftInDecoration;
function isDbcsCodePoint(codePoint) {
    // おおまかに「全角系の文字」を DBCS とみなす
    // - Hiragana, Katakana, CJK, 全角英数・記号など
    if ((codePoint >= 0x3040 && codePoint <= 0x30ff) || // Hiragana/Katakana
        (codePoint >= 0x3400 && codePoint <= 0x9fff) || // CJK Unified Ideographs + Ext.A
        (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
        (codePoint >= 0xff01 && codePoint <= 0xff60) || // Fullwidth ASCII variants
        (codePoint >= 0xffe0 && codePoint <= 0xffe6) // Fullwidth currency etc.
    ) {
        return true;
    }
    return false;
}
function registerDbcsShiftMarkers(context) {
    shiftOutDecoration = vscode.window.createTextEditorDecorationType({
        before: {
            contentText: "{"
        }
    });
    shiftInDecoration = vscode.window.createTextEditorDecorationType({
        before: {
            contentText: "}"
        }
    });
    context.subscriptions.push(shiftOutDecoration, shiftInDecoration);
    const updateForEditor = (editor) => {
        if (!editor || !shiftOutDecoration || !shiftInDecoration) {
            return;
        }
        const { document } = editor;
        if (!(0, fileScope_1.isInScopeDocument)(document)) {
            editor.setDecorations(shiftOutDecoration, []);
            editor.setDecorations(shiftInDecoration, []);
            return;
        }
        const shiftOutRanges = [];
        const shiftInRanges = [];
        for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
            const line = document.lineAt(lineNumber);
            const text = line.text;
            let runStart;
            let index = 0;
            while (index < text.length) {
                const codePoint = text.codePointAt(index);
                if (codePoint === undefined) {
                    break;
                }
                const isDbcs = isDbcsCodePoint(codePoint);
                const codeUnitLength = codePoint > 0xffff ? 2 : 1;
                if (isDbcs) {
                    if (runStart === undefined) {
                        runStart = index;
                    }
                }
                else if (runStart !== undefined) {
                    // DBCS 連続範囲の終了
                    const runEnd = index;
                    const shiftOutPos = new vscode.Position(lineNumber, runStart);
                    const shiftInPos = new vscode.Position(lineNumber, runEnd);
                    shiftOutRanges.push(new vscode.Range(shiftOutPos, shiftOutPos));
                    shiftInRanges.push(new vscode.Range(shiftInPos, shiftInPos));
                    runStart = undefined;
                }
                index += codeUnitLength;
            }
            // 行末まで DBCS が続いている場合
            if (runStart !== undefined) {
                const runEnd = text.length;
                const shiftOutPos = new vscode.Position(lineNumber, runStart);
                const shiftInPos = new vscode.Position(lineNumber, runEnd);
                shiftOutRanges.push(new vscode.Range(shiftOutPos, shiftOutPos));
                shiftInRanges.push(new vscode.Range(shiftInPos, shiftInPos));
            }
        }
        editor.setDecorations(shiftOutDecoration, shiftOutRanges);
        editor.setDecorations(shiftInDecoration, shiftInRanges);
    };
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        updateForEditor(editor ?? undefined);
    }), vscode.workspace.onDidChangeTextDocument(event => {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && event.document === activeEditor.document) {
            updateForEditor(activeEditor);
        }
    }));
    if (vscode.window.activeTextEditor) {
        updateForEditor(vscode.window.activeTextEditor);
    }
}
//# sourceMappingURL=dbcsShiftMarkers.js.map