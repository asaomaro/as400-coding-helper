import * as vscode from "vscode";
import type { PrompterDefinition } from "./types";
import type { ResolvedPosition } from "./positionResolver";
import { getLogicalCommandRange } from "../language/clContinuation";
import { isEditAllowedRange } from "../language/rpgEditGuards";

export interface AppliedValues {
  readonly [parameterName: string]: string | string[];
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
    const newText = buildClCommandText(definition, values);
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
  definition: PrompterDefinition,
  values: AppliedValues
): string {
  const keyword = definition.keyword.toUpperCase();

  // Columns 1–13: label area, column 14: command.
  const labelArea = " ".repeat(13);
  let line = labelArea + keyword;

  // Parameters start at column 25.
  const paramStartColumn = 25; // 1-based
  const desiredParamIndex = paramStartColumn - 1; // 0-based
  if (line.length < desiredParamIndex) {
    line = line.padEnd(desiredParamIndex, " ");
  } else {
    line += " ";
  }

  const paramTokens: string[] = [];

  if (keyword === "CALL") {
    const liblRaw = values.LIBL;
    const objRaw = values.OBJ;

    const libl =
      (Array.isArray(liblRaw) ? liblRaw[0] ?? "" : liblRaw ?? "").trim();
    const obj =
      (Array.isArray(objRaw) ? objRaw[0] ?? "" : objRaw ?? "").trim();

    if (obj.length > 0) {
      const pgmArg = libl.length > 0 ? `${libl}/${obj}` : obj;
      paramTokens.push(`PGM(${pgmArg})`);
    }

    const parmRaw = values.PARM;
    const parmValues = Array.isArray(parmRaw)
      ? parmRaw
      : typeof parmRaw === "string" && parmRaw.length > 0
        ? parmRaw.split(/\r?\n/u)
        : [];

    const cleaned: string[] = [];
    for (const raw of parmValues) {
      const trimmed = String(raw ?? "").trim();
      if (trimmed.length === 0) {
        continue;
      }
      cleaned.push(trimmed);
    }

    if (cleaned.length > 0) {
      paramTokens.push(`PARM(${cleaned.join(" ")})`);
    }
  } else {
    // Generic CL command: NAME(VALUE)
    for (const parameter of definition.parameters) {
      const raw = values[parameter.name];
      const single =
        (Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").trim();
      if (single.length === 0) {
        continue;
      }
      paramTokens.push(`${parameter.name}(${single})`);
    }
  }

  if (paramTokens.length > 0) {
    line += paramTokens.join(" ");
  }

  return line;
}

function buildRpgLineText(
  original: string,
  definition: PrompterDefinition,
  values: AppliedValues
): string {
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

    if (
      paramName === "COMMENT" &&
      (typeof parameter.sourceStart !== "number" ||
        typeof parameter.sourceLength !== "number")
    ) {
      const rawComment = (values[parameter.name] ?? "").toString();
      const trimmedComment = rawComment.trim();
      const maxCommentLength = parameter.attributes?.maxLength ?? 50;
      const commentStartIndex = 80; // column 81 (0-based index)
      const commentEndIndex = commentStartIndex + maxCommentLength;

      if (chars.length < commentEndIndex) {
        for (let i = chars.length; i < commentEndIndex; i += 1) {
          chars[i] = " ";
        }
      }

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

    const rawValue = values[parameter.name];
    const raw =
      (Array.isArray(rawValue) ? rawValue[0] ?? "" : rawValue ?? "").toString();
    const trimmed = raw.trim();

    const isNumericField =
      parameter.inputType === "number" || parameter.attributes?.numericOnly;

    const padded = (() => {
      if (trimmed.length > parameter.sourceLength) {
        return trimmed.slice(-parameter.sourceLength);
      }

      if (isNumericField) {
        return trimmed.padStart(parameter.sourceLength, " ");
      }

      return trimmed.padEnd(parameter.sourceLength, " ");
    })();

    const startIndex = parameter.sourceStart - 1;
    const endIndex = startIndex + parameter.sourceLength;

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
