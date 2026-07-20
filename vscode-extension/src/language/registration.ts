import * as vscode from "vscode";
import { registerDdsKeywordCompletion } from "./ddsKeywordCompletion";
import { registerRpgCompletion } from "./rpgCompletion";
import { registerDdsSymbols } from "./ddsSymbols";
import { registerCmdSymbols } from "./cmdSymbols";
import { RpgClDiagnostics } from "./diagnostics";
import { registerRpgCommentToggle } from "./rpgCommentToggle";
import { registerClCommentToggle } from "./clCommentToggle";
import { registerRpgTabNavigation } from "./rpgTabNavigation";
import { registerDbcsShiftMarkers } from "./dbcsShiftMarkers";
import { registerFixedFormatNavigation } from "./fixedFormatNavigation";
import { registerRuler } from "./ruler";
import { registerPrtfPreview } from "./prtfPreview";
import { registerDspfPreview } from "./dspfPreview";

let diagnosticsInstance: RpgClDiagnostics | undefined;

export function registerLanguageFeatures(
  context: vscode.ExtensionContext
): void {
  // DDS のキーワード補完（45 桁目以降の機能欄で候補を出す）。
  context.subscriptions.push(registerDdsKeywordCompletion(context));
  // RPG の命令コード・組み込み関数・仕様書キーワードの補完。
  context.subscriptions.push(registerRpgCompletion(context));

  // アウトライン（アウトラインタブ・パンくず・シンボルへ移動・記号検索）。
  // RPG と CL は既存拡張（vscode-rpgle / vscode-clle）が対応済みなので提供しない。
  context.subscriptions.push(registerDdsSymbols());
  context.subscriptions.push(registerCmdSymbols());

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
  // 帳票（PRTF）プレビュー。拡張子で判定し、IBM i Renderer とは別コマンド。
  registerPrtfPreview(context);
  registerDspfPreview(context);
}
