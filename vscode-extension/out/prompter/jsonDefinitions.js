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
exports.resolveDefinitionLanguage = resolveDefinitionLanguage;
const vscode = __importStar(require("vscode"));
/**
 * CL 定義の表示言語。設定 `rpgClSupport.language` で切り替える。
 * 既定は VS Code の表示言語に合わせ、日本語環境なら ja、それ以外は en。
 */
function resolveDefinitionLanguage() {
    const configured = vscode.workspace
        .getConfiguration("rpgClSupport")
        .get("language");
    if (configured === "ja" || configured === "en") {
        return configured;
    }
    // "auto"（既定）または未設定
    return vscode.env.language?.toLowerCase().startsWith("ja") ? "ja" : "en";
}
class PrompterDefinitionLoader {
    async loadDefinitionFromUri(uri) {
        const document = await vscode.workspace.openTextDocument(uri);
        const raw = document.getText();
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch (error) {
            throw new Error(`Failed to parse prompter definition JSON from ${uri.fsPath}: ${String(error)}`);
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error(`Prompter definition file ${uri.fsPath} must contain a JSON object.`);
        }
        return parsed;
    }
    async loadFromDirectory(dirUri) {
        let entries;
        try {
            entries = await vscode.workspace.fs.readDirectory(dirUri);
        }
        catch {
            return [];
        }
        const definitions = [];
        for (const [name, type] of entries) {
            if (type === vscode.FileType.File && name.endsWith(".json")) {
                const fileUri = vscode.Uri.joinPath(dirUri, name);
                try {
                    const def = await this.loadDefinitionFromUri(fileUri);
                    definitions.push(def);
                }
                catch (error) {
                    console.log("[rpgClSupport] failed to load prompter definition", JSON.stringify({ file: name, error: String(error) }));
                }
            }
        }
        return definitions;
    }
    async loadForLanguage(language, dialect, workspaceFolder, context) {
        // RPG は方言別サブディレクトリ rpg/{dialect}/ を使う。
        // CL は言語別サブディレクトリ cl/{lang}/ を使う（原典が日本語版と英語版で
        // 別々にあり、プロンプターの表示語もそれに従うため）。
        const subPath = language === "rpg-fixed"
            ? ["rpg", dialect ?? "ile"]
            : ["cl", resolveDefinitionLanguage()];
        // 1) Load default definitions bundled with the extension
        const defaultDirUri = vscode.Uri.joinPath(context.extensionUri, "resources", "prompter", ...subPath);
        const definitions = await this.loadFromDirectory(defaultDirUri);
        if (definitions.length === 0) {
            console.log("[rpgClSupport] no default prompter definitions found", JSON.stringify({ language, dialect, subPath: subPath.join("/") }));
        }
        // 2) Load workspace overrides from .rpg-cl/{subPath}/ if available
        const baseUri = workspaceFolder?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!baseUri) {
            return definitions;
        }
        // 上書き層を低→高優先で重ねる。
        // - ile のみ: 旧 .rpg-cl/rpg/（dialect 無し）も後方互換で読む（既定移設前のユーザー上書き互換）。
        // - 全方言/CL: .rpg-cl/{subPath}/ を読む（高優先）。
        const overrideDirs = [];
        if (language === "rpg-fixed" && (dialect ?? "ile") === "ile") {
            overrideDirs.push(vscode.Uri.joinPath(baseUri, ".rpg-cl", "rpg"));
        }
        overrideDirs.push(vscode.Uri.joinPath(baseUri, ".rpg-cl", ...subPath));
        const byKeyword = new Map();
        for (const def of definitions) {
            byKeyword.set(def.keyword.toUpperCase(), def);
        }
        let hasOverride = false;
        for (const dirUri of overrideDirs) {
            const overrideDefs = await this.loadFromDirectory(dirUri);
            for (const def of overrideDefs) {
                byKeyword.set(def.keyword.toUpperCase(), def);
                hasOverride = true;
            }
        }
        if (!hasOverride) {
            return definitions;
        }
        return Array.from(byKeyword.values());
    }
}
exports.PrompterDefinitionLoader = PrompterDefinitionLoader;
//# sourceMappingURL=jsonDefinitions.js.map