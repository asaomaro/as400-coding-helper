import * as vscode from "vscode";
import { isEditAllowedRange } from "./rpgEditGuards";
import { resolvePosition } from "../prompter/positionResolver";

type Direction = "next" | "previous";

interface MoveComputation {
  readonly line: number;
  readonly character: number;
  readonly edits: vscode.TextEdit[];
}

type RpgKeywordColumns = Map<string, readonly number[]>;

let cachedRpgKeywordColumns: RpgKeywordColumns | undefined;
let cachedClKeywordColumns: readonly number[] | undefined;

export function registerRpgTabNavigation(
  context: vscode.ExtensionContext
): void {
  const nextDisposable = vscode.commands.registerCommand(
    "rpgClSupport.rpgTabNext",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      await moveToKeywordColumn(editor, context, "next");
    }
  );

  const previousDisposable = vscode.commands.registerCommand(
    "rpgClSupport.rpgTabPrevious",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      await moveToKeywordColumn(editor, context, "previous");
    }
  );

  context.subscriptions.push(nextDisposable, previousDisposable);
}

async function moveToKeywordColumn(
  editor: vscode.TextEditor,
  context: vscode.ExtensionContext,
  direction: Direction
): Promise<void> {
  const { document } = editor;

  if (!isSupportedDocument(document)) {
    return;
  }

  const computation = await computeMove(document, editor.selection.active, context, direction);
  if (!computation) {
    return;
  }

  if (computation.edits.length > 0) {
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.set(document.uri, computation.edits);
    await vscode.workspace.applyEdit(workspaceEdit);
  }

  const newCursorPosition = new vscode.Position(
    computation.line,
    computation.character
  );
  editor.selections = [
    new vscode.Selection(newCursorPosition, newCursorPosition)
  ];
}

function isSupportedDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "rpg-fixed" || document.languageId === "cl";
}

async function computeMove(
  document: vscode.TextDocument,
  position: vscode.Position,
  context: vscode.ExtensionContext,
  direction: Direction
): Promise<MoveComputation | undefined> {
  const lineIndex = position.line;
  const currentChar = position.character;

  if (document.languageId === "rpg-fixed") {
    const line = document.lineAt(lineIndex);
    const base = line.text.padEnd(7, " ");
    const marker = base.charAt(6);

    if (marker === "*") {
      const edits: vscode.TextEdit[] = [];

      if (direction === "next") {
        addTrimTrailingSpacesEdit(document, lineIndex, edits);

        if (lineIndex + 1 >= document.lineCount) {
          return {
            line: lineIndex,
            character: line.text.length,
            edits
          };
        }

        const targetLineIndex = lineIndex + 1;
        const targetLine = document.lineAt(targetLineIndex);
        const targetBase = targetLine.text.padEnd(7, " ");
        const targetMarker = targetBase.charAt(6);

        let targetCharacter = 0;

        if (targetMarker === "*") {
          targetCharacter = targetLine.text.length;
        } else {
          const targetColumns = await getKeywordColumnsForLine(
            document,
            targetLineIndex,
            context
          );

          if (targetColumns && targetColumns.length > 0) {
            targetCharacter = targetColumns[0];
          }
        }

        return {
          line: targetLineIndex,
          character: targetCharacter,
          edits
        };
      }

      if (direction === "previous") {
        if (lineIndex === 0) {
          return {
            line: lineIndex,
            character: line.text.length,
            edits
          };
        }

        addTrimTrailingSpacesEdit(document, lineIndex, edits);

        const targetLineIndex = lineIndex - 1;
        const targetLine = document.lineAt(targetLineIndex);
        const targetBase = targetLine.text.padEnd(7, " ");
        const targetMarker = targetBase.charAt(6);

        let targetCharacter = 0;

        if (targetMarker === "*") {
          targetCharacter = targetLine.text.length;
        } else {
          const targetColumns = await getKeywordColumnsForLine(
            document,
            targetLineIndex,
            context
          );

          if (targetColumns && targetColumns.length > 0) {
            targetCharacter =
              targetColumns[targetColumns.length - 1] ?? targetCharacter;
          }
        }

        return {
          line: targetLineIndex,
          character: targetCharacter,
          edits
        };
      }

      return undefined;
    }
  }

  const columnsForCurrentLine = await getKeywordColumnsForLine(
    document,
    lineIndex,
    context
  );

  if (!columnsForCurrentLine || columnsForCurrentLine.length === 0) {
    return undefined;
  }

  const edits: vscode.TextEdit[] = [];

  if (direction === "next") {
    const targetChar = columnsForCurrentLine.find(column => column > currentChar);

    if (targetChar !== undefined) {
      const finalChar = preparePaddingEdits(
        document,
        lineIndex,
        targetChar,
        edits
      );

      return {
        line: lineIndex,
        character: finalChar,
        edits
      };
    }

    const nextLineResult = await findNextLineWithColumns(
      document,
      lineIndex + 1,
      context
    );

    if (!nextLineResult) {
      return {
        line: lineIndex,
        character: currentChar,
        edits
      };
    }

    const [nextLineIndex, nextLineColumns] = nextLineResult;

    if (document.languageId === "rpg-fixed") {
      const targetLine = document.lineAt(nextLineIndex);
      const targetBase = targetLine.text.padEnd(7, " ");
      const targetMarker = targetBase.charAt(6);

      addTrimTrailingSpacesEdit(document, lineIndex, edits);

      if (targetMarker === "*") {
        return {
          line: nextLineIndex,
          character: targetLine.text.length,
          edits
        };
      }
    } else {
      addTrimTrailingSpacesEdit(document, lineIndex, edits);
    }

    const targetCharNextLine = nextLineColumns[0];
    const finalCharNextLine = preparePaddingEdits(
      document,
      nextLineIndex,
      targetCharNextLine,
      edits
    );

    return {
      line: nextLineIndex,
      character: finalCharNextLine,
      edits
    };
  }

  const candidates = columnsForCurrentLine.filter(
    column => column < currentChar
  );

  if (candidates.length > 0) {
    const targetChar = candidates[candidates.length - 1];
    const finalChar = preparePaddingEdits(
      document,
      lineIndex,
      targetChar,
      edits
    );

    return {
      line: lineIndex,
      character: finalChar,
      edits
    };
  }

  const previousLineResult = await findPreviousLineWithColumns(
    document,
    lineIndex - 1,
    context
  );

  if (!previousLineResult) {
    return {
      line: lineIndex,
      character: currentChar,
      edits
    };
  }

  const [previousLineIndex, previousLineColumns] = previousLineResult;

  if (document.languageId === "rpg-fixed") {
    const targetLine = document.lineAt(previousLineIndex);
    const targetBase = targetLine.text.padEnd(7, " ");
    const targetMarker = targetBase.charAt(6);

    addTrimTrailingSpacesEdit(document, lineIndex, edits);

    if (targetMarker === "*") {
      return {
        line: previousLineIndex,
        character: targetLine.text.length,
        edits
      };
    }
  }

  const targetCharPreviousLine =
    previousLineColumns[previousLineColumns.length - 1];
  const finalCharPreviousLine = preparePaddingEdits(
    document,
    previousLineIndex,
    targetCharPreviousLine,
    edits
  );

  return {
    line: previousLineIndex,
    character: finalCharPreviousLine,
    edits
  };
}

async function getKeywordColumnsForLine(
  document: vscode.TextDocument,
  lineIndex: number,
  context: vscode.ExtensionContext
): Promise<readonly number[] | undefined> {
  const languageId = document.languageId;

  if (languageId === "cl") {
    const clColumns = await getClKeywordColumns(context);
    return clColumns;
  }

  const resolved = resolvePosition(
    document,
    new vscode.Position(lineIndex, 0)
  );

  if (!resolved) {
    return undefined;
  }

  const rpgColumns = await getRpgKeywordColumns(context);
  const columns = rpgColumns.get(resolved.keyword);

  return columns;
}

function preparePaddingEdits(
  document: vscode.TextDocument,
  lineIndex: number,
  targetChar: number,
  edits: vscode.TextEdit[]
): number {
  const line = document.lineAt(lineIndex);
  const currentLength = line.text.length;

  if (currentLength >= targetChar) {
    return targetChar;
  }

  const paddingLength = targetChar - currentLength;
  const padding = " ".repeat(paddingLength);
  const insertPosition = new vscode.Position(lineIndex, currentLength);
  const insertRange = new vscode.Range(insertPosition, insertPosition);

  if (!isEditAllowedRange(document, insertRange)) {
    return currentLength;
  }

  edits.push(vscode.TextEdit.insert(insertPosition, padding));
  return targetChar;
}

function addTrimTrailingSpacesEdit(
  document: vscode.TextDocument,
  lineIndex: number,
  edits: vscode.TextEdit[]
): void {
  const line = document.lineAt(lineIndex);
  const text = line.text;

  const trimmedLength = text.replace(/\s+$/u, "").length;

  if (trimmedLength === text.length) {
    return;
  }

  const start = new vscode.Position(lineIndex, trimmedLength);
  const end = new vscode.Position(lineIndex, text.length);
  const range = new vscode.Range(start, end);

  if (!isEditAllowedRange(document, range)) {
    return;
  }

  edits.push(vscode.TextEdit.delete(range));
}

async function findNextLineWithColumns(
  document: vscode.TextDocument,
  startLineIndex: number,
  context: vscode.ExtensionContext
): Promise<[number, readonly number[]] | undefined> {
  for (
    let lineIndex = startLineIndex;
    lineIndex < document.lineCount;
    lineIndex += 1
  ) {
    const columns = await getKeywordColumnsForLine(
      document,
      lineIndex,
      context
    );

    if (columns && columns.length > 0) {
      return [lineIndex, columns];
    }
  }

  return undefined;
}

async function findPreviousLineWithColumns(
  document: vscode.TextDocument,
  startLineIndex: number,
  context: vscode.ExtensionContext
): Promise<[number, readonly number[]] | undefined> {
  for (let lineIndex = startLineIndex; lineIndex >= 0; lineIndex -= 1) {
    const columns = await getKeywordColumnsForLine(
      document,
      lineIndex,
      context
    );

    if (columns && columns.length > 0) {
      return [lineIndex, columns];
    }
  }

  return undefined;
}

async function getRpgKeywordColumns(
  context: vscode.ExtensionContext
): Promise<RpgKeywordColumns> {
  if (cachedRpgKeywordColumns) {
    return cachedRpgKeywordColumns;
  }

  const map: RpgKeywordColumns = new Map();

  try {
    const uri = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "navigation",
      "rpg-fixed-keyword-columns.json"
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const raw = document.getText();
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    for (const [key, value] of Object.entries(parsed)) {
      const columns = parseColumnsValue(value);
      if (columns.length > 0) {
        map.set(key.toUpperCase(), columns);
      }
    }
  } catch (error) {
    console.log(
      "[rpgClSupport] failed to load RPG keyword column definitions",
      String(error)
    );
  }

  cachedRpgKeywordColumns = map;
  return map;
}

async function getClKeywordColumns(
  context: vscode.ExtensionContext
): Promise<readonly number[] | undefined> {
  if (cachedClKeywordColumns) {
    return cachedClKeywordColumns;
  }

  try {
    const uri = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "navigation",
      "cl-keyword-columns.json"
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const raw = document.getText();
    const parsed = JSON.parse(raw) as unknown;
    const columns = parseColumnsValue(parsed);

    if (columns.length > 0) {
      cachedClKeywordColumns = columns;
      return columns;
    }
  } catch (error) {
    console.log(
      "[rpgClSupport] failed to load CL keyword column definitions",
      String(error)
    );
  }

  cachedClKeywordColumns = [];
  return cachedClKeywordColumns;
}

function parseColumnsValue(value: unknown): number[] {
  if (typeof value === "string") {
    return parseColumnsFromString(value);
  }

  if (Array.isArray(value)) {
    return parseColumnsFromArray(value);
  }

  if (
    value &&
    typeof value === "object" &&
    "columns" in value &&
    (typeof (value as { columns?: unknown }).columns === "string" ||
      Array.isArray((value as { columns?: unknown }).columns))
  ) {
    const inner = (value as { columns: unknown }).columns;
    return parseColumnsValue(inner);
  }

  return [];
}

function parseColumnsFromString(raw: string): number[] {
  const parts = raw.split(/[,、\s]+/u).filter(part => part.length > 0);
  const columns: number[] = [];

  for (const part of parts) {
    const parsed = Number(part);
    if (Number.isFinite(parsed) && parsed > 0) {
      columns.push(parsed - 1);
    }
  }

  return columns.sort((a, b) => a - b);
}

function parseColumnsFromArray(values: unknown[]): number[] {
  const columns: number[] = [];

  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      columns.push(Math.floor(value) - 1);
    } else if (typeof value === "string") {
      const nested = parseColumnsFromString(value);
      columns.push(...nested);
    }
  }

  return columns.sort((a, b) => a - b);
}
