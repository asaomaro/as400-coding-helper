import * as vscode from "vscode";
import type { PrompterDefinition } from "./types";
import type { ResolvedPosition } from "./positionResolver";
import { getLogicalCommandRange } from "../language/clContinuation";
import { isEditAllowedRange } from "../language/rpgEditGuards";
import {
  extractComments,
  joinContinuationLines,
  parseClCommand
} from "./clCommandParser";
import {
  buildClCommandText,
  buildRpgLineText,
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

  // 編集の可否は RPG の桁規則で見ている。DDS は別の固定長なので対象外。
  if (resolved.language !== "dds" && !isEditAllowedRange(document, range)) {
    console.log(
      "[rpgClSupport] RPG edit not allowed",
      JSON.stringify({
        uri: document.uri.toString(),
        line: resolved.line,
        start: range.start.character,
        end: range.end.character
      })
    );
    return;
  }

  // 桁で書き戻すのは RPG も DDS も同じ（sourceStart / sourceLength を使う）。
  const newText = buildRpgLineText(line.text, definition, values);

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, range, newText);

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
