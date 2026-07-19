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
/** 表示の状態。ステータスバーのクリックで切り替える。 */
const STATE_KEY = "rpgClSupport.sosi.enabled";
let enabled = true;
let statusBarItem;
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
            contentText: "{",
            color: new vscode.ThemeColor("editorCodeLens.foreground")
        }
    });
    shiftInDecoration = vscode.window.createTextEditorDecorationType({
        before: {
            contentText: "}",
            color: new vscode.ThemeColor("editorCodeLens.foreground")
        }
    });
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    statusBarItem.command = "rpgClSupport.sosi.toggle";
    enabled = context.workspaceState.get(STATE_KEY) ?? true;
    context.subscriptions.push(shiftOutDecoration, shiftInDecoration, statusBarItem);
    const updateForEditor = (editor) => {
        if (!editor || !shiftOutDecoration || !shiftInDecoration) {
            return;
        }
        const { document } = editor;
        if (!(0, fileScope_1.isInScopeDocument)(document)) {
            editor.setDecorations(shiftOutDecoration, []);
            editor.setDecorations(shiftInDecoration, []);
            statusBarItem?.hide();
            return;
        }
        updateStatusBar();
        statusBarItem?.show();
        // 消しているときは装飾を外す。桁は SO/SI の分だけ変わるので、
        // 出す・出さないで見え方が変わるのが正しい（実機は SO/SI が実在する）。
        if (!enabled) {
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
    const toggleCommand = vscode.commands.registerCommand("rpgClSupport.sosi.toggle", async () => {
        enabled = !enabled;
        await context.workspaceState.update(STATE_KEY, enabled);
        updateForEditor(vscode.window.activeTextEditor);
    });
    context.subscriptions.push(toggleCommand, vscode.window.onDidChangeActiveTextEditor(editor => {
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
function updateStatusBar() {
    if (!statusBarItem) {
        return;
    }
    statusBarItem.text = `$(symbol-text) SOSI: ${enabled ? "On" : "Off"}`;
    statusBarItem.tooltip = enabled
        ? "DBCS の前後に { } を表示しています。クリックで消す"
        : "DBCS の { } を表示していません。クリックで出す";
}
//# sourceMappingURL=dbcsShiftMarkers.js.map