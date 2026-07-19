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
exports.resolveDdsLevel = resolveDdsLevel;
exports.resolveDdsType = resolveDdsType;
exports.isKeywordArea = isKeywordArea;
exports.registerDdsKeywordCompletion = registerDdsKeywordCompletion;
const vscode = __importStar(require("vscode"));
const jsonDefinitions_1 = require("../prompter/jsonDefinitions");
/** キーワード項目の開始桁（1 始まり）。ここより手前では補完を出さない。 */
const KEYWORD_COLUMN = 45;
/** 名前タイプ欄（17 桁目）の値 → レベル。 */
const NAME_TYPE_LEVEL = {
    R: "record",
    K: "key",
    S: "select",
    O: "select",
    J: "join",
    H: "help"
};
/**
 * その行が属するレベルを求める。
 *
 * レベルはその行だけでは決まらない。キーワードだけの行（17 桁目も名前欄も空）は
 * 直前のレコードやフィールドの続きなので、レベルを決めた行まで遡る必要がある。
 * 遡っても見つからなければファイル・レベル（最初のレコードより前）。
 */
function resolveDdsLevel(lineAt, lineIndex) {
    for (let index = lineIndex; index >= 0; index -= 1) {
        const text = lineAt(index);
        // 注記行は桁の意味を持たないので飛ばす。
        if (text.length > 6 && text.charAt(6) === "*") {
            continue;
        }
        const nameType = (text.charAt(16) ?? " ").toUpperCase();
        const level = NAME_TYPE_LEVEL[nameType];
        if (level) {
            return level;
        }
        // 17 桁目が空でも名前があればフィールド。名前も無ければ続きの行なので遡る。
        if (text.slice(18, 28).trim().length > 0) {
            return "field";
        }
    }
    return "file";
}
let cache;
let cacheLanguage;
/** 拡張子から DDS の種別を決める（ルーラーの specFamily と同じ規約）。 */
function resolveDdsType(fsPath) {
    const lower = fsPath.toLowerCase();
    if (/\.(pf|lf)$/u.test(lower))
        return "DDS-PF";
    if (/\.(dspf|mnudds)$/u.test(lower))
        return "DDS-DSPF";
    if (/\.(prtf)$/u.test(lower))
        return "DDS-PRTF";
    return undefined;
}
async function loadKeywords(context) {
    const language = (0, jsonDefinitions_1.resolveDefinitionLanguage)();
    if (cache && cacheLanguage === language) {
        return cache;
    }
    const map = new Map();
    try {
        const uri = vscode.Uri.joinPath(context.extensionUri, "resources", "completion", language === "ja" ? "dds-keywords.json" : `dds-keywords.${language}.json`);
        const document = await vscode.workspace.openTextDocument(uri);
        const parsed = JSON.parse(document.getText());
        for (const [key, value] of Object.entries(parsed)) {
            if (Array.isArray(value)) {
                map.set(key, value);
            }
        }
    }
    catch (error) {
        console.log("[rpgClSupport] failed to load DDS keywords", String(error));
    }
    cache = map;
    cacheLanguage = language;
    return map;
}
/**
 * カーソル位置がキーワード欄（45 桁目以降）かどうか。
 * 注記行（7 桁目が `*`）では 8 桁目以降が本文なので補完しない。
 */
function isKeywordArea(line, character) {
    if (line.length > 6 && line.charAt(6) === "*") {
        return false;
    }
    return character >= KEYWORD_COLUMN - 1;
}
/** 入力中のキーワード（英大文字の並び）を取り出す。 */
function currentWord(line, character) {
    let start = character;
    while (start > 0 && /[A-Za-z0-9]/u.test(line.charAt(start - 1))) {
        start -= 1;
    }
    return { text: line.slice(start, character), start };
}
function registerDdsKeywordCompletion(context) {
    const provider = {
        async provideCompletionItems(document, position) {
            const type = resolveDdsType(document.uri.fsPath);
            if (!type) {
                return undefined;
            }
            const line = document.lineAt(position.line).text;
            if (!isKeywordArea(line, position.character)) {
                return undefined;
            }
            const all = (await loadKeywords(context)).get(type) ?? [];
            if (all.length === 0) {
                return undefined;
            }
            // その行のレベルで書けるものだけに絞る。レベルが分からないものは残す。
            const level = resolveDdsLevel(index => document.lineAt(index).text, position.line);
            const keywords = all.filter(keyword => !keyword.level?.length || keyword.level.includes(level));
            const word = currentWord(line, position.character);
            const range = new vscode.Range(new vscode.Position(position.line, word.start), position);
            return keywords.map(keyword => {
                const item = new vscode.CompletionItem(keyword.name, vscode.CompletionItemKind.Keyword);
                item.detail = keyword.title;
                item.range = range;
                // 同じレベルで書けるものを上に出す（絞り込みの結果が見て分かるように）。
                item.sortText = keyword.level?.length ? `0${keyword.name}` : `1${keyword.name}`;
                // パラメータを取るキーワードは括弧まで入れて中にカーソルを置く。
                // 取らないものに括弧を付けると構文誤りになるため付けない。
                if (keyword.hasParameters) {
                    item.insertText = new vscode.SnippetString(`${keyword.name}($0)`);
                }
                const documentation = new vscode.MarkdownString();
                if (keyword.syntax?.length) {
                    documentation.appendCodeblock(keyword.syntax.join("\n"), "text");
                }
                if (keyword.level) {
                    documentation.appendMarkdown(`\n\`${keyword.level.join(" / ")}\`\n\n`);
                }
                if (keyword.description) {
                    documentation.appendText(keyword.description);
                }
                if (documentation.value.length > 0) {
                    item.documentation = documentation;
                }
                return item;
            });
        }
    };
    // DDS は言語登録していない（拡張子だけで扱う方針）ため、
    // languageId ではなく scheme+pattern で対象を絞る。
    return vscode.languages.registerCompletionItemProvider([
        { scheme: "file", pattern: "**/*.{pf,lf,dspf,prtf,mnudds}" },
        { scheme: "untitled", pattern: "**/*.{pf,lf,dspf,prtf,mnudds}" }
    ], provider);
}
//# sourceMappingURL=ddsKeywordCompletion.js.map