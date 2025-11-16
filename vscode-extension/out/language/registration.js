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
exports.registerLanguageFeatures = registerLanguageFeatures;
const vscode = __importStar(require("vscode"));
const diagnostics_1 = require("./diagnostics");
const rpgCommentToggle_1 = require("./rpgCommentToggle");
const clCommentToggle_1 = require("./clCommentToggle");
const rpgTabNavigation_1 = require("./rpgTabNavigation");
const dbcsShiftMarkers_1 = require("./dbcsShiftMarkers");
let diagnosticsInstance;
function registerLanguageFeatures(context) {
    if (!diagnosticsInstance) {
        diagnosticsInstance = new diagnostics_1.RpgClDiagnostics();
        diagnosticsInstance.register(context);
    }
    const selector = [
        { language: "rpg-fixed", scheme: "file" },
        { language: "cl", scheme: "file" }
    ];
    const disposable = vscode.languages.registerHoverProvider(selector, {
        provideHover(_document, _position) {
            return undefined;
        }
    });
    context.subscriptions.push(disposable);
    (0, rpgCommentToggle_1.registerRpgCommentToggle)(context);
    (0, clCommentToggle_1.registerClCommentToggle)(context);
    (0, rpgTabNavigation_1.registerRpgTabNavigation)(context);
    (0, dbcsShiftMarkers_1.registerDbcsShiftMarkers)(context);
}
//# sourceMappingURL=registration.js.map