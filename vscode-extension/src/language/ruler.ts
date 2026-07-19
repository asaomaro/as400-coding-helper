import * as vscode from "vscode";
import { isInScopeDocument, TARGET_EXTENSIONS } from "../utils/fileScope";
import {
  getRpgKeywordColumns,
  getClKeywordColumns,
  getDdsKeywordColumns
} from "./keywordColumns";
import { classifyRpgSpecKeyword } from "../prompter/specClassifier";
import { resolveDialect } from "../prompter/dialect";

/**
 * ルーラーの表示モード。クリックで off → ruler → full → off と循環する。
 * どのモードでも出すのは 1 行だけ（SEU も書式行は 1 行）。
 *   ruler … 目盛り（....+....1....+....2 …）
 *   full  … SEU の書式行（.....CL0N01N02N03Factor1+++Opcde… ）
 */
type RulerMode = "off" | "ruler" | "full";
const CYCLE: readonly RulerMode[] = ["off", "ruler", "full"];

const STATE_KEY = "rpgClSupport.ruler.mode";

/** ルーラー文字列の最小桁数（行が短くても最低この幅まで目盛りを出す）。 */
const MIN_WIDTH = 80;

/**
 * ルーラーは CodeLens で出す。
 *
 * 以前は装飾(::before)を position:absolute で浮かせていたが、Monaco の行は
 * 固定行高で絶対配置されるため、浮かせた分がそのまま上の行に重なりコードが
 * 隠れていた。CodeLens は行の上に実際の余白を確保する唯一の口で、
 * 差し込む形になるのでコードは隠れない。
 *
 * 代償として CodeLens の字体・字大が既定ではエディターと違う（字大は
 * editor.fontSize の 90%）。桁が合わないとルーラーの意味が無いので、
 * ずれている場合は起動時に一度だけ揃えるか尋ねる（checkCodeLensFont）。
 * 桁を保つため空白は改行なし空白(U+00A0)で出す。
 */
let statusBarItem: vscode.StatusBarItem | undefined;
let lensProvider: RulerCodeLensProvider | undefined;
let mode: RulerMode = "full";
/** mode がユーザー操作で確定済みか（false の間は設定 defaultMode に追従する）。 */
let modePinned = false;
let cachedRpgFieldLabels: Map<string, readonly string[]> | undefined;
const cachedFieldLabelsByKind = new Map<string, readonly string[]>();

export function registerRuler(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "rpgClSupport.ruler.cycleMode";

  context.subscriptions.push(statusBarItem);

  lensProvider = new RulerCodeLensProvider(context);

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
      refresh();
    }
  );

  const alignCommand = vscode.commands.registerCommand(
    "rpgClSupport.ruler.alignFont",
    () => alignCodeLensFont()
  );

  context.subscriptions.push(
    cycleCommand,
    alignCommand,
    // 対象拡張子だけに絞る（言語登録に依らないのは表示系の方針どおり）。
    vscode.languages.registerCodeLensProvider(
      { scheme: "file", pattern: `**/*.{${TARGET_EXTENSIONS.join(",")}}` },
      lensProvider
    ),
    vscode.window.onDidChangeActiveTextEditor(() => refresh()),
    // カーソル行が変われば書式行も変わる。SEU も現在行に対して出すため追従させる。
    vscode.window.onDidChangeTextEditorSelection(event => {
      if (event.textEditor === vscode.window.activeTextEditor) {
        refresh();
      }
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("rpgClSupport.ruler.defaultMode")) {
        if (!modePinned) {
          mode = readDefaultMode();
        }
        refresh();
      }
    })
  );

  refresh();
  void checkCodeLensFont(context);
}

/** ステータスバーと CodeLens を作り直す。 */
function refresh(): void {
  updateStatusBar();
  const editor = vscode.window.activeTextEditor;
  if (statusBarItem) {
    if (editor && isInScopeDocument(editor.document)) {
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  }
  lensProvider?.refresh();
}

const FONT_PROMPT_KEY = "rpgClSupport.ruler.codeLensFontPrompted";

/**
 * CodeLens の字大はエディターと別枠で、既定は editor.fontSize の 90%。
 * そのままだとルーラーの桁がコードと合わず、ルーラーの用をなさない。
 * 設定を勝手に書き換えるのは筋が悪いので、一度だけ尋ねる。
 */
/** 今の字体・字大を人が読める形にする（ずれの原因を目で確かめるため）。 */
function describeFonts(): string {
  const editorConfig = vscode.workspace.getConfiguration("editor");
  const lensFamily = editorConfig.get<string>("codeLensFontFamily");
  const lensSize = editorConfig.get<number>("codeLensFontSize");
  return [
    `エディター: ${editorConfig.get<string>("fontFamily")} / ${editorConfig.get<number>("fontSize")}px`,
    `CodeLens : ${lensFamily || "(未設定＝UI の字体。等幅ではない)"} / ${lensSize || "(未設定＝エディターの 90%)"}`
  ].join("\n");
}

function isCodeLensFontAligned(): boolean {
  const editorConfig = vscode.workspace.getConfiguration("editor");
  const fontSize = editorConfig.get<number>("fontSize");
  const lensFontSize = editorConfig.get<number>("codeLensFontSize");
  const fontFamily = editorConfig.get<string>("fontFamily");
  const lensFontFamily = editorConfig.get<string>("codeLensFontFamily");

  // codeLensFontSize は 0 が「editor.fontSize の 90%」、
  // codeLensFontFamily は空が「エディターの字体を継承」を意味する既定値。
  // 字大が 90% のままだと桁は必ずずれる。
  // 字体が未設定だと UI の字体（等幅ではない）で描かれ、桁は合わない。
  // 「未設定＝エディターを継承」ではないため、明示されていることまで要る。
  return (
    Boolean(fontSize) &&
    lensFontSize === fontSize &&
    Boolean(lensFontFamily) &&
    lensFontFamily === fontFamily
  );
}

/** CodeLens の字体・字大をエディターに合わせる。 */
async function alignCodeLensFont(): Promise<void> {
  const editorConfig = vscode.workspace.getConfiguration("editor");
  const fontSize = editorConfig.get<number>("fontSize");
  const fontFamily = editorConfig.get<string>("fontFamily");

  if (fontSize) {
    await editorConfig.update("codeLensFontSize", fontSize, vscode.ConfigurationTarget.Global);
  }
  if (fontFamily) {
    await editorConfig.update("codeLensFontFamily", fontFamily, vscode.ConfigurationTarget.Global);
  }

  refresh();
  void vscode.window.showInformationMessage(
    `ルーラーの桁をコードに合わせました（${fontFamily ?? "既定"} / ${fontSize ?? "既定"}px）。`
  );
}

async function checkCodeLensFont(context: vscode.ExtensionContext): Promise<void> {
  if (isCodeLensFontAligned() || context.globalState.get<boolean>(FONT_PROMPT_KEY)) {
    return;
  }

  const answer = await vscode.window.showWarningMessage(
    "ルーラーの桁がコードとずれます。CodeLens の字体・字大はエディターと別枠で、既定は文字の大きさが 90% になるためです。揃えますか？",
    "揃える",
    "後で"
  );

  // 答えを選ばずに閉じた場合(undefined)は「尋ねた」ことにしない。
  // 記録すると二度と出せず、ずれたまま気付けなくなる。
  if (answer === undefined) {
    return;
  }
  await context.globalState.update(FONT_PROMPT_KEY, true);

  if (answer === "揃える") {
    await alignCodeLensFont();
  }
}

function readDefaultMode(): RulerMode {
  const config = vscode.workspace.getConfiguration("rpgClSupport");
  const value = config.get<string>("ruler.defaultMode");
  if (value === "off" || value === "ruler" || value === "full") {
    return value;
  }
  return "full";
}

/**
 * ルーラーを CodeLens として現在行の上に差し込む。
 *
 * CodeLens は行の上に実際の余白を確保するので、コードは隠れない。
 * 出すのは常に 1 行だけ:
 *   mode "ruler" … 目盛り（....+....1....+....2 …）
 *   mode "full"  … SEU の書式行（.....CL0N01N02N03Factor1+++Opcde… ）
 */
class RulerCodeLensProvider implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  refresh(): void {
    this.changed.fire();
  }

  async provideCodeLenses(
    document: vscode.TextDocument
  ): Promise<vscode.CodeLens[]> {
    if (mode === "off" || !isInScopeDocument(document)) {
      return [];
    }

    // ルーラーはカーソル行に対して出す。別のエディターで開かれている同じ
    // 文書に出さないよう、アクティブなエディターの文書だけを見る。
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) {
      return [];
    }

    const line = editor.selection.active.line;
    const lineText = document.lineAt(line).text;
    const width = Math.max(MIN_WIDTH, lineText.length);

    const row =
      mode === "full"
        ? (await this.buildFormatRow(document, line, width)) ?? buildTensRow(width)
        : buildTensRow(width);

    const lens = new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
      title: toFixedPitch(trimToIndent(row, lineText, resolveTabSize(editor))),
      command: "rpgClSupport.ruler.cycleMode",
      tooltip: "クリックでルーラー表示を切替 (Off → Cols → Full)"
    });
    return [lens];
  }

  /** SEU の書式行。判定できなければ undefined（呼び側が目盛りに落とす）。 */
  private async buildFormatRow(
    document: vscode.TextDocument,
    line: number,
    width: number
  ): Promise<string | undefined> {
    const key = classifySpec(document, line);
    if (!key) {
      return undefined;
    }

    // RPG III は実機の書式行がそのまま使える（合成より正確）。
    if (resolveDialect(document) === "rpg3" && specFamily(document) === "rpg") {
      const template = await getSeuFormatLine(this.context, key, document, line);
      if (template) {
        return template.slice(0, width).padEnd(width, ".");
      }
    }

    const columns = await getColumnsForKey(this.context, key);
    if (!columns || columns.length === 0) {
      return undefined;
    }
    const labels = await getLabelsForKey(this.context, key);
    return buildSeuRow(columns, labels, width);
  }
}

/**
 * CodeLens はその行のインデントの位置から描かれる（左端からではない）。
 * 固定長ソースは先頭に空白が並ぶ（C 仕様なら 5 桁）ため、ルーラーをそのまま
 * 渡すとインデント分だけ右にずれる。ずれる分を先頭から落として、桁が実際の
 * 桁位置に来るようにする。
 *
 * 基準にするのは「実測したインデント」であって「あるべきインデント」ではない。
 * そのため、仕様書コードが誤った桁にある行でも画面上の桁は絶対桁と一致する
 * （インデントが 3 桁ならルーラーも 4 桁目の文字から出す＝4 桁目の位置に来る）。
 * ルーラーがコードの誤りに引きずられることはない。
 *
 * 代わりにインデント分の桁（固定長なら 1-5 桁の順序番号欄）はルーラーから
 * 欠ける。CodeLens を左に動かす手段が無いため、この手段を採る限り避けられない。
 *
 * 空白しか無い行はインデントの基準にならない（左端から描かれる）のでそのまま返す。
 */
export function trimToIndent(row: string, lineText: string, tabSize: number): string {
  if (lineText.trim().length === 0) {
    return row;
  }

  // タブは桁数と文字数が一致しないので、見た目の桁数に直してから落とす。
  const indent = /^[ \t]*/u.exec(lineText)?.[0] ?? "";
  let width = 0;
  for (const char of indent) {
    width = char === "\t" ? width + (tabSize - (width % tabSize)) : width + 1;
  }

  return width > 0 ? row.slice(width) : row;
}

/**
 * 桁を保つため、空白を改行なし空白(U+00A0)に置き換える。
 * CodeLens の表題は HTML として描かれるので、素の空白は詰められてしまう。
 */
/** タブ幅（インデントの見た目の桁数を出すのに要る）。 */
function resolveTabSize(editor: vscode.TextEditor): number {
  const size = editor.options.tabSize;
  return typeof size === "number" && size > 0 ? size : 4;
}

function toFixedPitch(row: string): string {
  return row.replace(/ /gu, "\u00a0");
}

function updateStatusBar(): void {
  if (!statusBarItem) {
    return;
  }
  const label =
    mode === "full" ? "Full" : mode === "ruler" ? "Cols" : "Off";
  // 桁がずれている間は警告を出し、クリックで直せるようにする。
  // 黙ってずれているのがいちばん困る（等幅でない字体だと桁は絶対に合わない）。
  const aligned = mode === "off" || isCodeLensFontAligned();
  statusBarItem.text = `$(ruler) Ruler: ${label}${aligned ? "" : " $(warning)"}`;
  statusBarItem.command = aligned
    ? "rpgClSupport.ruler.cycleMode"
    : "rpgClSupport.ruler.alignFont";
  statusBarItem.tooltip = aligned
    ? "クリックでルーラー表示を切替 (Off → Cols → Full)"
    : `ルーラーの桁がコードとずれています。クリックで揃えます。\n${describeFonts()}`;
}

/**
 * 目盛り段の文字列を生成する。1 始まりで 10 桁ごとに桁番号の下 1 桁、
 * 5 桁ごとに '+'、その他は '.'。
 */
export function buildTensRow(width: number): string {
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
 * SEU の書式行を欄の定義から組み立てる（RPG III 以外＝実機の書式行が無いもの）。
 *
 * SEU の書き方に合わせる:
 *   欄名はその欄の幅まで '+' で埋める（Factor 1 → `Factor1+++`）
 *   欄名の無いところは '.' で埋める
 *   欄名中の空白は詰める（SEU も `Factor1` と書く）
 */
export function buildSeuRow(
  columns: readonly number[],
  labels: readonly string[],
  width: number
): string {
  const cells = new Array<string>(width).fill(".");

  for (let i = 0; i < columns.length; i += 1) {
    const start = columns[i];
    if (start < 0 || start >= width) {
      continue;
    }

    const end = Math.min(i + 1 < columns.length ? columns[i + 1] : width, width);
    const room = end - start;
    if (room <= 0) {
      continue;
    }

    const label = (labels[i] ?? "").replace(/\s+/gu, "");
    if (label.length === 0) {
      continue; // '.' のまま
    }

    const text = label.slice(0, room).padEnd(room, "+");
    for (let j = 0; j < room; j += 1) {
      cells[start + j] = text.charAt(j);
    }
  }

  return cells.join("");
}

let cachedSeuFormatLines: Record<string, string> | undefined;

/**
 * RPG III の SEU 書式行を返す。出所は実機（resources/navigation）。
 *
 * O 仕様書だけは実機もレコード行とフィールド行で書式行が別なので、行を見て選ぶ。
 * レコード行は 7-14 桁にレコード名が入り、フィールド行はそこが空白になる。
 */
async function getSeuFormatLine(
  context: vscode.ExtensionContext,
  key: string,
  document: vscode.TextDocument,
  line: number
): Promise<string | undefined> {
  if (!cachedSeuFormatLines) {
    try {
      const uri = vscode.Uri.joinPath(
        context.extensionUri,
        "resources",
        "navigation",
        "rpg3-seu-format-lines.json"
      );
      const loaded = await vscode.workspace.openTextDocument(uri);
      const parsed = JSON.parse(loaded.getText()) as { templates?: Record<string, string> };
      cachedSeuFormatLines = parsed.templates ?? {};
    } catch (error) {
      console.log("[rpgClSupport] failed to load SEU format lines", String(error));
      cachedSeuFormatLines = {};
    }
  }

  if (key === "O-SPEC") {
    const text = document.lineAt(line).text;
    const hasRecordName = text.slice(6, 14).trim().length > 0;
    return cachedSeuFormatLines[hasRecordName ? "O-SPEC-RECORD" : "O-SPEC-FIELD"];
  }

  return cachedSeuFormatLines[key];
}


type SpecFamily = "rpg" | "cl" | "cmd" | "dds-pf" | "dds-dspf" | "dds-prtf" | "other";

function specFamily(document: vscode.TextDocument): SpecFamily {
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
  // .cmd はコマンド定義ソース。CL コマンドではないが、桁の使い方は同じ
  // （ラベル 1-13 / 文 14 / パラメータ 25）。原典に桁の規定は無く、
  // これは SEU の書き方であり、プロンプターが書き出す形でもある。
  if (/\.cmd$/u.test(lower)) {
    return "cmd";
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
function classifySpec(
  document: vscode.TextDocument,
  lineIndex: number
): string | undefined {
  const family = specFamily(document);

  if (family === "cl" || family === "cmd") {
    const text = document.lineAt(lineIndex).text;
    if (text.trim().length === 0) {
      return undefined;
    }
    // どちらも注記は /* */ で、桁で決まらないため行の中身では絞らない。
    return family === "cmd" ? "CMD" : "CL";
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
  const precedingLines: string[] = [];
  for (let above = 0; above < lineIndex; above += 1) {
    precedingLines.push(document.lineAt(above).text);
  }
  // dialect も渡す。RPG III は I/O をレイアウト別に分けていないため、
  // ここで取り違えるとルーラーが出なくなる。
  return classifyRpgSpecKeyword(text, resolveDialect(document), precedingLines);
}

async function getColumnsForKey(
  context: vscode.ExtensionContext,
  key: string
): Promise<readonly number[] | undefined> {
  if (key === "CL" || key === "CMD") {
    return getClKeywordColumns(context, key);
  }
  if (key.startsWith("DDS-")) {
    return (await getDdsKeywordColumns(context)).get(key);
  }
  const map = await getRpgKeywordColumns(context);
  return map.get(key);
}

async function getLabelsForKey(
  context: vscode.ExtensionContext,
  key: string
): Promise<readonly string[]> {
  if (key === "CL" || key === "CMD") {
    return getClFieldLabels(context, key);
  }
  if (key.startsWith("DDS-")) {
    return (await getDdsFieldLabels(context)).get(key) ?? [];
  }
  const map = await getRpgFieldLabels(context);
  return map.get(key) ?? [];
}

let cachedDdsFieldLabels: Map<string, readonly string[]> | undefined;

/** DDS の欄名を読み込む（種別 → 欄名の配列）。真実源は resources/navigation。 */
async function getDdsFieldLabels(
  context: vscode.ExtensionContext
): Promise<Map<string, readonly string[]>> {
  if (cachedDdsFieldLabels) {
    return cachedDdsFieldLabels;
  }

  const map = new Map<string, readonly string[]>();
  try {
    const uri = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "navigation",
      "dds-field-labels.json"
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const parsed = JSON.parse(document.getText()) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        map.set(key.toUpperCase(), value.map(String));
      }
    }
  } catch (error) {
    console.log("[rpgClSupport] failed to load DDS field labels", String(error));
  }

  cachedDdsFieldLabels = map;
  return map;
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
  context: vscode.ExtensionContext,
  kind: "CL" | "CMD" = "CL"
): Promise<readonly string[]> {
  const cached = cachedFieldLabelsByKind.get(kind);
  if (cached) {
    return cached;
  }

  let labels: readonly string[] = [];
  try {
    const uri = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "navigation",
      kind === "CMD" ? "cmd-field-labels.json" : "cl-field-labels.json"
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

  cachedFieldLabelsByKind.set(kind, labels);
  return labels;
}
