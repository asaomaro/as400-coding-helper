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
exports.RpgClDiagnostics = void 0;
const vscode = __importStar(require("vscode"));
const fileScope_1 = require("../utils/fileScope");
const clParser_1 = require("./clParser");
class RpgClDiagnostics {
    collection;
    constructor() {
        this.collection = vscode.languages.createDiagnosticCollection("rpgClSupport");
    }
    register(context) {
        context.subscriptions.push(this.collection);
        context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => this.refresh(document)), vscode.workspace.onDidChangeTextDocument(event => this.refresh(event.document)), vscode.workspace.onDidCloseTextDocument(document => this.collection.delete(document.uri)));
    }
    refresh(document) {
        if (!(0, fileScope_1.isInScopeDocument)(document)) {
            return;
        }
        let diagnostics = [];
        if (document.languageId === "cl" ||
            document.uri.fsPath.toLowerCase().endsWith(".clp")) {
            diagnostics = (0, clParser_1.parseClDocument)(document);
        }
        this.collection.set(document.uri, diagnostics);
    }
}
exports.RpgClDiagnostics = RpgClDiagnostics;
//# sourceMappingURL=diagnostics.js.map