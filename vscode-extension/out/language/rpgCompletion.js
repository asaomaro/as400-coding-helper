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
exports.resolveCompletionKind = resolveCompletionKind;
exports.registerRpgCompletion = registerRpgCompletion;
const vscode = __importStar(require("vscode"));
const jsonDefinitions_1 = require("../prompter/jsonDefinitions");
const specClassifier_1 = require("../prompter/specClassifier");
const dialect_1 = require("../prompter/dialect");
/** C 仕様の命令コード欄（1 始まり）。ILE も RPG III も 26-35 桁。 */
const OPCODE_RANGE = { from: 26, to: 35 };
/** H/F/D/P 仕様のキーワード欄は 44 桁目から。 */
const KEYWORD_COLUMN = 44;
let cache;
let cacheLanguage;
async function loadData(context) {
    const language = (0, jsonDefinitions_1.resolveDefinitionLanguage)();
    if (cache && cacheLanguage === language) {
        return cache;
    }
    try {
        const uri = vscode.Uri.joinPath(context.extensionUri, "resources", "completion", language === "ja" ? "rpg-completion.json" : `rpg-completion.${language}.json`);
        const document = await vscode.workspace.openTextDocument(uri);
        cache = JSON.parse(document.getText());
        cacheLanguage = language;
        return cache;
    }
    catch (error) {
        console.log("[rpgClSupport] failed to load RPG completion data", String(error));
        return undefined;
    }
}
/**
 * 行と桁から、出す候補の種類を決める。
 * 注記行（7 桁目が `*`）では何も出さない。
 */
function resolveCompletionKind(line, character, specKeyword, dialect) {
    if (!specKeyword)
        return undefined;
    if (line.length > 6 && line.charAt(6) === "*")
        return undefined;
    const column = character + 1; // 1 始まりの桁
    // % を打った直後は組み込み関数。式はどの欄にも書けるので桁で絞らない。
    // ただし組み込み関数は RPG IV(ILE) で入ったもので RPG III には無い。
    // 候補の出所も ILE RPG 解説書なので、rpg3 では出さない。
    const before = line.slice(0, character);
    if (/%[A-Za-z0-9]*$/u.test(before)) {
        return dialect === "rpg3" ? undefined : { kind: "bif" };
    }
    if (specKeyword.startsWith("C-")) {
        if (column >= OPCODE_RANGE.from && column <= OPCODE_RANGE.to + 1) {
            return { kind: "opcode" };
        }
        return undefined;
    }
    if (/^[HFDP]-SPEC$/u.test(specKeyword) && column >= KEYWORD_COLUMN) {
        return { kind: "keyword", spec: specKeyword };
    }
    return undefined;
}
/** 入力中の語（英数字と % の並び）を取り出す。 */
function currentWord(line, character) {
    let start = character;
    while (start > 0 && /[A-Za-z0-9%-]/u.test(line.charAt(start - 1))) {
        start -= 1;
    }
    return start;
}
function buildDocumentation(operation) {
    const documentation = new vscode.MarkdownString();
    if (operation.fixedForm) {
        // 従来型は「どの演算項目に何を書くか」が要点なので、対応で見せる。
        const { columns, values } = operation.fixedForm;
        const lines = columns
            .map((column, index) => {
            const value = values[index] ?? "";
            return value ? `${column}: ${value}` : undefined;
        })
            .filter((line) => Boolean(line));
        if (lines.length > 0) {
            documentation.appendCodeblock(lines.join("\n"), "text");
        }
    }
    if (operation.freeForm) {
        documentation.appendCodeblock(operation.freeForm, "text");
    }
    if (operation.freeFormNote) {
        documentation.appendMarkdown(`\n${operation.freeFormNote}\n`);
    }
    return documentation;
}
function registerRpgCompletion(context) {
    const provider = {
        async provideCompletionItems(document, position) {
            const line = document.lineAt(position.line).text;
            // 仕様書種別は specClassifier に集約（ルーラー・プロンプターと共有）。
            const preceding = [];
            for (let above = 0; above < position.line; above += 1) {
                preceding.push(document.lineAt(above).text);
            }
            const dialect = (0, dialect_1.resolveDialect)(document);
            const specKeyword = (0, specClassifier_1.classifyRpgSpecKeyword)(line, dialect, preceding);
            const target = resolveCompletionKind(line, position.character, specKeyword, dialect);
            if (!target)
                return undefined;
            const data = await loadData(context);
            if (!data)
                return undefined;
            const start = currentWord(line, position.character);
            const range = new vscode.Range(new vscode.Position(position.line, start), position);
            if (target.kind === "keyword") {
                const keywords = data.keywords[target.spec] ?? [];
                return keywords.map(keyword => {
                    const item = new vscode.CompletionItem(keyword.name, vscode.CompletionItemKind.Keyword);
                    item.range = range;
                    item.detail = keyword.syntax;
                    if (keyword.hasParameters) {
                        item.insertText = new vscode.SnippetString(`${keyword.name}($0)`);
                    }
                    return item;
                });
            }
            const operations = target.kind === "bif" ? data.bifs : data.opcodes;
            return operations.map(operation => {
                const item = new vscode.CompletionItem(operation.name, target.kind === "bif"
                    ? vscode.CompletionItemKind.Function
                    : vscode.CompletionItemKind.Keyword);
                item.range = range;
                item.detail = operation.title;
                // 組み込み関数は必ず引数を取るので括弧まで入れる。
                if (target.kind === "bif") {
                    item.insertText = new vscode.SnippetString(`${operation.name}($0)`);
                }
                const documentation = buildDocumentation(operation);
                if (documentation.value.length > 0) {
                    item.documentation = documentation;
                }
                return item;
            });
        }
    };
    return vscode.languages.registerCompletionItemProvider([
        { scheme: "file", language: "rpg-fixed" },
        { scheme: "file", pattern: "**/*.{rpg,rpgle,sqlrpgle,sqlrpg}" }
    ], provider, "%");
}
//# sourceMappingURL=rpgCompletion.js.map