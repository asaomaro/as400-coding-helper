import * as vscode from "vscode";
import type { PrompterDefinition } from "./types";
import type { ResolvedPosition } from "./positionResolver";
import { buildPrompterHtml, createNonce } from "./webviewHtml";
import { PrompterDefinitionLoader } from "./jsonDefinitions";
import { parseClCommand, mapParsedCommandToValues } from "./clCommandParser";
import { buildClCommandBody } from "./commandText";
import { collectWorkspaceObjects } from "./workspaceObjects";
import {
  parsePrompterMessage,
  VSCODE_HOST,
  type EditorMessage,
  type HostMessage
} from "./webview/protocol";

/**
 * F4 プロンプターの器（VSCode 側）。
 *
 * ## 仲介しかしない
 *
 * ここにあるのは「定義 ⇄ WebView」の受け渡しだけ。**画面も判定も持たない**——
 * 描くのは `webview/ui.ts`、決めるのは `model.ts` / `formModel.ts`。
 *
 * 以前は `binding.ts` が HTML と 827 行のインライン JS を文字列で組み立てており、
 * 型検査も自動テストも効かなかった。いまは束ねた資産（`out/prompter-webview/`）を
 * 配るだけなので、**同じ UI を VSCode の外でも動かせる**（`dev/prompter-standalone.ts`）。
 */

export interface PrompterResult {
  readonly confirmed: boolean;
  readonly values: Record<string, string | string[]>;
}

/** WebView の資産の置き場（esbuild の出力先）。 */
const WEBVIEW_DIR = ["out", "prompter-webview"];

export async function openPrompter(
  context: vscode.ExtensionContext,
  definition: PrompterDefinition,
  resolved: ResolvedPosition,
  initialValues: Record<string, string>
): Promise<PrompterResult | undefined> {
  // オブジェクト名の候補はワークスペースのソースから集める（実機には繋がない）。
  const objectCandidates = await collectWorkspaceObjects();

  const config = vscode.workspace.getConfiguration("rpgClSupport");
  const openBeside = config.get<boolean>("prompter.openBeside") ?? false;
  const viewColumn = openBeside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;

  const root = vscode.Uri.joinPath(context.extensionUri, ...WEBVIEW_DIR);
  const panel = vscode.window.createWebviewPanel(
    "rpgClSupport.prompter",
    `${definition.keyword} Prompter`,
    viewColumn,
    {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [root]
    }
  );

  panel.webview.html = buildPrompterHtml({
    cspSource: panel.webview.cspSource,
    nonce: createNonce(),
    scriptUri: panel.webview
      .asWebviewUri(vscode.Uri.joinPath(root, "prompter.js"))
      .toString(),
    styleUri: panel.webview
      .asWebviewUri(vscode.Uri.joinPath(root, "prompter.css"))
      .toString(),
    title: `F4 プロンプター - ${definition.keyword}`
  });

  const post = (message: HostMessage): void => {
    void panel.webview.postMessage(message);
  };

  return new Promise(resolve => {
    // 取り消しの経路は 2 つある（Cancel と、パネルを閉じる操作）。
    // どちらでも 1 度だけ決着させる。
    let settled = false;
    const finish = (result: PrompterResult): void => {
      if (settled) return;
      settled = true;
      subscription.dispose();
      disposed.dispose();
      panel.dispose();
      resolve(result);
    };

    const handle = (message: EditorMessage): void => {
      switch (message.type) {
        case "ready":
          // 画面が立ち上がってから渡す。HTML に焼き込まないので、
          // **同じ経路を単独起動ハーネスも通る**。
          post({
            type: "load",
            definition,
            values: initialValues,
            objectCandidates,
            host: VSCODE_HOST
          });
          return;

        case "submit":
          finish({ confirmed: true, values: message.values });
          return;

        case "cancel":
          finish({ confirmed: false, values: {} });
          return;

        case "promptCommand":
          // 値そのものがコマンドの欄（SBMJOB の CMD など）から、さらに
          // プロンプターを開く。SEU の F4 in F4 に相当する。
          void openNestedPrompter(context, resolved, message.name, message.value).then(
            built => {
              if (built !== undefined) {
                post({ type: "setValue", name: message.name, value: built });
              }
              // 親のプロンプターに操作を戻す。
              panel.reveal(panel.viewColumn, false);
            }
          );
          return;
      }
    };

    const subscription = panel.webview.onDidReceiveMessage(raw => {
      const message = parsePrompterMessage(raw);
      if (message === undefined) {
        // 不正なメッセージは無視してログに残す。1 通で窓を殺さない。
        console.warn("[rpgClSupport] プロンプター: 不正なメッセージを無視しました");
        return;
      }
      handle(message);
    });

    // 窓ごと閉じられたら取り消し扱い。**待ち続けると F4 が二度と開かなくなる。**
    const disposed = panel.onDidDispose(() => {
      finish({ confirmed: false, values: {} });
    });
  });
}

/**
 * コマンドの欄から入れ子のプロンプターを開き、確定した値（素の 1 行コマンド）を返す。
 * 取り消し・命令名が決まらない場合は undefined。
 *
 * 命令名は欄の値から読む。空欄のときは何を開けばよいか決まらないので尋ねる
 * （SEU も先に命令名を書いてから F4 を押す）。
 */
async function openNestedPrompter(
  context: vscode.ExtensionContext,
  resolved: ResolvedPosition,
  name: string,
  currentValue: string
): Promise<string | undefined> {
  const parsed = parseClCommand(currentValue.trim());
  let keyword = parsed?.keyword;

  if (!keyword) {
    const typed = await vscode.window.showInputBox({
      title: `${name} で実行するコマンド`,
      prompt: "プロンプターを開くコマンド名を入力してください（例: CALL）",
      validateInput: value =>
        /^[A-Za-z][A-Za-z0-9]*$/u.test(value.trim()) ? undefined : "コマンド名を入力してください"
    });
    keyword = typed?.trim().toUpperCase();
  }

  if (!keyword) {
    return undefined;
  }

  const loader = new PrompterDefinitionLoader();
  const definition = await loader.loadDefinition(
    keyword,
    "cl",
    undefined,
    vscode.workspace.getWorkspaceFolder(resolved.document.uri),
    context
  );

  if (!definition) {
    void vscode.window.showInformationMessage(
      `${keyword} のプロンプター定義がありません。`
    );
    return undefined;
  }

  // 欄に既に書かれているコマンドがあれば、その値を初期値として持ち込む。
  const initialValues =
    parsed && parsed.keyword === definition.keyword
      ? mapParsedCommandToValues(definition, parsed)
      : {};

  const result = await openPrompter(context, definition, resolved, initialValues);
  if (!result?.confirmed) {
    return undefined;
  }

  // 欄に入るのは値であってソース行ではないので、桁揃えも折り返しもしない。
  return buildClCommandBody(definition, result.values, {
    presentParameters: Object.keys(parsed?.parameters ?? {})
  });
}
