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
exports.openPrompter = openPrompter;
const vscode = __importStar(require("vscode"));
const model_1 = require("./model");
const binding_1 = require("./binding");
const help_1 = require("./help");
async function openPrompter(context, definition, resolved, initialValues) {
    const initialState = (0, model_1.buildInitialState)(definition, initialValues);
    const serializable = (0, binding_1.toSerializableState)(definition, initialState, resolved);
    const config = vscode.workspace.getConfiguration("rpgClSupport");
    const openBeside = config.get("prompter.openBeside") ?? false;
    const viewColumn = openBeside
        ? vscode.ViewColumn.Beside
        : vscode.ViewColumn.Active;
    const panel = vscode.window.createWebviewPanel("rpgClSupport.prompter", `${definition.keyword} Prompter`, viewColumn, {
        enableScripts: true,
        retainContextWhenHidden: false
    });
    const nonce = createNonce();
    panel.webview.html = (0, binding_1.buildHtml)(serializable, {
        cspSource: panel.webview.cspSource,
        nonce
    });
    return new Promise(resolve => {
        const subscription = panel.webview.onDidReceiveMessage(message => {
            console.log("[rpgClSupport] webview message", JSON.stringify(message));
            if (message?.type === "submit") {
                subscription.dispose();
                panel.dispose();
                resolve({
                    confirmed: true,
                    values: message.values
                });
            }
            else if (message?.type === "cancel") {
                subscription.dispose();
                panel.dispose();
                resolve({
                    confirmed: false,
                    values: {}
                });
            }
            else if (message?.type === "help") {
                const name = String(message.name ?? "");
                const parameter = definition.parameters.find(candidate => candidate.name === name);
                if (parameter) {
                    (0, help_1.showParameterHelp)(definition, parameter);
                }
            }
            else if (message?.type === "ready") {
                // WebView 起動確認。特に処理は不要。
            }
        });
    });
}
function createNonce() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < 16; i += 1) {
        const idx = Math.floor(Math.random() * chars.length);
        nonce += chars.charAt(idx);
    }
    return nonce;
}
//# sourceMappingURL=webview.js.map