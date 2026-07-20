import * as vscode from "vscode";
import { resolvePrtfLayout, type PrtfPage } from "../core/dds/prtfLayout";
import {
  hasExplicitRow,
  writeBackPosition
} from "../core/dds/prtfWriteBack";
import { buildPrtfPreviewHtml } from "./prtfPreviewHtml";

/**
 * 帳票（PRTF）プレビューの vscode 側の殻。
 *
 * レイアウト解決と HTML 生成は `core/dds` と `prtfPreviewHtml` にあり、
 * ここは VSCode との出入りだけを持つ。
 *
 * ■ ソースが唯一の真実
 *   WebView に配置状態を持たせない。文書が変わるたびに解決し直して
 *   HTML を作り直す。利用者はプレビューを開いたままソースを直接編集できるので、
 *   状態を 2 か所に持つと必ず食い違う。
 *
 * ■ IBM i Renderer と共存する
 *   言語登録をせず**拡張子で判定**し、コマンドも別にする（PJ の既定方針）。
 *   あちらは `dds.prtf` の languageId で発火するので、両方入っていても
 *   互いのコマンドは衝突しない。
 */

const CONFIG_SECTION = "rpgClSupport";
const VIEW_TYPE = "rpgClSupport.prtfPreview";

interface PreviewSession {
  readonly panel: vscode.WebviewPanel;
  readonly document: vscode.TextDocument;
}

let session: PreviewSession | undefined;

function isPrtf(document: vscode.TextDocument): boolean {
  return document.uri.fsPath.toLowerCase().endsWith(".prtf");
}

function resolvePage(): PrtfPage | undefined {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const rows = config.get<number>("prtf.pageLength");
  const columns = config.get<number>("prtf.pageWidth");
  const overflowLine = config.get<number>("prtf.overflowLine");
  const page: Partial<PrtfPage> = {};
  if (typeof rows === "number" && rows > 0) Object.assign(page, { rows });
  if (typeof columns === "number" && columns > 0) Object.assign(page, { columns });
  if (typeof overflowLine === "number" && overflowLine > 0) {
    Object.assign(page, { overflowLine });
  }
  return Object.keys(page).length > 0 ? (page as PrtfPage) : undefined;
}

function documentLines(document: vscode.TextDocument): string[] {
  const lines: string[] = [];
  for (let index = 0; index < document.lineCount; index += 1) {
    lines.push(document.lineAt(index).text);
  }
  return lines;
}

function render(current: PreviewSession): void {
  const activeLine =
    vscode.window.activeTextEditor?.document === current.document
      ? vscode.window.activeTextEditor.selection.active.line + 1
      : undefined;

  const layout = resolvePrtfLayout(documentLines(current.document), {
    ...(resolvePage() ? { page: resolvePage() } : {})
  });

  current.panel.webview.html = buildPrtfPreviewHtml(layout, {
    cspSource: current.panel.webview.cspSource,
    nonce: createNonce(),
    title: current.document.uri.fsPath.split(/[\\/]/u).pop() ?? "PRTF",
    ...(activeLine !== undefined ? { activeSourceLine: activeLine } : {})
  });
}

/** 画面から項目を動かしたときの書き戻し。 */
async function moveItem(
  current: PreviewSession,
  sourceLine: number,
  row: number,
  column: number
): Promise<void> {
  const index = sourceLine - 1;
  if (index < 0 || index >= current.document.lineCount) {
    void vscode.window.showWarningMessage(
      "ソースが変わっています。プレビューを開き直してください。"
    );
    return;
  }

  const original = current.document.lineAt(index).text;

  // 元々位置欄に行番号が無かった項目に絶対行を書くと、
  // 「順序と SPACE/SKIP で流れる帳票」が「固定行の帳票」に変質する。
  if (!hasExplicitRow(original)) {
    const answer = await vscode.window.showWarningMessage(
      `${sourceLine} 行目は行番号を使わず SPACE/SKIP で流れています。` +
        "行番号を書くと意味が変わり、原典では SPACE/SKIP が無効になります。続けますか。",
      { modal: true },
      "行番号を書く",
      "桁だけ変える"
    );
    if (answer === undefined) return;
    if (answer === "桁だけ変える") {
      await applyLine(current, index, writeBackPosition({ line: original, column }));
      return;
    }
  }

  await applyLine(current, index, writeBackPosition({ line: original, row, column }));
}

async function applyLine(
  current: PreviewSession,
  index: number,
  text: string
): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    current.document.uri,
    current.document.lineAt(index).range,
    text
  );
  await vscode.workspace.applyEdit(edit);
}

function openPreview(document: vscode.TextDocument): void {
  if (session) {
    session.panel.dispose();
    session = undefined;
  }

  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    "帳票プレビュー",
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const current: PreviewSession = { panel, document };
  session = current;

  panel.onDidDispose(() => {
    if (session === current) session = undefined;
  });

  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (typeof message !== "object" || message === null) return;
    const payload = message as {
      type?: string;
      sourceLine?: number;
      row?: number;
      column?: number;
    };

    if (payload.type === "reveal" && typeof payload.sourceLine === "number") {
      const position = new vscode.Position(Math.max(0, payload.sourceLine - 1), 0);
      const editor = await vscode.window.showTextDocument(current.document, {
        preserveFocus: false,
        viewColumn: vscode.ViewColumn.One
      });
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
      return;
    }

    if (
      payload.type === "move" &&
      typeof payload.sourceLine === "number" &&
      typeof payload.row === "number" &&
      typeof payload.column === "number"
    ) {
      await moveItem(current, payload.sourceLine, payload.row, payload.column);
    }
  });

  render(current);
}

export function registerPrtfPreview(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("rpgClSupport.showPrtfPreview", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isPrtf(editor.document)) {
        void vscode.window.showInformationMessage(
          "帳票プレビューは .prtf のファイルで実行してください。"
        );
        return;
      }
      openPreview(editor.document);
    })
  );

  // ソースが唯一の真実。変更のたびに解決し直す。
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      if (session && event.document === session.document) render(session);
    }),
    vscode.workspace.onDidCloseTextDocument(document => {
      if (session && document === session.document) {
        session.panel.dispose();
        session = undefined;
      }
    }),
    vscode.window.onDidChangeTextEditorSelection(event => {
      if (session && event.textEditor.document === session.document) {
        render(session);
      }
    })
  );
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
