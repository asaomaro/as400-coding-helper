import * as vscode from "vscode";
import { resolveDspfLayout } from "../core/dds/dspfLayout";
import { writeBackPosition } from "../core/dds/ddsPositionWriteBack";
import { resolveDdsType } from "../core/sourceKind";
import { buildDspfPreviewHtml } from "./dspfPreviewHtml";

/**
 * 画面（DSPF）プレビューの vscode 側の殻。
 *
 * レイアウト解決と HTML 生成は `core/dds` と `dspfPreviewHtml` にあり、
 * ここは VSCode との出入りだけを持つ（帳票プレビューと同じ形）。
 *
 * ■ ソースが唯一の真実
 *   WebView に配置状態を持たせない。文書が変わるたびに解決し直して
 *   HTML を作り直す。
 *
 * ■ IBM i Renderer と共存する
 *   あちらは DSPF のスクリーン・デザイナーを持つので、名前の衝突回避は
 *   帳票より重要になる。言語登録をせず**拡張子で判定**し、
 *   コマンド ID・viewType を別にする。キーバインドは割り当てない。
 *
 * ■ 対象の判定は `resolveDdsType` に委ねる
 *   `.dspf` と `.mnudds` の 2 つを別々に列挙しない（同じ集合を 2 か所に持たない）。
 */

const VIEW_TYPE = "rpgClSupport.dspfPreview";

interface PreviewSession {
  readonly panel: vscode.WebviewPanel;
  readonly document: vscode.TextDocument;
}

let session: PreviewSession | undefined;

function isDspf(document: vscode.TextDocument): boolean {
  return resolveDdsType(document.uri.fsPath) === "DDS-DSPF";
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

  const layout = resolveDspfLayout(documentLines(current.document));

  current.panel.webview.html = buildDspfPreviewHtml(layout, {
    cspSource: current.panel.webview.cspSource,
    nonce: createNonce(),
    title: current.document.uri.fsPath.split(/[\\/]/u).pop() ?? "DSPF",
    ...(activeLine !== undefined ? { activeSourceLine: activeLine } : {})
  });
}

/**
 * 画面から項目を動かしたときの書き戻し。
 *
 * 帳票と違い**確認を挟まない**。帳票の確認は「行番号を書くと SPACE/SKIP が
 * 無効になる」という印刷装置ファイル固有の意味論に由来するもので、
 * DSPF の位置は常に絶対なので確認する内容が無い。
 */
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
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    current.document.uri,
    current.document.lineAt(index).range,
    writeBackPosition({ line: original, row, column })
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
    "画面プレビュー",
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

export function registerDspfPreview(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("rpgClSupport.showDspfPreview", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isDspf(editor.document)) {
        void vscode.window.showInformationMessage(
          "画面プレビューは .dspf / .mnudds のファイルで実行してください。"
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
