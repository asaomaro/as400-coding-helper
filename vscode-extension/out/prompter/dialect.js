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
exports.DEFAULT_DIALECT_BY_EXTENSION = void 0;
exports.resolveDialectFromPath = resolveDialectFromPath;
exports.resolveDialect = resolveDialect;
const vscode = __importStar(require("vscode"));
/**
 * 拡張子 → 方言(dialect) 対応の単一真実源。
 *
 * RPG 固定長の方言は languageId(`rpg-fixed`) からは導出できない
 * （`.rpgle` と `.rpg` がともに `rpg-fixed`)。そのためファイルパスの
 * 拡張子から判定する。曖昧な `.rpg` 運用向けに設定で上書きできる。
 */
const DIALECTS = new Set(["ile", "rpg3"]);
/** 既定の拡張子→方言マップ。設定が無い／不正なときのフォールバック。 */
exports.DEFAULT_DIALECT_BY_EXTENSION = {
    ".rpgle": "ile",
    ".rpg": "rpg3"
};
/** 拡張子で判定できなかった場合の既定方言（従来は全 rpg-fixed を ILE 扱い）。 */
const FALLBACK_DIALECT = "ile";
/** 設定キー（VSCode 標準スコープでフォルダ別上書き可能）。 */
const CONFIG_SECTION = "rpgClSupport";
const CONFIG_KEY = "rpgDialectByExtension";
/**
 * 拡張子マップを正規化する。キーは小文字化＋先頭 `.` を補い、
 * 値が `ile`/`rpg3` 以外のエントリは捨てる。
 */
function normalizeOverrides(overrides) {
    const normalized = {};
    if (!overrides) {
        return normalized;
    }
    for (const [rawKey, rawValue] of Object.entries(overrides)) {
        if (typeof rawValue !== "string") {
            continue;
        }
        const value = rawValue.trim().toLowerCase();
        if (!DIALECTS.has(value)) {
            continue;
        }
        let key = rawKey.trim().toLowerCase();
        if (key.length === 0) {
            continue;
        }
        if (!key.startsWith(".")) {
            key = `.${key}`;
        }
        normalized[key] = value;
    }
    return normalized;
}
/**
 * ファイルパスから方言を導出する純関数（vscode 非依存・unit テスト対象）。
 * 既定マップに上書きをマージし、拡張子は長い順に照合する
 * （`.rpgle` を `.rpg` より先に判定するため）。一致しなければ ile。
 */
function resolveDialectFromPath(fsPath, overrides) {
    const map = {
        ...exports.DEFAULT_DIALECT_BY_EXTENSION,
        ...normalizeOverrides(overrides)
    };
    const lower = fsPath.toLowerCase();
    const extensions = Object.keys(map).sort((a, b) => b.length - a.length);
    for (const ext of extensions) {
        if (lower.endsWith(ext)) {
            return map[ext] ?? FALLBACK_DIALECT;
        }
    }
    return FALLBACK_DIALECT;
}
/**
 * ドキュメントから方言を導出する（設定 `rpgClSupport.rpgDialectByExtension` を反映）。
 */
function resolveDialect(document) {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const overrides = config.get(CONFIG_KEY);
    return resolveDialectFromPath(document.uri.fsPath, overrides);
}
//# sourceMappingURL=dialect.js.map