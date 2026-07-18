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
exports.registerRuler = registerRuler;
const vscode = __importStar(require("vscode"));
const fileScope_1 = require("../utils/fileScope");
const keywordColumns_1 = require("./keywordColumns");
const specClassifier_1 = require("../prompter/specClassifier");
const dialect_1 = require("../prompter/dialect");
const CYCLE = ["off", "ruler", "full"];
const STATE_KEY = "rpgClSupport.ruler.mode";
/** ルーラー文字列の最小桁数（行が短くても最低この幅まで目盛りを出す）。 */
const MIN_WIDTH = 80;
/**
 * CSS で浮かせる際の上方向オフセット（行高基準・em）。
 * 直上行への重なりを最小化しつつ視認できる値。実値は実機で調整可能（spec 未確定点）。
 */
const TOP_UPPER = "-2.4em"; // 目盛り段（full 時はコードの概ね 2 行上）
const TOP_LOWER = "-1.2em"; // 境界段 / ruler 時の目盛り段（概ね 1 行上）
let tensDecoration;
let fieldsDecoration;
let statusBarItem;
let mode = "full";
/** mode がユーザー操作で確定済みか（false の間は設定 defaultMode に追従する）。 */
let modePinned = false;
/** 非同期更新の世代カウンタ（古い境界段適用を捨てるため）。 */
let updateToken = 0;
let cachedRpgFieldLabels;
let cachedClFieldLabels;
function registerRuler(context) {
    tensDecoration = vscode.window.createTextEditorDecorationType({});
    fieldsDecoration = vscode.window.createTextEditorDecorationType({});
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = "rpgClSupport.ruler.cycleMode";
    context.subscriptions.push(tensDecoration, fieldsDecoration, statusBarItem);
    // 初期モード: 保存値があればそれ、無ければ設定 defaultMode。
    const stored = context.workspaceState.get(STATE_KEY);
    if (stored && CYCLE.includes(stored)) {
        mode = stored;
        modePinned = true;
    }
    else {
        mode = readDefaultMode();
        modePinned = false;
    }
    const cycleCommand = vscode.commands.registerCommand("rpgClSupport.ruler.cycleMode", async () => {
        const index = CYCLE.indexOf(mode);
        mode = CYCLE[(index + 1) % CYCLE.length];
        modePinned = true;
        await context.workspaceState.update(STATE_KEY, mode);
        void updateForEditor(vscode.window.activeTextEditor, context);
    });
    context.subscriptions.push(cycleCommand, vscode.window.onDidChangeActiveTextEditor(editor => {
        void updateForEditor(editor ?? undefined, context);
    }), vscode.window.onDidChangeTextEditorSelection(event => {
        void updateForEditor(event.textEditor, context);
    }), vscode.workspace.onDidChangeTextDocument(event => {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && event.document === activeEditor.document) {
            void updateForEditor(activeEditor, context);
        }
    }), vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("rpgClSupport.ruler.defaultMode")) {
            if (!modePinned) {
                mode = readDefaultMode();
            }
            void updateForEditor(vscode.window.activeTextEditor, context);
        }
    }));
    void updateForEditor(vscode.window.activeTextEditor, context);
}
function readDefaultMode() {
    const config = vscode.workspace.getConfiguration("rpgClSupport");
    const value = config.get("ruler.defaultMode");
    if (value === "off" || value === "ruler" || value === "full") {
        return value;
    }
    return "full";
}
async function updateForEditor(editor, context) {
    if (!tensDecoration || !fieldsDecoration || !statusBarItem) {
        return;
    }
    const token = (updateToken += 1);
    if (!editor || !(0, fileScope_1.isInScopeDocument)(editor.document)) {
        clearAll(editor);
        statusBarItem.hide();
        return;
    }
    updateStatusBar();
    statusBarItem.show();
    if (mode === "off") {
        clearAll(editor);
        return;
    }
    const { document } = editor;
    const line = editor.selection.active.line;
    const lineText = document.lineAt(line).text;
    const width = Math.max(MIN_WIDTH, lineText.length);
    const range = new vscode.Range(line, 0, line, 0);
    // 目盛り段: full 時は上段、ruler 時はコード寄りの 1 段上。
    const tensTop = mode === "full" ? TOP_UPPER : TOP_LOWER;
    setFloating(editor, tensDecoration, range, buildTensRow(width), tensTop);
    if (mode !== "full") {
        editor.setDecorations(fieldsDecoration, []);
        return;
    }
    const key = classifySpec(document, line);
    if (!key) {
        editor.setDecorations(fieldsDecoration, []);
        return;
    }
    const columns = await getColumnsForKey(context, key);
    if (token !== updateToken) {
        return; // 別の更新が走った
    }
    if (!columns || columns.length === 0) {
        editor.setDecorations(fieldsDecoration, []);
        return;
    }
    const labels = await getLabelsForKey(context, key);
    if (token !== updateToken) {
        return;
    }
    const fieldsRow = buildFieldsRow(columns, labels, width);
    setFloating(editor, fieldsDecoration, range, fieldsRow, TOP_LOWER);
}
function clearAll(editor) {
    if (!editor || !tensDecoration || !fieldsDecoration) {
        return;
    }
    editor.setDecorations(tensDecoration, []);
    editor.setDecorations(fieldsDecoration, []);
}
function setFloating(editor, type, range, contentText, top) {
    const css = `none; position: absolute; top: ${top}; left: 0; white-space: pre; ` +
        `z-index: 2; pointer-events: none; padding: 0 2px; border-radius: 2px;`;
    editor.setDecorations(type, [
        {
            range,
            renderOptions: {
                before: {
                    contentText,
                    color: new vscode.ThemeColor("editorCodeLens.foreground"),
                    backgroundColor: new vscode.ThemeColor("editor.background"),
                    textDecoration: css
                }
            }
        }
    ]);
}
function updateStatusBar() {
    if (!statusBarItem) {
        return;
    }
    const label = mode === "full" ? "Full" : mode === "ruler" ? "Cols" : "Off";
    statusBarItem.text = `$(ruler) Ruler: ${label}`;
    statusBarItem.tooltip =
        "クリックでルーラー表示を切替 (Off → Cols → Full)";
}
/**
 * 目盛り段の文字列を生成する。1 始まりで 10 桁ごとに桁番号の下 1 桁、
 * 5 桁ごとに '+'、その他は '.'。
 */
function buildTensRow(width) {
    const chars = [];
    for (let column = 1; column <= width; column += 1) {
        if (column % 10 === 0) {
            chars.push(String(Math.floor(column / 10) % 10));
        }
        else if (column % 5 === 0) {
            chars.push("+");
        }
        else {
            chars.push(".");
        }
    }
    return chars.join("");
}
/**
 * 境界段の文字列を生成する。境界（0-indexed 昇順）で区切られた各区間の先頭に
 * 区切り '|' を置き、対応ラベルを左寄せ（区間幅で切り詰め）で描画する。
 */
function buildFieldsRow(columns, labels, width) {
    const cells = new Array(width).fill(" ");
    for (let i = 0; i < columns.length; i += 1) {
        const start = columns[i];
        if (start < 0 || start >= width) {
            continue;
        }
        const end = i + 1 < columns.length ? columns[i + 1] : width;
        cells[start] = "|";
        const label = labels[i] ?? "";
        if (label.length > 0) {
            const room = end - start - 1; // 区切り '|' の右側に書ける幅
            const text = label.slice(0, Math.max(0, room));
            for (let j = 0; j < text.length; j += 1) {
                const pos = start + 1 + j;
                if (pos < width) {
                    cells[pos] = text.charAt(j);
                }
            }
        }
    }
    return cells.join("");
}
function specFamily(document) {
    const languageId = document.languageId;
    if (languageId === "rpg-fixed") {
        return "rpg";
    }
    if (languageId === "cl") {
        return "cl";
    }
    const lower = document.uri.fsPath.toLowerCase();
    // SQL 組み込み(.sqlrpgle/.sqlrpg)も固定長 RPG、ILE CL(.clle)も CL。
    // 拡張子を1つずつ書くと追加漏れが起きるため、末尾一致でまとめて判定する。
    if (/\.(sqlrpgle|rpgle|sqlrpg|rpg)$/u.test(lower)) {
        return "rpg";
    }
    if (/\.(clle|clp)$/u.test(lower)) {
        return "cl";
    }
    // DDS は同じ A 仕様書でも用途で桁の意味が変わるため、拡張子で種別まで決める。
    if (/\.(pf|lf)$/u.test(lower)) {
        return "dds-pf";
    }
    if (/\.(dspf|mnudds)$/u.test(lower)) {
        return "dds-dspf";
    }
    if (/\.(prtf)$/u.test(lower)) {
        return "dds-prtf";
    }
    return "other";
}
/**
 * フォーカス行のスペック種別を判定する。
 * RPG 固定は 6 桁目（index 5）のスペック文字、C は新旧を cNewOpcodes で判定。
 * 判定できない場合（コメント・空行・対象外）は undefined。
 */
function classifySpec(document, lineIndex) {
    const family = specFamily(document);
    if (family === "cl") {
        const text = document.lineAt(lineIndex).text;
        return text.trim().length > 0 ? "CL" : undefined;
    }
    if (family.startsWith("dds-")) {
        const text = document.lineAt(lineIndex).text;
        if (text.trim().length === 0) {
            return undefined;
        }
        // 7 桁目が '*' の注記行は桁ラベルを出さない（8-80 桁が本文になるため）。
        if (text.length > 6 && text.charAt(6) === "*") {
            return undefined;
        }
        return family.toUpperCase(); // DDS-PF / DDS-DSPF / DDS-PRTF
    }
    if (family !== "rpg") {
        return undefined; // CMD 等は目盛り段のみ
    }
    const text = document.lineAt(lineIndex).text;
    if (text.length < 6) {
        return undefined;
    }
    // 7 桁目（index 6）が '*' のコメント行は種別なし。
    if (text.length > 6 && text.charAt(6) === "*") {
        return undefined;
    }
    // スペック種別判定は specClassifier に集約（positionResolver と共有＝ドリフト防止）。
    // ルーラー表示は dialect を渡さない（C は従来どおりオペコードで新旧判定）が、
    // I/O 仕様書の記述種別は F 仕様書（22 桁目）で決まるため前の行は渡す。
    // 渡さないとルーラーとプロンプターで別の桁を表示してしまう。
    const precedingLines = [];
    for (let above = 0; above < lineIndex; above += 1) {
        precedingLines.push(document.lineAt(above).text);
    }
    // dialect も渡す。RPG III は I/O をレイアウト別に分けていないため、
    // ここで取り違えるとルーラーが出なくなる。
    return (0, specClassifier_1.classifyRpgSpecKeyword)(text, (0, dialect_1.resolveDialect)(document), precedingLines);
}
async function getColumnsForKey(context, key) {
    if (key === "CL") {
        return (0, keywordColumns_1.getClKeywordColumns)(context);
    }
    if (key.startsWith("DDS-")) {
        return (await (0, keywordColumns_1.getDdsKeywordColumns)(context)).get(key);
    }
    const map = await (0, keywordColumns_1.getRpgKeywordColumns)(context);
    return map.get(key);
}
async function getLabelsForKey(context, key) {
    if (key === "CL") {
        return getClFieldLabels(context);
    }
    if (key.startsWith("DDS-")) {
        return (await getDdsFieldLabels(context)).get(key) ?? [];
    }
    const map = await getRpgFieldLabels(context);
    return map.get(key) ?? [];
}
let cachedDdsFieldLabels;
/** DDS の欄名を読み込む（種別 → 欄名の配列）。真実源は resources/navigation。 */
async function getDdsFieldLabels(context) {
    if (cachedDdsFieldLabels) {
        return cachedDdsFieldLabels;
    }
    const map = new Map();
    try {
        const uri = vscode.Uri.joinPath(context.extensionUri, "resources", "navigation", "dds-field-labels.json");
        const document = await vscode.workspace.openTextDocument(uri);
        const parsed = JSON.parse(document.getText());
        for (const [key, value] of Object.entries(parsed)) {
            if (Array.isArray(value)) {
                map.set(key.toUpperCase(), value.map(String));
            }
        }
    }
    catch (error) {
        console.log("[rpgClSupport] failed to load DDS field labels", String(error));
    }
    cachedDdsFieldLabels = map;
    return map;
}
async function getRpgFieldLabels(context) {
    if (cachedRpgFieldLabels) {
        return cachedRpgFieldLabels;
    }
    const map = new Map();
    try {
        const uri = vscode.Uri.joinPath(context.extensionUri, "resources", "navigation", "rpg-fixed-field-labels.json");
        const document = await vscode.workspace.openTextDocument(uri);
        const parsed = JSON.parse(document.getText());
        for (const [key, value] of Object.entries(parsed)) {
            if (Array.isArray(value)) {
                map.set(key.toUpperCase(), value.map(item => (typeof item === "string" ? item : "")));
            }
        }
    }
    catch (error) {
        console.log("[rpgClSupport] failed to load RPG field label definitions", String(error));
    }
    cachedRpgFieldLabels = map;
    return map;
}
async function getClFieldLabels(context) {
    if (cachedClFieldLabels) {
        return cachedClFieldLabels;
    }
    let labels = [];
    try {
        const uri = vscode.Uri.joinPath(context.extensionUri, "resources", "navigation", "cl-field-labels.json");
        const document = await vscode.workspace.openTextDocument(uri);
        const parsed = JSON.parse(document.getText());
        if (Array.isArray(parsed)) {
            labels = parsed.map(item => (typeof item === "string" ? item : ""));
        }
    }
    catch (error) {
        console.log("[rpgClSupport] failed to load CL field label definitions", String(error));
    }
    cachedClFieldLabels = labels;
    return labels;
}
//# sourceMappingURL=ruler.js.map