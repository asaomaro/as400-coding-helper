import * as vscode from "vscode";
import { isInScopeDocument } from "../utils/fileScope";
import { parseClDocument } from "./clParser";
import { lintDocument } from "./lintDiagnostics";

export class RpgClDiagnostics {
  private readonly collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection(
      "rpgClSupport"
    );
  }

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(this.collection);

    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument(document =>
        this.refresh(document)
      ),
      vscode.workspace.onDidChangeTextDocument(event =>
        this.refresh(event.document)
      ),
      vscode.workspace.onDidCloseTextDocument(document =>
        this.collection.delete(document.uri)
      )
    );
  }

  refresh(document: vscode.TextDocument): void {
    if (!isInScopeDocument(document)) {
      return;
    }

    let diagnostics: vscode.Diagnostic[] = [];

    if (
      document.languageId === "cl" ||
      document.uri.fsPath.toLowerCase().endsWith(".clp")
    ) {
      diagnostics = parseClDocument(document);
    } else {
      // RPG / DDS の桁位置検査。CL 側の既存の診断とは経路を分ける
      // （CL は自由形式で桁の規定が原典に無いため lint の対象外）。
      diagnostics = lintDocument(document);
    }

    this.collection.set(document.uri, diagnostics);
  }
}
