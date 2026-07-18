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
exports.getDdsKeywordColumns = getDdsKeywordColumns;
exports.getRpgKeywordColumns = getRpgKeywordColumns;
exports.getClKeywordColumns = getClKeywordColumns;
exports.parseColumnsValue = parseColumnsValue;
const vscode = __importStar(require("vscode"));
let cachedRpgKeywordColumns;
let cachedClKeywordColumns;
let cachedDdsKeywordColumns;
/**
 * DDS の定位置項目の桁定義を読み込む（種別 → 桁）。
 * DDS は用途（物理/論理・表示装置・印刷装置）で桁の意味が変わるため、
 * 種別ごとに別のエントリーを持つ。
 */
async function getDdsKeywordColumns(context) {
    if (cachedDdsKeywordColumns) {
        return cachedDdsKeywordColumns;
    }
    const map = new Map();
    try {
        const uri = vscode.Uri.joinPath(context.extensionUri, "resources", "navigation", "dds-keyword-columns.json");
        const document = await vscode.workspace.openTextDocument(uri);
        const parsed = JSON.parse(document.getText());
        for (const [key, value] of Object.entries(parsed)) {
            const columns = parseColumnsValue(value);
            if (columns.length > 0) {
                map.set(key.toUpperCase(), columns);
            }
        }
    }
    catch (error) {
        console.log("[rpgClSupport] failed to load DDS keyword column definitions", String(error));
    }
    cachedDdsKeywordColumns = map;
    return map;
}
/**
 * RPG 固定フォーマットのスペック種別ごとのキーワード桁定義を読み込む。
 * タブナビゲーション・ルーラー表示など複数機能の単一真実源。
 */
async function getRpgKeywordColumns(context) {
    if (cachedRpgKeywordColumns) {
        return cachedRpgKeywordColumns;
    }
    const map = new Map();
    try {
        const uri = vscode.Uri.joinPath(context.extensionUri, "resources", "navigation", "rpg-fixed-keyword-columns.json");
        const document = await vscode.workspace.openTextDocument(uri);
        const raw = document.getText();
        const parsed = JSON.parse(raw);
        for (const [key, value] of Object.entries(parsed)) {
            const columns = parseColumnsValue(value);
            if (columns.length > 0) {
                map.set(key.toUpperCase(), columns);
            }
        }
    }
    catch (error) {
        console.log("[rpgClSupport] failed to load RPG keyword column definitions", String(error));
    }
    cachedRpgKeywordColumns = map;
    return map;
}
/**
 * CL のキーワード桁定義を読み込む。
 */
async function getClKeywordColumns(context) {
    if (cachedClKeywordColumns) {
        return cachedClKeywordColumns;
    }
    try {
        const uri = vscode.Uri.joinPath(context.extensionUri, "resources", "navigation", "cl-keyword-columns.json");
        const document = await vscode.workspace.openTextDocument(uri);
        const raw = document.getText();
        const parsed = JSON.parse(raw);
        const columns = parseColumnsValue(parsed);
        if (columns.length > 0) {
            cachedClKeywordColumns = columns;
            return columns;
        }
    }
    catch (error) {
        console.log("[rpgClSupport] failed to load CL keyword column definitions", String(error));
    }
    cachedClKeywordColumns = [];
    return cachedClKeywordColumns;
}
function parseColumnsValue(value) {
    if (typeof value === "string") {
        return parseColumnsFromString(value);
    }
    if (Array.isArray(value)) {
        return parseColumnsFromArray(value);
    }
    if (value &&
        typeof value === "object" &&
        "columns" in value &&
        (typeof value.columns === "string" ||
            Array.isArray(value.columns))) {
        const inner = value.columns;
        return parseColumnsValue(inner);
    }
    return [];
}
function parseColumnsFromString(raw) {
    const parts = raw.split(/[,、\s]+/u).filter(part => part.length > 0);
    const columns = [];
    for (const part of parts) {
        const parsed = Number(part);
        if (Number.isFinite(parsed) && parsed > 0) {
            columns.push(parsed - 1);
        }
    }
    return columns.sort((a, b) => a - b);
}
function parseColumnsFromArray(values) {
    const columns = [];
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
            columns.push(Math.floor(value) - 1);
        }
        else if (typeof value === "string") {
            const nested = parseColumnsFromString(value);
            columns.push(...nested);
        }
    }
    return columns.sort((a, b) => a - b);
}
//# sourceMappingURL=keywordColumns.js.map