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
exports.registerShowPrompterCommand = registerShowPrompterCommand;
const vscode = __importStar(require("vscode"));
const jsonDefinitions_1 = require("../../prompter/jsonDefinitions");
const positionResolver_1 = require("../../prompter/positionResolver");
const webview_1 = require("../../prompter/webview");
const applyChanges_1 = require("../../prompter/applyChanges");
const initialValues_1 = require("../../prompter/initialValues");
function registerShowPrompterCommand(context) {
    const disposable = vscode.commands.registerCommand("rpgClSupport.showPrompter", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const { document, selection } = editor;
        console.log("[rpgClSupport] showPrompter invoked", JSON.stringify({
            uri: document.uri.toString(),
            languageId: document.languageId,
            line: selection.active.line,
            character: selection.active.character
        }));
        const originalSelection = new vscode.Selection(selection.start, selection.end);
        const resolvedLine = document.lineAt(selection.active.line);
        const lineText = resolvedLine.text;
        const isRpgFixed = document.languageId === "rpg-fixed" ||
            document.uri.fsPath.toLowerCase().endsWith(".rpgle");
        if (isRpgFixed) {
            const padded = lineText.padEnd(7, " ");
            const commentMarker = padded.charAt(6);
            if (commentMarker === "*") {
                void vscode.window.showInformationMessage("コメント行では F4 プロンプターを表示できません。");
                return;
            }
        }
        const resolved = (0, positionResolver_1.resolvePosition)(document, selection.active);
        if (!resolved) {
            void vscode.window.showInformationMessage("F4 prompter is only available for RPG/CL commands.");
            return;
        }
        const loader = new jsonDefinitions_1.PrompterDefinitionLoader();
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const definitions = await loader.loadForLanguage(resolved.language, workspaceFolder, context);
        console.log("[rpgClSupport] loaded definitions", JSON.stringify({
            language: resolved.language,
            count: definitions.length,
            keywords: definitions.map(def => def.keyword)
        }));
        const definition = definitions.find(candidate => candidate.keyword === resolved.keyword);
        if (!definition) {
            void vscode.window.showInformationMessage(`No prompter definition found for ${resolved.keyword}.`);
            editor.selection = originalSelection;
            return;
        }
        console.log("[rpgClSupport] using definition", JSON.stringify({
            keyword: definition.keyword,
            parameterNames: definition.parameters.map(parameter => parameter.name),
            hasColumns: definition.parameters.some(parameter => typeof parameter.sourceStart === "number" &&
                typeof parameter.sourceLength === "number")
        }));
        const initialValues = (0, initialValues_1.extractInitialValues)(resolved, definition);
        const result = await (0, webview_1.openPrompter)(context, definition, resolved, initialValues);
        if (!result || !result.confirmed) {
            console.log("[rpgClSupport] prompter cancelled or closed", JSON.stringify({ confirmed: result?.confirmed ?? false }));
            await vscode.window.showTextDocument(editor.document, {
                viewColumn: editor.viewColumn,
                selection: originalSelection
            });
            return;
        }
        console.log("[rpgClSupport] applyChanges request", JSON.stringify({
            line: resolved.line,
            keyword: definition.keyword,
            values: result.values
        }));
        const targetEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === document.uri.toString()) ?? editor;
        if (targetEditor.document.isClosed) {
            console.log("[rpgClSupport] target editor is closed; skipping applyChanges", JSON.stringify({ uri: targetEditor.document.uri.toString() }));
            await vscode.window.showTextDocument(editor.document, {
                viewColumn: editor.viewColumn,
                selection: originalSelection
            });
            return;
        }
        console.log("[rpgClSupport] applyChanges request", JSON.stringify({
            line: resolved.line,
            keyword: definition.keyword,
            values: result.values
        }));
        await (0, applyChanges_1.applyChanges)(targetEditor, definition, resolved, result.values);
        await vscode.window.showTextDocument(targetEditor.document, {
            viewColumn: targetEditor.viewColumn,
            selection: originalSelection
        });
    });
    context.subscriptions.push(disposable);
}
//# sourceMappingURL=showPrompter.js.map