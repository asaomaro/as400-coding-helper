import * as vscode from "vscode";
import { resolveDefinitionLanguage } from "../prompter/jsonDefinitions";
import { classifyRpgSpecKeyword } from "../prompter/specClassifier";
import { resolveDialect } from "../prompter/dialect";
import { RPG_EXTENSIONS, toGlobPattern } from "../utils/fileScope";

/**
 * RPG（固定長）の補完。
 *
 * 何を出すかは「どの仕様書の、どの桁にいるか」で決まる:
 *   C 仕様の命令コード欄(26-35)  → 命令コード（CHAIN / EVAL / MOVEL …）
 *   H/F/D/P 仕様のキーワード欄    → その仕様書のキーワード（DFTACTGRP / DISK / INZ …）
 *   式の中で % を打った直後        → 組み込み関数（%SUBST / %TRIM …）
 *
 * 候補の出所は原典（ILE RPG 解説書）で、
 * docs/origin/generate-rpg-completion.mjs が生成する。
 */

interface RpgOperation {
  readonly name: string;
  readonly title: string;
  /** 自由形式の構文。旧命令（MOVEL 等）は自由形式に無いため未設定。 */
  readonly freeForm?: string;
  /** 「自由形式では使用不可。EVAL を使うこと」等の注記。 */
  readonly freeFormNote?: string;
  /** 従来型（固定長）の構文。演算項目1/2・結果フィールド・標識の割り当て。 */
  readonly fixedForm?: {
    readonly columns: readonly string[];
    readonly values: readonly string[];
  };
}

interface RpgKeyword {
  readonly name: string;
  readonly syntax: string;
  readonly hasParameters: boolean;
}

interface RpgCompletionData {
  readonly opcodes: readonly RpgOperation[];
  /** RPG III の命令コード。綴りも集合も ILE とは別（実機のコンパイラで確定）。 */
  readonly rpg3Opcodes: readonly RpgOperation[];
  readonly bifs: readonly RpgOperation[];
  readonly keywords: Readonly<Record<string, readonly RpgKeyword[]>>;
}

/**
 * C 仕様の命令コード欄（1 始まり）。方言で桁が違う。
 *   ILE(RPG IV) 26-35 … 名前が伸びた分だけ広い（DATA-INTO 等）
 *   RPG III      28-32 … 5 桁しかないため命令名も 5 文字以内（LOKUP / EXCPT）
 * RPG III の桁は prompter/rpg/rpg3/C-SPEC.json の OPCODE(28) / FACTOR2(33) と一致する。
 */
const OPCODE_RANGE = { ile: { from: 26, to: 35 }, rpg3: { from: 28, to: 32 } };
/** H/F/D/P 仕様のキーワード欄は 44 桁目から（ILE のみ）。 */
const KEYWORD_COLUMN = 44;

let cache: RpgCompletionData | undefined;
let cacheLanguage: string | undefined;

async function loadData(
  context: vscode.ExtensionContext
): Promise<RpgCompletionData | undefined> {
  const language = resolveDefinitionLanguage();
  if (cache && cacheLanguage === language) {
    return cache;
  }

  try {
    const uri = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "completion",
      language === "ja" ? "rpg-completion.json" : `rpg-completion.${language}.json`
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const ile = JSON.parse(document.getText()) as RpgCompletionData;

    const rpg3Uri = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "completion",
      language === "ja" ? "rpg3-completion.json" : `rpg3-completion.${language}.json`
    );
    const rpg3Document = await vscode.workspace.openTextDocument(rpg3Uri);
    const rpg3 = JSON.parse(rpg3Document.getText()) as { opcodes: RpgOperation[] };

    cache = { ...ile, rpg3Opcodes: rpg3.opcodes };
    cacheLanguage = language;
    return cache;
  } catch (error) {
    console.log("[rpgClSupport] failed to load RPG completion data", String(error));
    return undefined;
  }
}

/** その位置で出すべき候補の種類。 */
export type RpgCompletionKind =
  | { kind: "opcode"; dialect: "ile" | "rpg3" }
  | { kind: "bif" }
  | { kind: "keyword"; spec: string }
  | undefined;

/**
 * 行と桁から、出す候補の種類を決める。
 * 注記行（7 桁目が `*`）では何も出さない。
 */
export function resolveCompletionKind(
  line: string,
  character: number,
  specKeyword: string | undefined,
  dialect?: string
): RpgCompletionKind {
  if (!specKeyword) return undefined;
  if (line.length > 6 && line.charAt(6) === "*") return undefined;

  const column = character + 1; // 1 始まりの桁
  const isRpg3 = dialect === "rpg3";

  // % を打った直後は組み込み関数。式はどの欄にも書けるので桁で絞らない。
  // ただし組み込み関数は RPG IV で入ったもので RPG III には無い。
  const before = line.slice(0, character);
  if (/%[A-Za-z0-9]*$/u.test(before)) {
    return isRpg3 ? undefined : { kind: "bif" };
  }

  if (specKeyword.startsWith("C-")) {
    const range = isRpg3 ? OPCODE_RANGE.rpg3 : OPCODE_RANGE.ile;
    if (column >= range.from && column <= range.to + 1) {
      return { kind: "opcode", dialect: isRpg3 ? "rpg3" : "ile" };
    }
    return undefined;
  }

  // 仕様書キーワードは ILE のもの。RPG III の H/F 仕様は 71 桁目まで固定欄で、
  // 自由に書けるキーワード欄が無い（prompter/rpg/rpg3/F-SPEC.json 参照）。
  // ここで候補を出すと固定欄の途中に語を挿し込むことになる。
  if (isRpg3) return undefined;

  if (/^[HFDP]-SPEC$/u.test(specKeyword) && column >= KEYWORD_COLUMN) {
    return { kind: "keyword", spec: specKeyword };
  }

  return undefined;
}

/** 入力中の語（英数字と % の並び）を取り出す。 */
function currentWord(line: string, character: number): number {
  let start = character;
  while (start > 0 && /[A-Za-z0-9%-]/u.test(line.charAt(start - 1))) {
    start -= 1;
  }
  return start;
}

function buildDocumentation(operation: RpgOperation): vscode.MarkdownString {
  const documentation = new vscode.MarkdownString();

  if (operation.fixedForm) {
    // 従来型は「どの演算項目に何を書くか」が要点なので、対応で見せる。
    const { columns, values } = operation.fixedForm;
    const lines = columns
      .map((column, index) => {
        const value = values[index] ?? "";
        return value ? `${column}: ${value}` : undefined;
      })
      .filter((line): line is string => Boolean(line));
    if (lines.length > 0) {
      documentation.appendCodeblock(lines.join("\n"), "text");
    }
  }

  if (operation.freeForm) {
    documentation.appendCodeblock(operation.freeForm, "text");
  }
  if (operation.freeFormNote) {
    documentation.appendMarkdown(`\n${operation.freeFormNote}\n`);
  }

  return documentation;
}

export function registerRpgCompletion(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const provider: vscode.CompletionItemProvider = {
    async provideCompletionItems(document, position) {
      const line = document.lineAt(position.line).text;

      // 仕様書種別は specClassifier に集約（ルーラー・プロンプターと共有）。
      const preceding: string[] = [];
      for (let above = 0; above < position.line; above += 1) {
        preceding.push(document.lineAt(above).text);
      }
      const dialect = resolveDialect(document);
      const specKeyword = classifyRpgSpecKeyword(line, dialect, preceding);

      const target = resolveCompletionKind(line, position.character, specKeyword, dialect);
      if (!target) return undefined;

      const data = await loadData(context);
      if (!data) return undefined;

      const start = currentWord(line, position.character);
      const range = new vscode.Range(
        new vscode.Position(position.line, start),
        position
      );

      if (target.kind === "keyword") {
        const keywords = data.keywords[target.spec] ?? [];
        return keywords.map(keyword => {
          const item = new vscode.CompletionItem(
            keyword.name,
            vscode.CompletionItemKind.Keyword
          );
          item.range = range;
          item.detail = keyword.syntax;
          if (keyword.hasParameters) {
            item.insertText = new vscode.SnippetString(`${keyword.name}($0)`);
          }
          return item;
        });
      }

      const operations =
        target.kind === "bif"
          ? data.bifs
          : target.dialect === "rpg3"
            ? data.rpg3Opcodes
            : data.opcodes;
      return operations.map(operation => {
        const item = new vscode.CompletionItem(
          operation.name,
          target.kind === "bif"
            ? vscode.CompletionItemKind.Function
            : vscode.CompletionItemKind.Keyword
        );
        item.range = range;
        item.detail = operation.title;

        // 組み込み関数は必ず引数を取るので括弧まで入れる。
        if (target.kind === "bif") {
          item.insertText = new vscode.SnippetString(`${operation.name}($0)`);
        }

        const documentation = buildDocumentation(operation);
        if (documentation.value.length > 0) {
          item.documentation = documentation;
        }
        return item;
      });
    }
  };

  // 拡張子は fileScope.ts の RPG_EXTENSIONS が単一の真実源（手書きの glob は
  // 増えた拡張子を落としやすい）。languageId 側は .rpgle / .rpg の登録分を拾う。
  return vscode.languages.registerCompletionItemProvider(
    [
      { scheme: "file", language: "rpg-fixed" },
      { scheme: "file", pattern: toGlobPattern(RPG_EXTENSIONS) }
    ],
    provider,
    "%"
  );
}
