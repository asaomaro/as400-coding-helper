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
const jsonDefinitions_1 = require("./jsonDefinitions");
const clCommandParser_1 = require("./clCommandParser");
const applyChanges_1 = require("./applyChanges");
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
                // group の子（例: PGM の LIBL/OBJ）もヘルプ対象になるため再帰的に探す。
                const parameter = findParameter(definition.parameters, name);
                if (parameter) {
                    (0, help_1.showParameterHelp)(definition, parameter);
                }
            }
            else if (message?.type === "promptCommand") {
                // 値そのものがコマンドの欄（SBMJOB の CMD など）から、さらに
                // プロンプターを開く。SEU の F4 in F4 に相当する。
                void openNestedPrompter(context, resolved, String(message.name ?? ""), String(message.value ?? "")).then(built => {
                    if (built !== undefined) {
                        void panel.webview.postMessage({
                            type: "setValue",
                            name: String(message.name ?? ""),
                            value: built
                        });
                    }
                    // 親のプロンプターに操作を戻す。
                    panel.reveal(panel.viewColumn, false);
                });
            }
            else if (message?.type === "ready") {
                // WebView 起動確認。特に処理は不要。
            }
        });
    });
}
/**
 * コマンドの欄から入れ子のプロンプターを開き、確定した値（素の 1 行コマンド）を返す。
 * 取り消し・命令名が決まらない場合は undefined。
 *
 * 命令名は欄の値から読む。空欄のときは何を開けばよいか決まらないので尋ねる
 * （SEU も先に命令名を書いてから F4 を押す）。
 */
async function openNestedPrompter(context, resolved, name, currentValue) {
    const parsed = (0, clCommandParser_1.parseClCommand)(currentValue.trim());
    let keyword = parsed?.keyword;
    if (!keyword) {
        const typed = await vscode.window.showInputBox({
            title: `${name} で実行するコマンド`,
            prompt: "プロンプターを開くコマンド名を入力してください（例: CALL）",
            validateInput: value => /^[A-Za-z][A-Za-z0-9]*$/u.test(value.trim()) ? undefined : "コマンド名を入力してください"
        });
        keyword = typed?.trim().toUpperCase();
    }
    if (!keyword) {
        return undefined;
    }
    const loader = new jsonDefinitions_1.PrompterDefinitionLoader();
    const definition = await loader.loadDefinition(keyword, "cl", undefined, vscode.workspace.getWorkspaceFolder(resolved.document.uri), context);
    if (!definition) {
        void vscode.window.showInformationMessage(`${keyword} のプロンプター定義がありません。`);
        return undefined;
    }
    // 欄に既に書かれているコマンドがあれば、その値を初期値として持ち込む。
    const initialValues = parsed && parsed.keyword === definition.keyword
        ? (0, clCommandParser_1.mapParsedCommandToValues)(definition, parsed)
        : {};
    const result = await openPrompter(context, definition, resolved, initialValues);
    if (!result?.confirmed) {
        return undefined;
    }
    // 欄に入るのは値であってソース行ではないので、桁揃えも折り返しもしない。
    return (0, applyChanges_1.buildClCommandBody)(definition, result.values, {
        presentParameters: Object.keys(parsed?.parameters ?? {})
    });
}
function findParameter(parameters, name) {
    for (const parameter of parameters) {
        if (parameter.name === name) {
            return parameter;
        }
        const child = findParameter(parameter.children ?? [], name);
        if (child) {
            return child;
        }
    }
    return undefined;
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