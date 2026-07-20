import * as vscode from "vscode";
import type { ParameterDefinition, PrompterDefinition } from "./types";
import type { ResolvedPosition } from "./positionResolver";
import { buildInitialState } from "./model";
import { toSerializableState, buildHtml } from "./binding";
import { showParameterHelp } from "./help";
import { PrompterDefinitionLoader } from "./jsonDefinitions";
import { parseClCommand, mapParsedCommandToValues } from "./clCommandParser";
import { buildClCommandBody } from "./applyChanges";
import { collectWorkspaceObjects } from "./workspaceObjects";

export interface PrompterResult {
  readonly confirmed: boolean;
  readonly values: Record<string, string | string[]>;
}

export async function openPrompter(
  context: vscode.ExtensionContext,
  definition: PrompterDefinition,
  resolved: ResolvedPosition,
  initialValues: Record<string, string>
): Promise<PrompterResult | undefined> {
  const initialState = buildInitialState(definition, initialValues);
  // オブジェクト名の候補はワークスペースのソースから集める（実機には繋がない）。
  const objectCandidates = await collectWorkspaceObjects();
  const serializable = toSerializableState(
    definition,
    initialState,
    resolved,
    objectCandidates
  );

  const config = vscode.workspace.getConfiguration("rpgClSupport");
  const openBeside = config.get<boolean>("prompter.openBeside") ?? false;

  const viewColumn = openBeside
    ? vscode.ViewColumn.Beside
    : vscode.ViewColumn.Active;

  const panel = vscode.window.createWebviewPanel(
    "rpgClSupport.prompter",
    `${definition.keyword} Prompter`,
    viewColumn,
    {
      enableScripts: true,
      retainContextWhenHidden: false
    }
  );

  const nonce = createNonce();

  panel.webview.html = buildHtml(serializable, {
    cspSource: panel.webview.cspSource,
    nonce
  });

  return new Promise(resolve => {
    const subscription = panel.webview.onDidReceiveMessage(message => {
      console.log(
        "[rpgClSupport] webview message",
        JSON.stringify(message)
      );

      if (message?.type === "submit") {
        subscription.dispose();
        panel.dispose();
        resolve({
          confirmed: true,
          values: message.values as Record<string, string | string[]>
        });
      } else if (message?.type === "cancel") {
        subscription.dispose();
        panel.dispose();
        resolve({
          confirmed: false,
          values: {}
        });
      } else if (message?.type === "help") {
        const name = String(message.name ?? "");
        // group の子（例: PGM の LIBL/OBJ）もヘルプ対象になるため再帰的に探す。
        const parameter = findParameter(definition.parameters, name);
        if (parameter) {
          showParameterHelp(definition, parameter);
        }
      } else if (message?.type === "promptCommand") {
        // 値そのものがコマンドの欄（SBMJOB の CMD など）から、さらに
        // プロンプターを開く。SEU の F4 in F4 に相当する。
        void openNestedPrompter(
          context,
          resolved,
          String(message.name ?? ""),
          String(message.value ?? "")
        ).then(built => {
          if (built !== undefined) {
            void panel.webview.postMessage({
              type: "setValue",
              name: String(message.name ?? ""),
              value: built
            });
          }
          // 親のプロンプターに操作を戻す。
          panel.reveal(panel.viewColumn, false);
        });
      } else if (message?.type === "ready") {
        // WebView 起動確認。特に処理は不要。
      }
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

function findParameter(
  parameters: readonly ParameterDefinition[],
  name: string
): ParameterDefinition | undefined {
  for (const parameter of parameters) {
    if (parameter.name === name) {
      return parameter;
    }
    const child = findParameter(parameter.children ?? [], name);
    if (child) {
      return child;
    }
  }
  return undefined;
}

function createNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 16; i += 1) {
    const idx = Math.floor(Math.random() * chars.length);
    nonce += chars.charAt(idx);
  }
  return nonce;
}
