import * as vscode from "vscode";
import { registerDdsKeywordCompletion } from "./ddsKeywordCompletion";
import { RpgClDiagnostics } from "./diagnostics";
import { registerRpgCommentToggle } from "./rpgCommentToggle";
import { registerClCommentToggle } from "./clCommentToggle";
import { registerRpgTabNavigation } from "./rpgTabNavigation";
import { registerDbcsShiftMarkers } from "./dbcsShiftMarkers";
import { registerFixedFormatNavigation } from "./fixedFormatNavigation";
import { registerRuler } from "./ruler";

let diagnosticsInstance: RpgClDiagnostics | undefined;

export function registerLanguageFeatures(
  context: vscode.ExtensionContext
): void {
  // DDS のキーワード補完（45 桁目以降の機能欄で候補を出す）。
  context.subscriptions.push(registerDdsKeywordCompletion(context));

  if (!diagnosticsInstance) {
    diagnosticsInstance = new RpgClDiagnostics();
    diagnosticsInstance.register(context);
  }

  const selector: vscode.DocumentSelector = [
    { language: "rpg-fixed", scheme: "file" },
    { language: "cl", scheme: "file" }
  ];

  const disposable = vscode.languages.registerHoverProvider(selector, {
    provideHover(_document, _position) {
      return undefined;
    }
  });

  context.subscriptions.push(disposable);

  registerRpgCommentToggle(context);
  registerClCommentToggle(context);
  registerRpgTabNavigation(context);
  registerFixedFormatNavigation(context);
  registerDbcsShiftMarkers(context);
  registerRuler(context);
}
