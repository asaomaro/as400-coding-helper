import * as vscode from "vscode";
import { resolveDefinitionLanguage } from "../prompter/jsonDefinitions";

/**
 * DDS のキーワード補完。
 *
 * DDS は 45-80 桁が機能欄（キーワード項目）で、実質的な記述はここに集中する。
 * キーワードは用途（物理/論理・表示装置・印刷装置）で使えるものが違うため、
 * 拡張子から種別を決めて絞り込む。
 *
 * 補完候補の出所は原典（IBM Documentation の各キーワード索引）で、
 * docs/origin/generate-dds-keywords.mjs が生成する。
 */

interface DdsKeyword {
  readonly name: string;
  /** 和名・英名（「音響警報」「Audible Alarm」）。 */
  readonly title: string;
  /** 使用レベル（file/record/field/help/key/join）。原典から判別できた分だけ。 */
  readonly level?: readonly string[];
  readonly description?: string;
}

type DdsType = "DDS-PF" | "DDS-DSPF" | "DDS-PRTF";

/** キーワード項目の開始桁（1 始まり）。ここより手前では補完を出さない。 */
const KEYWORD_COLUMN = 45;

let cache: Map<DdsType, readonly DdsKeyword[]> | undefined;
let cacheLanguage: string | undefined;

/** 拡張子から DDS の種別を決める（ルーラーの specFamily と同じ規約）。 */
export function resolveDdsType(fsPath: string): DdsType | undefined {
  const lower = fsPath.toLowerCase();
  if (/\.(pf|lf)$/u.test(lower)) return "DDS-PF";
  if (/\.(dspf|mnudds)$/u.test(lower)) return "DDS-DSPF";
  if (/\.(prtf)$/u.test(lower)) return "DDS-PRTF";
  return undefined;
}

async function loadKeywords(
  context: vscode.ExtensionContext
): Promise<Map<DdsType, readonly DdsKeyword[]>> {
  const language = resolveDefinitionLanguage();
  if (cache && cacheLanguage === language) {
    return cache;
  }

  const map = new Map<DdsType, readonly DdsKeyword[]>();
  try {
    const uri = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "completion",
      language === "ja" ? "dds-keywords.json" : `dds-keywords.${language}.json`
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const parsed = JSON.parse(document.getText()) as Record<string, DdsKeyword[]>;
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        map.set(key as DdsType, value);
      }
    }
  } catch (error) {
    console.log("[rpgClSupport] failed to load DDS keywords", String(error));
  }

  cache = map;
  cacheLanguage = language;
  return map;
}

/**
 * カーソル位置がキーワード欄（45 桁目以降）かどうか。
 * 注記行（7 桁目が `*`）では 8 桁目以降が本文なので補完しない。
 */
export function isKeywordArea(line: string, character: number): boolean {
  if (line.length > 6 && line.charAt(6) === "*") {
    return false;
  }
  return character >= KEYWORD_COLUMN - 1;
}

/** 入力中のキーワード（英大文字の並び）を取り出す。 */
function currentWord(line: string, character: number): { text: string; start: number } {
  let start = character;
  while (start > 0 && /[A-Za-z0-9]/u.test(line.charAt(start - 1))) {
    start -= 1;
  }
  return { text: line.slice(start, character), start };
}

export function registerDdsKeywordCompletion(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const provider: vscode.CompletionItemProvider = {
    async provideCompletionItems(document, position) {
      const type = resolveDdsType(document.uri.fsPath);
      if (!type) {
        return undefined;
      }

      const line = document.lineAt(position.line).text;
      if (!isKeywordArea(line, position.character)) {
        return undefined;
      }

      const keywords = (await loadKeywords(context)).get(type) ?? [];
      if (keywords.length === 0) {
        return undefined;
      }

      const word = currentWord(line, position.character);
      const range = new vscode.Range(
        new vscode.Position(position.line, word.start),
        position
      );

      return keywords.map(keyword => {
        const item = new vscode.CompletionItem(
          keyword.name,
          vscode.CompletionItemKind.Keyword
        );
        item.detail = keyword.title;
        item.range = range;
        if (keyword.description) {
          const documentation = new vscode.MarkdownString();
          if (keyword.level) {
            documentation.appendMarkdown(`\`${keyword.level.join(" / ")}\`\n\n`);
          }
          documentation.appendText(keyword.description);
          item.documentation = documentation;
        }
        return item;
      });
    }
  };

  // DDS は言語登録していない（拡張子だけで扱う方針）ため、
  // languageId ではなく scheme+pattern で対象を絞る。
  return vscode.languages.registerCompletionItemProvider(
    [
      { scheme: "file", pattern: "**/*.{pf,lf,dspf,prtf,mnudds}" },
      { scheme: "untitled", pattern: "**/*.{pf,lf,dspf,prtf,mnudds}" }
    ],
    provider
  );
}
