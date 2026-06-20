import * as vscode from "vscode";
import { isInScopeDocument } from "../utils/fileScope";
import { getRpgKeywordColumns, getClKeywordColumns } from "./keywordColumns";

/** ルーラーの表示モード。クリックで off → ruler → full → off と循環する。 */
type RulerMode = "off" | "ruler" | "full";
const CYCLE: readonly RulerMode[] = ["off", "ruler", "full"];

const STATE_KEY = "rpgClSupport.ruler.mode";

/** ルーラー文字列の最小桁数（行が短くても最低この幅まで目盛りを出す）。 */
const MIN_WIDTH = 80;

/**
 * CSS で浮かせる際の上方向オフセット（行高基準・em）。
 * 直上行への重なりを最小化しつつ視認できる値。実値は実機で調整可能（spec 未確定点）。
 */
const TOP_UPPER = "-2.4em"; // 目盛り段（full 時はコードの概ね 2 行上）
const TOP_LOWER = "-1.2em"; // 境界段 / ruler 時の目盛り段（概ね 1 行上）

let tensDecoration: vscode.TextEditorDecorationType | undefined;
let fieldsDecoration: vscode.TextEditorDecorationType | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let mode: RulerMode = "full";
/** mode がユーザー操作で確定済みか（false の間は設定 defaultMode に追従する）。 */
let modePinned = false;
/** 非同期更新の世代カウンタ（古い境界段適用を捨てるため）。 */
let updateToken = 0;

let cachedRpgFieldLabels: Map<string, readonly string[]> | undefined;
let cachedClFieldLabels: readonly string[] | undefined;

export function registerRuler(context: vscode.ExtensionContext): void {
  tensDecoration = vscode.window.createTextEditorDecorationType({});
  fieldsDecoration = vscode.window.createTextEditorDecorationType({});

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "rpgClSupport.ruler.cycleMode";

  context.subscriptions.push(tensDecoration, fieldsDecoration, statusBarItem);

  // 初期モード: 保存値があればそれ、無ければ設定 defaultMode。
  const stored = context.workspaceState.get<RulerMode>(STATE_KEY);
  if (stored && CYCLE.includes(stored)) {
    mode = stored;
    modePinned = true;
  } else {
    mode = readDefaultMode();
    modePinned = false;
  }

  const cycleCommand = vscode.commands.registerCommand(
    "rpgClSupport.ruler.cycleMode",
    async () => {
      const index = CYCLE.indexOf(mode);
      mode = CYCLE[(index + 1) % CYCLE.length];
      modePinned = true;
      await context.workspaceState.update(STATE_KEY, mode);
      void updateForEditor(vscode.window.activeTextEditor, context);
    }
  );

  context.subscriptions.push(
    cycleCommand,
    vscode.window.onDidChangeActiveTextEditor(editor => {
      void updateForEditor(editor ?? undefined, context);
    }),
    vscode.window.onDidChangeTextEditorSelection(event => {
      void updateForEditor(event.textEditor, context);
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && event.document === activeEditor.document) {
        void updateForEditor(activeEditor, context);
      }
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("rpgClSupport.ruler.defaultMode")) {
        if (!modePinned) {
          mode = readDefaultMode();
        }
        void updateForEditor(vscode.window.activeTextEditor, context);
      }
    })
  );

  void updateForEditor(vscode.window.activeTextEditor, context);
}

function readDefaultMode(): RulerMode {
  const config = vscode.workspace.getConfiguration("rpgClSupport");
  const value = config.get<string>("ruler.defaultMode");
  if (value === "off" || value === "ruler" || value === "full") {
    return value;
  }
  return "full";
}

async function updateForEditor(
  editor: vscode.TextEditor | undefined,
  context: vscode.ExtensionContext
): Promise<void> {
  if (!tensDecoration || !fieldsDecoration || !statusBarItem) {
    return;
  }

  const token = (updateToken += 1);

  if (!editor || !isInScopeDocument(editor.document)) {
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

function clearAll(editor: vscode.TextEditor | undefined): void {
  if (!editor || !tensDecoration || !fieldsDecoration) {
    return;
  }
  editor.setDecorations(tensDecoration, []);
  editor.setDecorations(fieldsDecoration, []);
}

function setFloating(
  editor: vscode.TextEditor,
  type: vscode.TextEditorDecorationType,
  range: vscode.Range,
  contentText: string,
  top: string
): void {
  const css =
    `none; position: absolute; top: ${top}; left: 0; white-space: pre; ` +
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

function updateStatusBar(): void {
  if (!statusBarItem) {
    return;
  }
  const label =
    mode === "full" ? "Full" : mode === "ruler" ? "Cols" : "Off";
  statusBarItem.text = `$(ruler) Ruler: ${label}`;
  statusBarItem.tooltip =
    "クリックでルーラー表示を切替 (Off → Cols → Full)";
}

/**
 * 目盛り段の文字列を生成する。1 始まりで 10 桁ごとに桁番号の下 1 桁、
 * 5 桁ごとに '+'、その他は '.'。
 */
function buildTensRow(width: number): string {
  const chars: string[] = [];
  for (let column = 1; column <= width; column += 1) {
    if (column % 10 === 0) {
      chars.push(String(Math.floor(column / 10) % 10));
    } else if (column % 5 === 0) {
      chars.push("+");
    } else {
      chars.push(".");
    }
  }
  return chars.join("");
}

/**
 * 境界段の文字列を生成する。境界（0-indexed 昇順）で区切られた各区間の先頭に
 * 区切り '|' を置き、対応ラベルを左寄せ（区間幅で切り詰め）で描画する。
 */
function buildFieldsRow(
  columns: readonly number[],
  labels: readonly string[],
  width: number
): string {
  const cells = new Array<string>(width).fill(" ");

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

type SpecFamily = "rpg" | "cl" | "other";

function specFamily(document: vscode.TextDocument): SpecFamily {
  const languageId = document.languageId;
  if (languageId === "rpg-fixed") {
    return "rpg";
  }
  if (languageId === "cl") {
    return "cl";
  }

  const lower = document.uri.fsPath.toLowerCase();
  if (lower.endsWith(".rpgle") || lower.endsWith(".rpg")) {
    return "rpg";
  }
  if (lower.endsWith(".clp")) {
    return "cl";
  }
  return "other";
}

/**
 * フォーカス行のスペック種別を判定する。
 * RPG 固定は 6 桁目（index 5）のスペック文字、C は新旧を cNewOpcodes で判定。
 * 判定できない場合（コメント・空行・対象外）は undefined。
 */
function classifySpec(
  document: vscode.TextDocument,
  lineIndex: number
): string | undefined {
  const family = specFamily(document);

  if (family === "cl") {
    const text = document.lineAt(lineIndex).text;
    return text.trim().length > 0 ? "CL" : undefined;
  }

  if (family !== "rpg") {
    return undefined; // DDS/DSPF/PRTF/CMD 等は目盛り段のみ
  }

  const text = document.lineAt(lineIndex).text;
  if (text.length < 6) {
    return undefined;
  }

  // 7 桁目（index 6）が '*' のコメント行は種別なし。
  if (text.length > 6 && text.charAt(6) === "*") {
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
    case "O":
      return "O-SPEC";
    case "P":
      return "P-SPEC";
    case "C":
      return classifyCSpec(text);
    default:
      return undefined;
  }
}

function classifyCSpec(text: string): string {
  const tail = text.length > 6 ? text.slice(6) : "";
  const tokens = tail.trim().split(/\s+/u).filter(token => token.length > 0);
  const opcode = (tokens[0] ?? "").toUpperCase();
  return opcode && getCNewOpcodes().has(opcode) ? "C-NEW" : "C-SPEC";
}

/**
 * C 仕様の「新形式」オペコード集合。positionResolver と同じ規約
 * （既定 + 設定 rpgClSupport.cNewOpcodes）を共有する。
 */
function getCNewOpcodes(): Set<string> {
  const defaults = new Set<string>([
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
  const configured = config.get<unknown>("cNewOpcodes");
  if (Array.isArray(configured)) {
    for (const value of configured) {
      if (typeof value === "string" && value.trim().length > 0) {
        defaults.add(value.trim().toUpperCase());
      }
    }
  }

  return defaults;
}

async function getColumnsForKey(
  context: vscode.ExtensionContext,
  key: string
): Promise<readonly number[] | undefined> {
  if (key === "CL") {
    return getClKeywordColumns(context);
  }
  const map = await getRpgKeywordColumns(context);
  return map.get(key);
}

async function getLabelsForKey(
  context: vscode.ExtensionContext,
  key: string
): Promise<readonly string[]> {
  if (key === "CL") {
    return getClFieldLabels(context);
  }
  const map = await getRpgFieldLabels(context);
  return map.get(key) ?? [];
}

async function getRpgFieldLabels(
  context: vscode.ExtensionContext
): Promise<Map<string, readonly string[]>> {
  if (cachedRpgFieldLabels) {
    return cachedRpgFieldLabels;
  }

  const map = new Map<string, readonly string[]>();
  try {
    const uri = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "navigation",
      "rpg-fixed-field-labels.json"
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const parsed = JSON.parse(document.getText()) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        map.set(
          key.toUpperCase(),
          value.map(item => (typeof item === "string" ? item : ""))
        );
      }
    }
  } catch (error) {
    console.log(
      "[rpgClSupport] failed to load RPG field label definitions",
      String(error)
    );
  }

  cachedRpgFieldLabels = map;
  return map;
}

async function getClFieldLabels(
  context: vscode.ExtensionContext
): Promise<readonly string[]> {
  if (cachedClFieldLabels) {
    return cachedClFieldLabels;
  }

  let labels: readonly string[] = [];
  try {
    const uri = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "navigation",
      "cl-field-labels.json"
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const parsed = JSON.parse(document.getText()) as unknown;
    if (Array.isArray(parsed)) {
      labels = parsed.map(item => (typeof item === "string" ? item : ""));
    }
  } catch (error) {
    console.log(
      "[rpgClSupport] failed to load CL field label definitions",
      String(error)
    );
  }

  cachedClFieldLabels = labels;
  return labels;
}
