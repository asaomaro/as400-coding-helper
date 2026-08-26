import * as vscode from "vscode";
import { registerLanguageFeatures } from "../language/registration";
import { registerShowPrompterCommand } from "./commands/showPrompter";
import { registerDdsVisualEditor } from "../dds/editorProvider";

export function activate(context: vscode.ExtensionContext): void {
  registerLanguageFeatures(context);
  registerShowPrompterCommand(context);
  registerDdsVisualEditor(context);
}

export function deactivate(): void {
  // No-op for now
}
