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
exports.PrompterDefinitionLoader = void 0;
const vscode = __importStar(require("vscode"));
class PrompterDefinitionLoader {
    async loadFromUri(uri) {
        const document = await vscode.workspace.openTextDocument(uri);
        const raw = document.getText();
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch (error) {
            throw new Error(`Failed to parse prompter definition JSON from ${uri.fsPath}: ${String(error)}`);
        }
        if (!Array.isArray(parsed)) {
            throw new Error(`Prompter definition file ${uri.fsPath} must contain a JSON array.`);
        }
        return parsed;
    }
    async loadForLanguage(language, workspaceFolder, context) {
        const fileName = language === "rpg-fixed"
            ? "rpg-prompter.json"
            : "cl-prompter.json";
        const definitions = [];
        // 1) Load default definitions bundled with the extension
        try {
            const defaultUri = vscode.Uri.joinPath(context.extensionUri, "resources", "prompter", fileName);
            const defaults = await this.loadFromUri(defaultUri);
            definitions.push(...defaults);
        }
        catch (error) {
            console.log("[rpgClSupport] failed to load default prompter definitions", JSON.stringify({
                language,
                fileName,
                error: String(error)
            }));
        }
        // 2) Load workspace overrides from .rpg-cl if available
        const baseUri = workspaceFolder?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!baseUri) {
            return definitions;
        }
        const workspaceUri = vscode.Uri.joinPath(baseUri, ".rpg-cl", fileName);
        try {
            const workspaceDefs = await this.loadFromUri(workspaceUri);
            const byKeyword = new Map();
            for (const def of definitions) {
                byKeyword.set(def.keyword.toUpperCase(), def);
            }
            for (const def of workspaceDefs) {
                byKeyword.set(def.keyword.toUpperCase(), def);
            }
            return Array.from(byKeyword.values());
        }
        catch (error) {
            // Workspace JSON が無い/壊れている場合は、拡張内デフォルトのみにフォールバックする
            console.log("[rpgClSupport] failed to load workspace prompter definitions", JSON.stringify({
                language,
                fileName,
                error: String(error)
            }));
            return definitions;
        }
    }
}
exports.PrompterDefinitionLoader = PrompterDefinitionLoader;
//# sourceMappingURL=jsonDefinitions.js.map