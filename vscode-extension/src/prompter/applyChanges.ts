import * as vscode from "vscode";
import type { PrompterDefinition } from "./types";
import type { ResolvedPosition } from "./positionResolver";
import { getLogicalCommandRange } from "../language/clContinuation";
import { isEditAllowedRange } from "../language/rpgEditGuards";

export interface AppliedValues {
  readonly [parameterName: string]: string;
}

export async function applyChanges(
  editor: vscode.TextEditor,
  definition: PrompterDefinition,
  resolved: ResolvedPosition,
  values: AppliedValues
): Promise<void> {
  const { document } = editor;

  if (resolved.language === "cl") {
    const logical = getLogicalCommandRange(document, resolved.line);
    const newText = buildClCommandText(definition.keyword, values);
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

  if (!isEditAllowedRange(document, range)) {
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

function buildClCommandText(
  keyword: string,
  values: AppliedValues
): string {
  const parts: string[] = [keyword];

  const names = Object.keys(values);
  for (const name of names) {
    const value = values[name].trim();
    if (value.length === 0) {
      continue;
    }
    parts.push(value);
  }

  return parts.join(" ");
}

function buildRpgLineText(
  original: string,
  definition: PrompterDefinition,
  values: AppliedValues
): string {
  // JSON / 組み込み定義に sourceStart/sourceLength が指定されている場合のみ、
  // その範囲に値を書き戻す。指定がない場合は元の行をそのまま返す。
  const hasColumnInfo = definition.parameters.some(parameter =>
    typeof parameter.sourceStart === "number" &&
    typeof parameter.sourceLength === "number" &&
    parameter.sourceStart > 0 &&
    parameter.sourceLength > 0
  );

  if (!hasColumnInfo) {
    console.log(
      "[rpgClSupport] buildRpgLineText: no column info",
      JSON.stringify({
        keyword: definition.keyword,
        parameterNames: definition.parameters.map(parameter => parameter.name)
      })
    );
    return original;
  }

  const chars = original.split("");

  for (const parameter of definition.parameters) {
    const paramName = parameter.name.toUpperCase();

    // COMMENT は列情報を持たない想定なので、81 桁目以降に書き戻す
    if (
      paramName === "COMMENT" &&
      (typeof parameter.sourceStart !== "number" ||
        typeof parameter.sourceLength !== "number")
    ) {
      const rawComment = (values[parameter.name] ?? "").toString();
      const trimmedComment = rawComment.trim();
      const maxCommentLength = parameter.attributes?.maxLength ?? 50;
      const commentStartIndex = 80; // 81 桁目 (0 始まりインデックス)
      const commentEndIndex = commentStartIndex + maxCommentLength;

      if (chars.length < commentEndIndex) {
        for (let i = chars.length; i < commentEndIndex; i += 1) {
          chars[i] = " ";
        }
      }

      // 一旦コメント領域を空白でクリア
      for (let i = commentStartIndex; i < commentEndIndex; i += 1) {
        chars[i] = " ";
      }

      if (trimmedComment.length > 0) {
        const commentText =
          trimmedComment.length > maxCommentLength
            ? trimmedComment.slice(0, maxCommentLength)
            : trimmedComment;

        for (let i = 0; i < commentText.length; i += 1) {
          const idx = commentStartIndex + i;
          chars[idx] = commentText.charAt(i);
        }
      }

      continue;
    }

    if (
      typeof parameter.sourceStart !== "number" ||
      typeof parameter.sourceLength !== "number" ||
      parameter.sourceStart <= 0 ||
      parameter.sourceLength <= 0
    ) {
      continue;
    }

    const raw = (values[parameter.name] ?? "").toString();
    const trimmed = raw.trim();

    const isNumericField =
      parameter.inputType === "number" || parameter.attributes?.numericOnly;

    const padded = (() => {
      if (trimmed.length > parameter.sourceLength) {
        // 桁溢れ時は右側を優先して切り詰める
        return trimmed.slice(-parameter.sourceLength);
      }

      // 数値系は右寄せ、それ以外は左寄せ
      if (isNumericField) {
        return trimmed.padStart(parameter.sourceLength, " ");
      }

      return trimmed.padEnd(parameter.sourceLength, " ");
    })();

    const startIndex = parameter.sourceStart - 1;
    const endIndex = startIndex + parameter.sourceLength;

    // 長さに応じて行長を伸ばす
    if (chars.length < endIndex) {
      for (let i = chars.length; i < endIndex; i += 1) {
        chars[i] = " ";
      }
    }

    for (let i = 0; i < padded.length; i += 1) {
      const idx = startIndex + i;
      chars[idx] = padded.charAt(i);
    }
  }

  const result = chars.join("").replace(/\s+$/u, "");

  console.log(
    "[rpgClSupport] buildRpgLineText result",
    JSON.stringify({
      keyword: definition.keyword,
      original,
      values,
      result
    })
  );

  return result;
}
