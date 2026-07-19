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
/**
 * 読み込み済みの既定定義（拡張機能に同梱するもの）。
 * 同梱物は動かないので、一度読んだら保持してよい。
 * 利用者の上書き（.rpg-cl/）は毎回読む（1 ファイルなので安い）。
 */
const bundledCache = new Map();
/** 定義ファイル名はキーワードそのもの（全 288 定義で一致することを検査済み）。 */
function definitionFileName(keyword) {
    return `${keyword}.json`;
}
class PrompterDefinitionLoader {
    async loadDefinitionFromUri(uri) {
        // openTextDocument は VS Code の文書モデルに登録され、数が増えると重い。
        // 定義は編集対象ではないので生読みで足りる。
        const bytes = await vscode.workspace.fs.readFile(uri);
        const raw = new TextDecoder("utf-8").decode(bytes);
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
    /**
     * キーワードから定義を 1 件だけ読む。
     *
     * F4 のたびにディレクトリ全体（CL なら 134 ファイル・3.5MB）を読んで
     * 1 件だけ使っていたため表示が遅かった。ファイル名はキーワードそのものなので、
     * 直接引けば 1 ファイルで済む。
     *
     * 見つからない場合だけ全走査に落とす（ファイル名とキーワードがずれた定義を
     * 利用者が置いた場合の保険）。
     */
    async loadDefinition(keyword, language, dialect, workspaceFolder, context) {
        const subPath = this.resolveSubPath(language, dialect);
        const fileName = definitionFileName(keyword);
        // 上書きが最優先。1 ファイルなので毎回見てよい。
        for (const dirUri of this.overrideDirs(language, dialect, workspaceFolder)) {
            try {
                return await this.loadDefinitionFromUri(vscode.Uri.joinPath(dirUri, fileName));
            }
            catch {
                // 無ければ次を見る
            }
        }
        const bundledUri = vscode.Uri.joinPath(context.extensionUri, "resources", "prompter", ...subPath, fileName);
        const cacheKey = bundledUri.toString();
        const cached = bundledCache.get(cacheKey);
        if (cached !== undefined) {
            return cached ?? undefined;
        }
        try {
            const definition = await this.loadDefinitionFromUri(bundledUri);
            bundledCache.set(cacheKey, definition);
            return definition;
        }
        catch {
            // ファイル名とキーワードがずれている場合に備えて全走査で拾う。
            const all = await this.loadForLanguage(language, dialect, workspaceFolder, context);
            const found = all.find(candidate => candidate.keyword === keyword);
            bundledCache.set(cacheKey, found ?? null);
            return found;
        }
    }
    resolveSubPath(language, dialect) {
        if (language === "rpg-fixed") {
            return ["rpg", dialect ?? "ile"];
        }
        // .cmd の文は CL コマンドではないので別に置く。混ぜると CL の
        // プロンプターに PARM や QUAL が出てしまう。
        return [language === "cmd" ? "cmd" : "cl", resolveDefinitionLanguage()];
    }
    overrideDirs(language, dialect, workspaceFolder) {
        const baseUri = workspaceFolder?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!baseUri) {
            return [];
        }
        // 高優先から順に返す（loadForLanguage 側は低→高で重ねるので順序が逆）。
        const dirs = [
            vscode.Uri.joinPath(baseUri, ".rpg-cl", ...this.resolveSubPath(language, dialect))
        ];
        if (language === "rpg-fixed" && (dialect ?? "ile") === "ile") {
            dirs.push(vscode.Uri.joinPath(baseUri, ".rpg-cl", "rpg"));
        }
        return dirs;
    }
    async loadForLanguage(language, dialect, workspaceFolder, context) {
        // RPG は方言別サブディレクトリ rpg/{dialect}/ を使う。
        // CL は言語別サブディレクトリ cl/{lang}/ を使う（原典が日本語版と英語版で
        // 別々にあり、プロンプターの表示語もそれに従うため）。
        const subPath = this.resolveSubPath(language, dialect);
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