import * as vscode from "vscode";
import { isInScopeDocument } from "../utils/fileScope";
import { parseClDocument } from "./clParser";

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
    }

    this.collection.set(document.uri, diagnostics);
  }
}
