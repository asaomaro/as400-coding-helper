/**
 * `.dspf` のビジュアルエディタ（`CustomTextEditorProvider`）。
 *
 * ## 仲介しかしない（design DD6）
 *
 * ここにあるのは「TextDocument ⇄ dds-core ⇄ postMessage」の受け渡しだけ。
 * 桁の計算も検証もパッチの適用も `dds-core` にあり、**このファイルは判断を持たない**。
 *
 * ## `CustomTextEditorProvider` を選んだ理由（spec D5）
 *
 * `TextDocument` を共有するので、**双方向同期・undo/redo・dirty 状態が VSCode 側で成立する**。
 * 自前で同期を書くと必ずどこかで整合が崩れる。テキスト側の編集も
 * `onDidChangeTextDocument` を通って同じ経路で再描画される——**別経路を作らない。**
 *
 * ## 全文置換をしない（AC2 の最後の関門）
 *
 * 「編集していない行はバイト不変」は core が `raw` 保持で構造的に守っているが、
 * **provider が全文置換した時点で台無しになる**。`applyOps` が返す `changedLines` の範囲だけを
 * `WorkspaceEdit` にする。
 */

import * as vscode from "vscode";
import {
  applyOps,
  buildRenderModel,
  parse,
  PatchRejectedError,
  type RenderModel
} from "@as400/dds-core";
import { lineReplacement, type LineReplacement } from "./edit";
import { buildDdsEditorHtml, createNonce } from "./webviewHtml";
import {
  parseWebviewMessage,
  VSCODE_HOST,
  type HostMessage
} from "./webview/protocol";

/** `contributes.customEditors` の `viewType` と一致させる。 */
export const DDS_EDITOR_VIEW_TYPE = "rpgClSupport.ddsVisualEditor";

/** WebView の資産の置き場（VSIX に載る唯一の場所。`src/` は `.vscodeignore` で落ちる）。 */
const WEBVIEW_DIR = ["dist", "webview"];

export function registerDdsVisualEditor(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      DDS_EDITOR_VIEW_TYPE,
      new DdsVisualEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        // 同じ文書を複数のビジュアルエディタで開くことを許さない
        // （どちらが最新か分からなくなる。テキストエディタと並べるのは従来どおり可能）。
        supportsMultipleEditorsPerDocument: false
      }
    )
  );
}

/**
 * パッチを 1 つの `TextDocument` に適用する。**統合テストの入口も兼ねる。**
 *
 * WebView を介さずに provider と同じ経路（`parse → applyOps → lineReplacement → WorkspaceEdit`）を
 * 通せるようにしてある。GUI のドラッグ操作そのものは自動化できない（WebView の中は
 * 拡張ホストから触れない）ので、**文書側の正しさだけは VSCode 上で機械的に確かめる**ため。
 */
export async function applyPatchToDocument(
  document: vscode.TextDocument,
  ops: Parameters<typeof applyOps>[1]
): Promise<{ applied: boolean; reason?: string }> {
  const result = applyOps(parse(document.getText()), ops);
  const replacement = lineReplacement(
    document.getText(),
    result.text,
    result.changedLines
  );
  if (replacement === undefined) {
    return { applied: false, reason: "変更なし" };
  }

  const edit = new vscode.WorkspaceEdit();
  applyLineReplacement(edit, document, replacement);
  const applied = await vscode.workspace.applyEdit(edit);
  return applied
    ? { applied: true }
    : { applied: false, reason: "エディタが編集を受け付けませんでした" };
}

class DdsVisualEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    const webviewRoot = vscode.Uri.joinPath(
      this.context.extensionUri,
      ...WEBVIEW_DIR
    );

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewRoot]
    };
    panel.webview.html = buildDdsEditorHtml({
      cspSource: panel.webview.cspSource,
      nonce: createNonce(),
      scriptUri: panel.webview
        .asWebviewUri(vscode.Uri.joinPath(webviewRoot, "main.js"))
        .toString(),
      styleUri: panel.webview
        .asWebviewUri(vscode.Uri.joinPath(webviewRoot, "main.css"))
        .toString()
    });

    const post = (message: HostMessage): void => {
      void panel.webview.postMessage(message);
    };

    const changeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }
      // テキスト側の編集でも、自分が入れた WorkspaceEdit でも、再描画はこの 1 か所を通る。
      // モデルを丸ごと差し替えるだけなので**冪等**——再入してもループしない。
      post({ type: "applied", model: modelOf(document) });
    });

    const messageSubscription = panel.webview.onDidReceiveMessage(raw => {
      const message = parseWebviewMessage(raw);
      if (message === undefined) {
        // spec のエラー処理どおり、無視してログに残す。1 通の不正で編集を止めない。
        console.warn(
          "[rpgClSupport] DDS エディタ: 不正なメッセージを無視しました",
          JSON.stringify(raw)
        );
        return;
      }

      switch (message.type) {
        case "ready":
          post({ type: "load", model: modelOf(document), host: VSCODE_HOST });
          break;
        case "patch":
          void this.applyPatch(document, message.ops, post);
          break;
        case "openSource":
          void openSource(document, message.sourceLine);
          break;
      }
    });

    panel.onDidDispose(() => {
      changeSubscription.dispose();
      messageSubscription.dispose();
    });
  }

  /**
   * パッチを適用する。
   *
   * 成功しても `applied` をここからは送らない——`onDidChangeTextDocument` が拾って送る。
   * **経路を 1 本に保つ**ため（テキスト側の編集と同じ道を通す）。
   * ただし文書が変わらなかった場合は変更イベントが起きないので、その場合だけ直接返す。
   */
  private async applyPatch(
    document: vscode.TextDocument,
    ops: Parameters<typeof applyOps>[1],
    post: (message: HostMessage) => void
  ): Promise<void> {
    const doc = parse(document.getText());

    let result: ReturnType<typeof applyOps>;
    try {
      result = applyOps(doc, ops);
    } catch (error) {
      if (error instanceof PatchRejectedError) {
        post({
          type: "rejected",
          reason: error.message,
          diagnostics: error.diagnostics.map(diagnostic => ({ ...diagnostic })),
          model: modelOf(document)
        });
        return;
      }
      // **想定外の例外でも必ず返事をする。** 返さないと WebView は `Pending` から戻れず、
      // 以後の操作を一切受け付けなくなる（design「WebView の状態遷移」）。
      console.error("[rpgClSupport] DDS エディタ: パッチの適用に失敗しました", error);
      post({
        type: "rejected",
        reason: "パッチの適用に失敗しました（詳細は開発者ツールのログ）",
        diagnostics: [],
        model: modelOf(document)
      });
      return;
    }

    const replacement = lineReplacement(
      document.getText(),
      result.text,
      result.changedLines
    );
    if (replacement === undefined) {
      post({ type: "applied", model: modelOf(document) });
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    applyLineReplacement(edit, document, replacement);

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      post({
        type: "rejected",
        reason: "エディタが編集を受け付けませんでした",
        diagnostics: [],
        model: modelOf(document)
      });
    }
  }
}


/**
 * 行単位の置換を `WorkspaceEdit` に落とす。
 *
 * **3 つの形がある**——旧範囲が空なら挿入、`lines` が空なら削除、それ以外は置換。
 * `TextDocument` は末尾の改行のぶん行数を 1 多く数えるので、
 * 末尾への挿入位置は「最後の行の行末」を使う（`Position(lineCount, 0)` は範囲外）。
 */
function applyLineReplacement(
  edit: vscode.WorkspaceEdit,
  document: vscode.TextDocument,
  replacement: LineReplacement
): void {
  const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";

  if (replacement.endLineExclusive === replacement.startLine) {
    const body = replacement.lines.join(eol);
    if (replacement.startLine < document.lineCount) {
      edit.insert(
        document.uri,
        new vscode.Position(replacement.startLine, 0),
        body + eol
      );
      return;
    }
    // 末尾に改行が無い文書への追記。行を足す前に改行を入れる。
    const last = document.lineAt(document.lineCount - 1);
    edit.insert(document.uri, last.range.end, eol + body);
    return;
  }

  const start = document.lineAt(replacement.startLine).range.start;
  const lastLine = document.lineAt(replacement.endLineExclusive - 1);
  const hadLineBreak =
    lastLine.rangeIncludingLineBreak.end.isAfter(lastLine.range.end);
  const body = replacement.lines.join(eol);
  const text =
    replacement.lines.length === 0
      ? "" // 削除。行ごと消す。
      : body + (hadLineBreak ? eol : "");

  edit.replace(
    document.uri,
    new vscode.Range(start, lastLine.rangeIncludingLineBreak.end),
    text
  );
}

/** 現在の文書から描画モデルを作る。**唯一の真実は常に TextDocument。** */
function modelOf(document: vscode.TextDocument): RenderModel {
  return buildRenderModel(parse(document.getText()));
}

/** 対応するソース行をテキストエディタで開く（`canOpenTextEditor`）。 */
async function openSource(
  document: vscode.TextDocument,
  sourceLine: number
): Promise<void> {
  const line = Math.min(Math.max(sourceLine, 0), document.lineCount - 1);
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: false
  });
  const position = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport
  );
}
