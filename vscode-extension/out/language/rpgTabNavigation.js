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
exports.registerRpgTabNavigation = registerRpgTabNavigation;
const vscode = __importStar(require("vscode"));
const rpgLayout_1 = require("./rpgLayout");
const rpgEditGuards_1 = require("./rpgEditGuards");
function registerRpgTabNavigation(context) {
    const disposable = vscode.commands.registerCommand("rpgClSupport.rpgTabNext", () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const { document } = editor;
        if (document.languageId !== "rpg-fixed") {
            return;
        }
        const position = editor.selection.active;
        const nextStop = (0, rpgLayout_1.getNextTabStop)(position.character);
        if (nextStop === undefined) {
            return;
        }
        const line = document.lineAt(position.line);
        const edits = [];
        if (line.text.length < nextStop) {
            const paddingLength = nextStop - line.text.length;
            const padding = " ".repeat(paddingLength);
            const insertPosition = new vscode.Position(line.lineNumber, line.text.length);
            const range = new vscode.Range(insertPosition, insertPosition);
            if ((0, rpgEditGuards_1.isEditAllowedRange)(document, range)) {
                edits.push(vscode.TextEdit.insert(insertPosition, padding));
            }
        }
        const newCursorPosition = new vscode.Position(position.line, nextStop);
        editor.selections = [
            new vscode.Selection(newCursorPosition, newCursorPosition)
        ];
        if (edits.length > 0) {
            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.set(document.uri, edits);
            void vscode.workspace.applyEdit(workspaceEdit);
        }
    });
    context.subscriptions.push(disposable);
}
//# sourceMappingURL=rpgTabNavigation.js.map