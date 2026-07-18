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
exports.classifyRpgSpecKeyword = classifyRpgSpecKeyword;
exports.getCNewOpcodes = getCNewOpcodes;
const vscode = __importStar(require("vscode"));
/**
 * RPG 固定長ソース行のスペック種別（keyword）判定を **単一の真実**として提供する。
 * ルーラー表示（ruler.ts）と F4 プロンプター／タブナビ（positionResolver.ts）が
 * 同じ規約を共有し、片方だけに種別追加が漏れる（ドリフト）のを防ぐ。
 *
 * 6 桁目（index 5）のスペック文字で分類する。C は新旧を cNewOpcodes で判定するが、
 * RPG III(rpg3) には C-NEW(自由形演算) が存在しないため、dialect 指定時は常に C-SPEC。
 */
function classifyRpgSpecKeyword(text, dialect) {
    if (text.length < 6) {
        return undefined;
    }
    const specChar = text.charAt(5).toUpperCase();
    switch (specChar) {
        case "H":
            return "H-SPEC";
        case "F":
            return "F-SPEC";
        case "D":
            return "D-SPEC";
        case "I":
            return "I-SPEC";
        case "O":
            return "O-SPEC";
        case "P":
            return "P-SPEC";
        case "C":
            return classifyCSpec(text, dialect);
        default:
            return undefined;
    }
}
/**
 * C 仕様の新旧判定。dialect が rpg3 のときは C-NEW が存在しないため常に C-SPEC。
 * それ以外（ile / 未指定＝ルーラー表示）は先頭オペコードで C-NEW を判定する。
 */
function classifyCSpec(text, dialect) {
    if (dialect === "rpg3") {
        return "C-SPEC";
    }
    const tail = text.length > 6 ? text.slice(6) : "";
    const tokens = tail.trim().split(/\s+/u).filter(token => token.length > 0);
    const opcode = (tokens[0] ?? "").toUpperCase();
    return opcode && getCNewOpcodes().has(opcode) ? "C-NEW" : "C-SPEC";
}
/**
 * C 仕様の「新形式」オペコード集合（既定 + 設定 rpgClSupport.cNewOpcodes）。
 */
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
//# sourceMappingURL=specClassifier.js.map