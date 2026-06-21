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
exports.resolvePosition = resolvePosition;
const vscode = __importStar(require("vscode"));
const dialect_1 = require("./dialect");
function resolvePosition(document, position) {
    const language = getLanguageId(document);
    if (!language) {
        return undefined;
    }
    const line = document.lineAt(position.line);
    const text = line.text;
    if (!text.trim()) {
        return undefined;
    }
    let keyword = "";
    let dialect;
    if (language === "cl") {
        const trimmed = text.trimStart();
        const parts = trimmed.split(/\s+/);
        keyword = (parts[0] ?? "").toUpperCase();
    }
    else {
        dialect = (0, dialect_1.resolveDialect)(document);
        const specCharRaw = text.length > 5 ? text.charAt(5) : " ";
        const specChar = specCharRaw.toUpperCase();
        if (specChar === "D") {
            keyword = "D-SPEC";
        }
        else if (specChar === "C") {
            // RPG III(rpg3) には C-NEW(自由形演算) が存在しないため常に C-SPEC。
            // ILE(ile) のみ従来どおり opcode で C-NEW を判定する。
            if (dialect === "rpg3") {
                keyword = "C-SPEC";
            }
            else {
                const tail = text.length > 6 ? text.slice(6) : "";
                const tokens = tail.trim().split(/\s+/).filter(token => token.length > 0);
                const opcode = (tokens[0] ?? "").toUpperCase();
                const cNewOpcodes = getCNewOpcodes();
                if (opcode && cNewOpcodes.has(opcode)) {
                    keyword = "C-NEW";
                }
                else {
                    keyword = "C-SPEC";
                }
            }
        }
        else {
            return undefined;
        }
    }
    if (!keyword) {
        return undefined;
    }
    return {
        language,
        dialect,
        document,
        position,
        line: position.line,
        column: position.character,
        keyword
    };
}
function getCNewOpcodes() {
    const defaults = new Set([
        "EVAL",
        "EVALR",
        "IF",
        "ELSEIF",
        "ELSE",
        "ENDIF",
        "SELECT",
        "WHEN",
        "OTHER",
        "ENDSL"
    ]);
    const config = vscode.workspace.getConfiguration("rpgClSupport");
    const configured = config.get("cNewOpcodes");
    if (Array.isArray(configured)) {
        for (const value of configured) {
            if (typeof value === "string" && value.trim().length > 0) {
                defaults.add(value.trim().toUpperCase());
            }
        }
    }
    return defaults;
}
function getLanguageId(document) {
    if (document.languageId === "rpg-fixed") {
        return "rpg-fixed";
    }
    if (document.languageId === "cl") {
        return "cl";
    }
    const lower = document.uri.fsPath.toLowerCase();
    if (lower.endsWith(".rpgle")) {
        return "rpg-fixed";
    }
    if (lower.endsWith(".clp")) {
        return "cl";
    }
    return undefined;
}
//# sourceMappingURL=positionResolver.js.map