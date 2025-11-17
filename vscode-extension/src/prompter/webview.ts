import * as vscode from "vscode";
import type { PrompterDefinition } from "./types";
import type { ResolvedPosition } from "./positionResolver";
import { buildInitialState } from "./model";
import { toSerializableState, buildHtml } from "./binding";
import { showParameterHelp } from "./help";

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
  const serializable = toSerializableState(definition, initialState, resolved);

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
        const parameter = definition.parameters.find(
          candidate => candidate.name === name
        );
        if (parameter) {
          showParameterHelp(definition, parameter);
        }
      } else if (message?.type === "ready") {
        // WebView 起動確認。特に処理は不要。
      }
    });
  });
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
