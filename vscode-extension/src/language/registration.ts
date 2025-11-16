import * as vscode from "vscode";
import { RpgClDiagnostics } from "./diagnostics";
import { registerRpgCommentToggle } from "./rpgCommentToggle";
import { registerClCommentToggle } from "./clCommentToggle";
import { registerRpgTabNavigation } from "./rpgTabNavigation";
import { registerDbcsShiftMarkers } from "./dbcsShiftMarkers";

let diagnosticsInstance: RpgClDiagnostics | undefined;

export function registerLanguageFeatures(
  context: vscode.ExtensionContext
): void {
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
  registerDbcsShiftMarkers(context);
}
