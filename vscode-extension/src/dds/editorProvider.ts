import * as vscode from "vscode";
import { applyDdsEdits, validateDdsEdits, type DdsEditResult } from "../core/dds/ddsEdit";
import type { DdsKeywordHelp } from "../core/dds/ddsKeywords";
import { buildDspfRenderModel, type RenderModel } from "../core/dds/dspfRenderModel";
import { buildPrtfRenderModel } from "../core/dds/prtfRenderModel";
import { DEFAULT_PAGE, type PrtfPage } from "../core/dds/prtfLayout";
import { resolveDdsType } from "../core/sourceKind";
import { resolveDefinitionLanguage } from "../prompter/jsonDefinitions";
import { buildDdsEditorHtml, createNonce } from "./webviewHtml";
import {
  parseEditorMessage,
  VSCODE_HOST,
  type EditorMessage,
  type HostMessage
} from "./webview/protocol";

/**
 * DDS ビジュアルエディタ（`CustomTextEditorProvider`）。
 *
 * ## 仲介しかしない
 *
 * ここにあるのは「TextDocument ⇄ core ⇄ postMessage」の受け渡しだけ。
 * 桁の計算も検証も適用も `core/dds` にあり、**このファイルは判断を持たない**。
 *
 * ## なぜプレビューと別の器なのか
 *
 * 既存の**プレビューは読むための器**（コマンドで開き、ソースが唯一の真実）。
 * こちらは**編集の器**で、`TextDocument` を共有するので**双方向同期・undo・dirty 状態が
 * VSCode 側で成立する**。同じ WebView UI を単独起動でも動かせるよう、
 * UI は `vscode` に触らない（`webview/` 配下）。
 *
 * ## 既定のエディタを奪わない
 *
 * `contributes.customEditors` の `priority` は **`option`**。`.dspf` をダブルクリックしたら
 * これまでどおりテキストエディタが開き、ルーラー / SOSI / lint が効く。
 */

export const DDS_EDITOR_VIEW_TYPE = "rpgClSupport.ddsVisualEditor";

/**
 * 読み込み済みの解説の表（言語ごと）。
 *
 * 同梱物なので**実行中に変わらない**。日本語版は 140KB あり、
 * エディタを開くたびに読み直して解析する意味が無い（補完側も同じ形で持っている）。
 */
const keywordTables = new Map<string, Record<string, DdsKeywordHelp[]>>();

/** WebView の資産の置き場（esbuild の出力先）。 */
const WEBVIEW_DIR = ["out", "dds-webview"];

export function registerDdsVisualEditor(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      DDS_EDITOR_VIEW_TYPE,
      new DdsVisualEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        // 同じ文書を複数のエディタで開かせない（どちらが最新か分からなくなる）。
        supportsMultipleEditorsPerDocument: false
      }
    )
  );
}

class DdsVisualEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    const root = vscode.Uri.joinPath(this.context.extensionUri, ...WEBVIEW_DIR);
    panel.webview.options = { enableScripts: true, localResourceRoots: [root] };
    panel.webview.html = buildDdsEditorHtml({
      cspSource: panel.webview.cspSource,
      nonce: createNonce(),
      scriptUri: panel.webview
        .asWebviewUri(vscode.Uri.joinPath(root, "editor.js"))
        .toString(),
      styleUri: panel.webview
        .asWebviewUri(vscode.Uri.joinPath(root, "editor.css"))
        .toString(),
      title: document.uri.fsPath.split(/[\\/]/u).pop() ?? "DDS"
    });

    const post = (message: HostMessage): void => {
      void panel.webview.postMessage(message);
    };

    const changed = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() !== document.uri.toString()) return;
      // テキスト側の編集でも、自分が入れた編集でも、再描画はこの 1 か所を通る。
      // モデルを丸ごと差し替えるだけなので**冪等**——再入してもループしない。
      post({ type: "applied", model: modelOf(document) });
    });

    const received = panel.webview.onDidReceiveMessage(raw => {
      const message = parseEditorMessage(raw);
      if (message === undefined) {
        // 不正なメッセージは無視してログに残す。1 通で編集を止めない。
        console.warn("[rpgClSupport] DDS エディタ: 不正なメッセージを無視しました");
        return;
      }
      void this.handle(document, message, post);
    });

    panel.onDidDispose(() => {
      changed.dispose();
      received.dispose();
    });
  }

  /**
   * 原典から生成したキーワードの解説を読む。
   *
   * 言語の決め方は**既存のキーワード補完と同じ関数**を通す
   * （`resolveDefinitionLanguage`）。同じ JSON を読むのに設定の解釈が 2 つあると、
   * 補完は日本語・エディタは英語、のような食い違いが起きる。
   *
   * 読めなければ `undefined`。**エディタは開く**（解説だけが出ない）。
   */
  private async keywordHelp(
    document: vscode.TextDocument
  ): Promise<readonly DdsKeywordHelp[] | undefined> {
    const type = resolveDdsType(document.fileName);
    if (type === undefined) return undefined;

    const language = resolveDefinitionLanguage();
    const uri = vscode.Uri.joinPath(
      this.context.extensionUri,
      "resources",
      "completion",
      language === "ja" ? "dds-keywords.json" : `dds-keywords.${language}.json`
    );

    const cached = keywordTables.get(language);
    if (cached !== undefined) return cached[type];

    try {
      const text = (await vscode.workspace.openTextDocument(uri)).getText();
      const parsed = JSON.parse(text) as Record<string, DdsKeywordHelp[]>;
      keywordTables.set(language, parsed);
      const table = parsed[type];
      return Array.isArray(table) ? table : undefined;
    } catch (error) {
      console.log("[rpgClSupport] DDS キーワード解説の読み込みに失敗", String(error));
      return undefined;
    }
  }

  private async handle(
    document: vscode.TextDocument,
    message: EditorMessage,
    post: (message: HostMessage) => void
  ): Promise<void> {
    switch (message.type) {
      case "ready": {
        // 解説は**文書ごとに変わらない**ので、ここで 1 回だけ載せる。
        const keywords = await this.keywordHelp(document);
        post({
          type: "load",
          model: modelOf(document),
          host: VSCODE_HOST,
          ...(keywords !== undefined ? { keywords } : {})
        });
        return;
      }

      case "openSource": {
        const line = Math.min(Math.max(message.sourceLine - 1, 0), document.lineCount - 1);
        const editor = await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: false
        });
        const position = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position));
        return;
      }

      case "askItem": {
        const item = await askItem(message.kind, message.row, message.column);
        post({ type: "askItemResult", item: item ?? null });
        return;
      }

      case "edit":
        await applyEdits(document, message, post);
        return;
    }
  }
}

/** 編集を文書に適用する。**判定は core が持つ**ので、ここは写すだけ。 */
async function applyEdits(
  document: vscode.TextDocument,
  message: Extract<EditorMessage, { type: "edit" }>,
  post: (message: HostMessage) => void
): Promise<void> {
  const lines = documentLines(document);
  const rejections = validateDdsEdits(lines, message.edits);
  if (rejections.length > 0) {
    post({ type: "rejected", model: modelOf(document), rejections });
    return;
  }

  const results = applyDdsEdits(lines, message.edits);
  if (results.length === 0) {
    post({ type: "applied", model: modelOf(document) });
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  for (const result of results) {
    applyResult(edit, document, result);
  }

  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    post({
      type: "rejected",
      model: modelOf(document),
      rejections: [
        {
          code: "line-not-found",
          message: "エディタが編集を受け付けませんでした"
        }
      ]
    });
  }
  // 成功したときは `onDidChangeTextDocument` が `applied` を送る（経路を 1 本に保つ）。
}

/**
 * 置き換え指示 1 件を `WorkspaceEdit` に写す。
 *
 * 指示は**旧文書の行範囲と、置き換え後の行**なので、座標を計算し直さない。
 * 3 つの形がある——挿入（範囲が空）・削除（行が空）・置換。
 */
function applyResult(
  edit: vscode.WorkspaceEdit,
  document: vscode.TextDocument,
  result: DdsEditResult
): void {
  const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const body = result.lines.join(eol);

  if (result.replaceFrom === result.replaceTo) {
    if (result.replaceFrom < document.lineCount) {
      edit.insert(document.uri, new vscode.Position(result.replaceFrom, 0), body + eol);
      return;
    }
    // 末尾に改行が無い文書への追記。行を足す前に改行を入れる。
    const last = document.lineAt(document.lineCount - 1);
    edit.insert(document.uri, last.range.end, eol + body);
    return;
  }

  const start = document.lineAt(result.replaceFrom).range.start;
  const lastLine = document.lineAt(result.replaceTo - 1);
  const hadLineBreak = lastLine.rangeIncludingLineBreak.end.isAfter(lastLine.range.end);
  const text = result.lines.length === 0 ? "" : body + (hadLineBreak ? eol : "");

  edit.replace(
    document.uri,
    new vscode.Range(start, lastLine.rangeIncludingLineBreak.end),
    text
  );
}

/** 追加する項目の内容を聞く。取り消し（Esc）なら undefined。 */
async function askItem(
  kind: "field" | "constant",
  row: number,
  column: number
): Promise<Record<string, unknown> | undefined> {
  if (kind === "constant") {
    const text = await vscode.window.showInputBox({
      title: `定数を ${row} 行 ${column} 桁に置く`,
      prompt: "表示する文字列（引用符は不要）"
    });
    if (text === undefined || text.length === 0) return undefined;
    return { kind: "constant", text };
  }

  const name = await vscode.window.showInputBox({
    title: `フィールドを ${row} 行 ${column} 桁に置く`,
    prompt: "フィールド名（19-28 桁）",
    validateInput: value =>
      value.trim().length === 0
        ? "名前が必要です"
        : value.trim().length > 10
          ? "名前は 10 桁までです"
          : undefined
  });
  if (name === undefined) return undefined;

  const length = await vscode.window.showInputBox({
    title: `${name.trim().toUpperCase()} の長さ`,
    value: "10",
    prompt: "桁数（30-34 桁）",
    validateInput: value =>
      /^\d{1,5}$/u.test(value.trim()) && Number(value) > 0
        ? undefined
        : "1〜99999 で入力してください"
  });
  if (length === undefined) return undefined;

  return {
    kind: "field",
    name: name.trim().toUpperCase(),
    length: Number(length.trim()),
    dataType: "A",
    usage: "B"
  };
}

function modelOf(document: vscode.TextDocument): RenderModel {
  const lines = documentLines(document);
  // **種別で解決を選ぶ。** 帳票は行が行送り（SPACE / SKIP）で決まるので、
  // 画面の配置解決では位置が出ない。
  return resolveDdsType(document.fileName) === "DDS-PRTF"
    ? buildPrtfRenderModel(lines, { page: prtfPage() })
    : buildDspfRenderModel(lines);
}

/**
 * 帳票の紙面。**DDS には書かれていない**（`CRTPRTF` の `PAGESIZE` / `OVRFLW`）ので設定から採る。
 *
 * 帳票プレビュー（`language/prtfPreview.ts`）と**同じ設定**を読む——
 * 同じソースが 2 つの画面で別の紙面に見えないようにするため。
 */
function prtfPage(): PrtfPage {
  const config = vscode.workspace.getConfiguration("rpgClSupport");
  const positive = (key: string): number | undefined => {
    const value = config.get<number>(key);
    return typeof value === "number" && value > 0 ? value : undefined;
  };

  return {
    rows: positive("prtf.pageLength") ?? DEFAULT_PAGE.rows,
    columns: positive("prtf.pageWidth") ?? DEFAULT_PAGE.columns,
    overflowLine: positive("prtf.overflowLine") ?? DEFAULT_PAGE.overflowLine
  };
}

function documentLines(document: vscode.TextDocument): string[] {
  const lines: string[] = [];
  for (let index = 0; index < document.lineCount; index += 1) {
    lines.push(document.lineAt(index).text);
  }
  return lines;
}

/** `.dspf` / `.mnudds` か。判定は `resolveDdsType` に委ねる（同じ集合を 2 か所に持たない）。 */
export function isDspfPath(fsPath: string): boolean {
  return resolveDdsType(fsPath) === "DDS-DSPF";
}
