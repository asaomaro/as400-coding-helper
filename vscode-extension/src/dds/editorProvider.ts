import * as vscode from "vscode";
import {
  applyDdsEdits,
  validateDdsEdits,
  type DdsEditResult,
  type EditableDdsType
} from "../core/dds/ddsEdit";
import type { DdsKeywordHelp } from "../core/dds/ddsKeywords";
import { buildDdsTemplate } from "../core/dds/ddsTemplate";
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

/** ビジュアルエディタを開くコマンド。 */
export const OPEN_DDS_EDITOR_COMMAND = "rpgClSupport.openDdsVisualEditor";

/**
 * 新しい DDS を作るコマンド。**種別ごとに 1 つ**（雛形の中身が違う）。
 *
 * `customEditors` は既存のファイルにしか付かないので、これが無いと
 * **デザイナは「直す道具」のままで「作る道具」にならない**——
 * 様式を手で書いたファイルを用意しないと使えなかった。
 */
export const NEW_DSPF_COMMAND = "rpgClSupport.newDspf";
export const NEW_PRTF_COMMAND = "rpgClSupport.newPrtf";

/**
 * 新規作成が付ける拡張子。**種別の判定は `resolveDdsType` に委ねる**ので、
 * ここに要るのは「合っていなかったときに何を足すか」だけ（集合は数え上げない）。
 */
const NEW_FILE_EXTENSION: Record<EditableDdsType, string> = {
  "DDS-DSPF": ".dspf",
  "DDS-PRTF": ".prtf"
};

/** 保存ダイアログに最初から入れておく名前。IBM i のメンバー名は 10 桁まで。 */
const NEW_FILE_NAME: Record<EditableDdsType, string> = {
  "DDS-DSPF": "NEWDSPF",
  "DDS-PRTF": "NEWPRTF"
};

/**
 * このエディタが開ける DDS 種別。**プレビューと違い画面・帳票の両方**を受ける。
 *
 * 拡張子を数え上げず `resolveDdsType` に委ねる（同じ集合を 2 か所に持たない）。
 * `package.json` の `when` との一致は `verify-contributes.mjs` が機械検査する。
 */
const EDITABLE_DDS_TYPES = new Set(["DDS-DSPF", "DDS-PRTF"]);

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
    ),
    // **開く手段をここで持つ。** `customEditors` の `priority` は `option` なので、
    // これが無いと「エディターで開く…」を知る利用者にしか届かない
    // （AGENTS.md「追加したリソースは到達可能になって初めて完了」）。
    vscode.commands.registerCommand(OPEN_DDS_EDITOR_COMMAND, async () => {
      const document = vscode.window.activeTextEditor?.document;
      const ddsType = document ? resolveDdsType(document.uri.fsPath) : undefined;
      if (!document || ddsType === undefined || !EDITABLE_DDS_TYPES.has(ddsType)) {
        void vscode.window.showInformationMessage(
          "DDS ビジュアルエディタは .dspf / .mnudds / .prtf のファイルで実行してください。"
        );
        return;
      }
      // 組み込みコマンド。**引数は (uri, viewType) の順**——逆にすると無言で失敗する。
      await vscode.commands.executeCommand(
        "vscode.openWith",
        document.uri,
        DDS_EDITOR_VIEW_TYPE
      );
    }),
    // **新しく作る手段。** 右クリックの引数はフォルダーの URI（コマンド・パレットからは無い）。
    vscode.commands.registerCommand(NEW_DSPF_COMMAND, (folder?: vscode.Uri) =>
      createDdsFile("DDS-DSPF", folder)
    ),
    vscode.commands.registerCommand(NEW_PRTF_COMMAND, (folder?: vscode.Uri) =>
      createDdsFile("DDS-PRTF", folder)
    )
  );
}

/**
 * 新しい DDS を作り、そのままビジュアルエディタで開く。
 *
 * ## 保存先はダイアログに決めさせる
 *
 * ワークスペースを開いていない状態でも成立させたい。既定の場所を推測して黙って置くより、
 * **どこへ置くかを聞く**ほうが確か——取り消せば何も起きない。
 *
 * **`filters` は付けない。** 付けると拡張子の集合が `sourceKind.ts` の外にもう 1 つできる。
 * 代わりに、返ってきたパスを `resolveDdsType` に judge させ、合わなければ足す。
 *
 * ## 中身は core が持つ
 *
 * 雛形の組み立ては `buildDdsTemplate`。単独起動と**同じファイル**ができることが
 * 「スタンドアロンが本体で VSCode は埋め込み先の 1 つ」という設計の担保になる。
 */
async function createDdsFile(
  ddsType: EditableDdsType,
  folder: vscode.Uri | undefined
): Promise<void> {
  const target = await vscode.window.showSaveDialog({
    defaultUri: defaultNewFileUri(ddsType, folder),
    saveLabel: "作成",
    title:
      ddsType === "DDS-PRTF"
        ? "新しい帳票ファイル (PRTF) の保存先"
        : "新しい画面ファイル (DSPF) の保存先"
  });
  // 取り消し。**何も出さない**（押した人は自分で止めたことを知っている）。
  if (target === undefined) return;

  // 拡張子が種別と食い違うと、作れてもビジュアルエディタで開かない。
  const uri =
    resolveDdsType(target.fsPath) === ddsType
      ? target
      : target.with({ path: `${target.path}${NEW_FILE_EXTENSION[ddsType]}` });

  // **ダイアログが確かめていないパスに黙って書かない。**
  //
  // `showSaveDialog` が衝突を見るのは**利用者が打ったパス**だけ。こちらが拡張子を
  // 足して別のパスへ書くなら、ダイアログが出したはずの確認をやり直す必要がある——
  // `CUSTMNT` と打つと `CUSTMNT` に衝突は無く、`CUSTMNT.dspf` が**黙って消える**。
  //
  // この PJ が「確認を出さず undo に委ねる」のは**取り消せる操作**の話。
  // 開いていないファイルの上書きに undo は無いので、そちらの作法は当てはまらない。
  if (uri.path !== target.path && (await fileExists(uri))) {
    const name = uri.fsPath.split(/[\\/]/u).pop() ?? uri.fsPath;
    const overwrite = "上書きする";
    const answer = await vscode.window.showWarningMessage(
      `${name} は既にあります。上書きしますか？（元の内容は戻せません）`,
      { modal: true },
      overwrite
    );
    if (answer !== overwrite) return;
  }

  const body = `${buildDdsTemplate(ddsType).join("\n")}\n`;
  try {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(body, "utf8"));
  } catch (error) {
    void vscode.window.showErrorMessage(
      `DDS ファイルを作成できませんでした: ${String(error)}`
    );
    return;
  }

  try {
    // **引数は (uri, viewType) の順**——逆にすると無言で失敗する。
    await vscode.commands.executeCommand("vscode.openWith", uri, DDS_EDITOR_VIEW_TYPE);
  } catch (error) {
    // ファイルは残っている。**黙らせない**（作ったのに開かない状態を放置しない）。
    void vscode.window.showErrorMessage(
      `作成したファイルをビジュアルエディタで開けませんでした: ${String(error)}`
    );
  }
}

/** そのパスに何かあるか。**無ければ `stat` が失敗する**ので、それで判定する。 */
async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * 保存ダイアログの初期値。右クリックされたフォルダー → 最初のワークスペース → 無し、の順。
 *
 * **ワークスペースが無くても成立する**（`defaultUri` を省くと、ダイアログが既定の場所を出す）。
 */
function defaultNewFileUri(
  ddsType: EditableDdsType,
  folder: vscode.Uri | undefined
): vscode.Uri | undefined {
  const base = folder ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  if (base === undefined) return undefined;
  return vscode.Uri.joinPath(
    base,
    `${NEW_FILE_NAME[ddsType]}${NEW_FILE_EXTENSION[ddsType]}`
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
      post({ type: "applied", ...viewOf(document) });
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
          ...viewOf(document),
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
  // **種別で答えが変わる検査がある**（1 桁目の禁止は表示装置だけ / 行送りは印刷装置だけ）。
  // 判定は `resolveDdsType` に委ね、拡張子を数え上げない。
  const ddsType = editableTypeOf(document);
  const rejections = validateDdsEdits(lines, message.edits, ddsType);
  if (rejections.length > 0) {
    post({ type: "rejected", ...viewOf(document), rejections });
    return;
  }

  const results = applyDdsEdits(lines, message.edits, ddsType);
  if (results.length === 0) {
    post({ type: "applied", ...viewOf(document) });
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
      ...viewOf(document),
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

/**
 * モデルと生のソースを**1 組で**返す。
 *
 * ドックのソース面はモデルと同じ瞬間の内容でなければならない。別々に採ると、
 * 編集直後に**モデルだけ新しくソースが古い**状態が作れてしまう。
 */
function viewOf(document: vscode.TextDocument): { model: RenderModel; source: string[] } {
  return { model: modelOf(document), source: documentLines(document) };
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

/**
 * その文書の編集用の種別。
 *
 * このエディタは `.dspf` / `.mnudds` / `.prtf` にしか開かない（`customEditors` の
 * `selector`。`verify-contributes.mjs` が突き合わせている）ので、
 * 帳票でなければ画面ファイルとして扱う。
 */
function editableTypeOf(document: vscode.TextDocument): EditableDdsType {
  return resolveDdsType(document.fileName) === "DDS-PRTF" ? "DDS-PRTF" : "DDS-DSPF";
}

/** `.dspf` / `.mnudds` か。判定は `resolveDdsType` に委ねる（同じ集合を 2 か所に持たない）。 */
export function isDspfPath(fsPath: string): boolean {
  return resolveDdsType(fsPath) === "DDS-DSPF";
}
