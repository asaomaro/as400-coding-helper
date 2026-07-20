import * as vscode from "vscode";
import { resolveDefinitionLanguage } from "../prompter/jsonDefinitions";
import { DDS_EXTENSIONS, toDocumentSelector } from "../utils/fileScope";
import {
  DDS_COLUMNS,
  ddsField,
  isDdsCommentLine,
  levelOfLine,
  type DdsLevel
} from "./ddsLayout";

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
  /**
   * 使用レベル。原典の索引と各キーワードの詳細ページから取る。
   * 判別できなかったものは未設定で、その場合はどのレベルでも出す
   * （出すべきものを隠すより、余分に出す方が害が少ない）。
   */
  readonly level?: readonly string[];
  readonly description?: string;
  /** 構文。複数の書き方があるキーワードは複数行になる。 */
  readonly syntax?: readonly string[];
  /** パラメータを取るか。false なら括弧を付けない。 */
  readonly hasParameters?: boolean;
}

type DdsType = "DDS-PF" | "DDS-DSPF" | "DDS-PRTF";

/** キーワード項目の開始桁（1 始まり）。ここより手前では補完を出さない。 */
const KEYWORD_COLUMN = 45;

// 使用レベルと 17 桁目の対応、桁の定義は ddsLayout に集約している
// （キーワード補完とアウトラインで同じ規約を共有するため）。
export type { DdsLevel } from "./ddsLayout";

/**
 * その行が属するレベルを求める。
 *
 * レベルはその行だけでは決まらない。キーワードだけの行（17 桁目も名前欄も空）は
 * 直前のレコードやフィールドの続きなので、レベルを決めた行まで遡る必要がある。
 * 遡っても見つからなければファイル・レベル（最初のレコードより前）。
 */
export function resolveDdsLevel(
  lineAt: (index: number) => string,
  lineIndex: number
): DdsLevel {
  for (let index = lineIndex; index >= 0; index -= 1) {
    const text = lineAt(index);

    // 注記行は桁の意味を持たないので飛ばす。
    if (isDdsCommentLine(text)) {
      continue;
    }

    const level = levelOfLine(text);
    if (level) {
      return level;
    }

    // 17 桁目が空でも名前があればフィールド。名前も無ければ続きの行なので遡る。
    if (ddsField(text, DDS_COLUMNS.name).trim().length > 0) {
      return "field";
    }
  }

  return "file";
}

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
  if (isDdsCommentLine(line)) {
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

      const all = (await loadKeywords(context)).get(type) ?? [];
      if (all.length === 0) {
        return undefined;
      }

      // その行のレベルで書けるものだけに絞る。レベルが分からないものは残す。
      const level = resolveDdsLevel(index => document.lineAt(index).text, position.line);
      const keywords = all.filter(
        keyword => !keyword.level?.length || keyword.level.includes(level)
      );

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
        // 同じレベルで書けるものを上に出す（絞り込みの結果が見て分かるように）。
        item.sortText = keyword.level?.length ? `0${keyword.name}` : `1${keyword.name}`;

        // パラメータを取るキーワードは括弧まで入れて中にカーソルを置く。
        // 取らないものに括弧を付けると構文誤りになるため付けない。
        if (keyword.hasParameters) {
          item.insertText = new vscode.SnippetString(`${keyword.name}($0)`);
        }

        const documentation = new vscode.MarkdownString();
        if (keyword.syntax?.length) {
          documentation.appendCodeblock(keyword.syntax.join("\n"), "text");
        }
        if (keyword.level) {
          documentation.appendMarkdown(`\n\`${keyword.level.join(" / ")}\`\n\n`);
        }
        if (keyword.description) {
          documentation.appendText(keyword.description);
        }
        if (documentation.value.length > 0) {
          item.documentation = documentation;
        }
        return item;
      });
    }
  };

  // DDS は言語登録していない（拡張子だけで扱う方針）ため、
  // languageId ではなく scheme+pattern で対象を絞る。
  // 拡張子は fileScope.ts の DDS_EXTENSIONS が単一の真実源（手書きの glob は
  // 実際に `.dds` を落としていた）。
  return vscode.languages.registerCompletionItemProvider(
    toDocumentSelector(DDS_EXTENSIONS),
    provider
  );
}
