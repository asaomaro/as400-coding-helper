import * as vscode from "vscode";
import type { PrompterDefinition } from "./types";
import type { ResolvedPosition } from "./positionResolver";
import { getLogicalCommandRange } from "../language/clContinuation";
import { isEditAllowedRange } from "../language/rpgEditGuards";
import { continuedNameParameter, writeContinuedName } from "./rpgNameContinuation";
import {
  extractComments,
  joinContinuationLines,
  parseClCommand
} from "./clCommandParser";
import {
  buildClCommandText,
  buildRpgLineText,
  narrowToEditableColumns,
  type AppliedValues
} from "./commandText";

// 組み立てそのものは `commandText.ts`（`vscode` 非依存）。ここは**文書を書き換える所**だけ。
// 呼び出し側の import を壊さないよう、そのまま再輸出する。
export {
  buildClCommandBody,
  buildClCommandText,
  buildRpgLineText,
  type AppliedValues,
  type ClCommandContext
} from "./commandText";

/** RPG 固定長の 4 行目で変えない先頭の桁数（FR-031。`rpgEditGuards.ts`）。 */
const PROTECTED_COLUMNS = 6;

export async function applyChanges(
  editor: vscode.TextEditor,
  definition: PrompterDefinition,
  resolved: ResolvedPosition,
  values: AppliedValues
): Promise<void> {
  const { document } = editor;

  if (resolved.language === "cl" || resolved.language === "cmd") {
    const logical = getLogicalCommandRange(document, resolved.line);

    // ラベルとコメントは入力欄に現れないため、元のソースから引き継ぐ。
    const originalLines: string[] = [];
    for (let line = logical.range.start.line; line <= logical.range.end.line; line += 1) {
      originalLines.push(document.lineAt(line).text);
    }
    const parsed = parseClCommand(joinContinuationLines(originalLines));

    const newText = buildClCommandText(definition, values, {
      label: parsed?.label,
      comments: extractComments(originalLines),
      presentParameters: Object.keys(parsed?.parameters ?? {})
    });
    await editor.edit(editBuilder => {
      editBuilder.replace(logical.range, newText);
    });
    return;
  }

  const line = document.lineAt(resolved.line);
  const range = new vscode.Range(
    new vscode.Position(resolved.line, 0),
    new vscode.Position(resolved.line, line.text.length)
  );

  // 桁で書き戻すのは RPG も DDS も同じ（sourceStart / sourceLength を使う）。
  let replaceRange = range;
  // 空行からプロンプト・タイプで開いたときは、6 桁目に仕様書の文字を置いてから組む（P15）。
  const lineText =
    resolved.specLetter !== undefined && resolved.language !== "dds" && line.text.padEnd(6, " ").charAt(5) === " "
      ? line.text.padEnd(6, " ").slice(0, 5) + resolved.specLetter + line.text.slice(6)
      : line.text;
  let newText = buildRpgLineText(lineText, definition, values);

  // 15 桁を超える名前は継続名前行（`…...`）に分けて書く。上にある継続名前行も書き直す（実操作調査の P21）。
  const continued = resolved.language !== "dds" ? continuedNameParameter(definition) : undefined;
  if (continued !== undefined) {
    const base = Math.max(0, resolved.line - 50);
    const lines: string[] = [];
    for (let i = base; i <= resolved.line; i += 1) lines.push(document.lineAt(i).text);
    lines[lines.length - 1] = lineText; // 仕様書の文字を置いた行（空行から開いたとき）
    const raw = values[continued];
    const name = (Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").toString();
    const written = writeContinuedName(lines, lines.length - 1, name, (original, value) =>
      buildRpgLineText(original, definition, { ...values, [continued]: value })
    );
    const fromLine = base + written.from;
    if (fromLine !== resolved.line || written.text.includes("\n")) {
      const multiRange = new vscode.Range(new vscode.Position(fromLine, 0), range.end);
      if (!isEditAllowedRange(document, multiRange)) {
        void vscode.window.showWarningMessage(
          `${resolved.line + 1} 行目の名前は 4 行目にかかる継続名前行になるため、プロンプターの内容を書き込みませんでした。`
        );
        return;
      }
      const multiEdit = new vscode.WorkspaceEdit();
      multiEdit.replace(document.uri, multiRange, written.text);
      await vscode.workspace.applyEdit(multiEdit);
      return;
    }
    newText = written.text;
  }

  // 編集の可否は RPG の桁規則で見ている。DDS は別の固定長なので対象外。
  // 4 行目は 1〜6 桁目を変えない決まり（FR-031）。行全体の置き換えは必ず掛かるので、先頭 6 桁が同じなら 7 桁目以降だけを書く。
  if (resolved.language !== "dds" && !isEditAllowedRange(document, range)) {
    const narrowed = narrowToEditableColumns(line.text, newText, PROTECTED_COLUMNS);
    if (!narrowed.ok) {
      void vscode.window.showWarningMessage(
        `${resolved.line + 1} 行目の 1〜${PROTECTED_COLUMNS} 桁目は変更できないため、プロンプターの内容を書き込みませんでした。`
      );
      return;
    }
    replaceRange = new vscode.Range(
      new vscode.Position(resolved.line, narrowed.start),
      new vscode.Position(resolved.line, line.text.length)
    );
    newText = narrowed.text;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, replaceRange, newText);

  const success = await vscode.workspace.applyEdit(edit);

  console.log(
    "[rpgClSupport] editor.edit finished",
    JSON.stringify({
      uri: document.uri.toString(),
      line: resolved.line,
      success
    })
  );
}
