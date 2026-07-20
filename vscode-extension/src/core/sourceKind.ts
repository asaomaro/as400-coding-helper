import type { Dialect, LanguageId } from "../prompter/types";
import { resolveDialectFromPath } from "./dialect";

/**
 * ファイルパス（拡張子）から「そのソースをどう解釈するか」を決める単一の真実源。
 *
 * 同じ知識が 2 か所にあり、すでに食い違っていた:
 *   - `positionResolver.ts` の拡張子判定（`.dds` を dds 言語として通す）
 *   - `ddsKeywordCompletion.ts` の `resolveDdsType`（`.dds` は undefined を返す）
 * その結果 `.dds` は言語だけ決まって種別が決まらず、プロンプターの解決に失敗する。
 * lint core が 3 つ目の写しを作らないよう、ここに一本化する。
 *
 * **現状の挙動は変えない**（`.dds` は種別未決定のまま）。統合が目的であって
 * 挙動の修正ではないため、直すなら別作業として扱う。
 *
 * このモジュールは **vscode を import しない**。
 */

export type DdsType = "DDS-PF" | "DDS-DSPF" | "DDS-PRTF";

export interface SourceKindInfo {
  readonly language: LanguageId;
  /** language === "dds" のとき。`.dds` は種別が決まらないので undefined。 */
  readonly ddsType?: DdsType;
  /** language === "rpg-fixed" のとき。 */
  readonly dialect?: Dialect;
}

/** 拡張子から DDS の種別を決める（ルーラーの specFamily と同じ規約）。 */
export function resolveDdsType(fsPath: string): DdsType | undefined {
  const lower = fsPath.toLowerCase();
  if (/\.(pf|lf)$/u.test(lower)) return "DDS-PF";
  if (/\.(dspf|mnudds)$/u.test(lower)) return "DDS-DSPF";
  if (/\.(prtf)$/u.test(lower)) return "DDS-PRTF";
  return undefined;
}

/**
 * 拡張子から言語・DDS 種別・方言を導出する。判定できなければ undefined。
 *
 * 判定順は `positionResolver.getLanguageId` の拡張子分岐と同じ。
 * languageId（VSCode が付ける言語）による判定は document が要るので殻側に残す。
 */
export function resolveSourceKind(
  fsPath: string,
  dialectOverrides?: Record<string, unknown>
): SourceKindInfo | undefined {
  const lower = fsPath.toLowerCase();

  // .cmd はコマンド定義ソース。言語登録はしていない（表示系と同じく拡張子で扱う）。
  if (/\.cmd$/u.test(lower)) {
    return { language: "cmd" };
  }

  // DDS。同じ A 仕様書でも用途で桁の意味が変わるので、種別も併せて返す。
  if (/\.(pf|lf|dspf|prtf|mnudds|dds)$/u.test(lower)) {
    return { language: "dds", ddsType: resolveDdsType(fsPath) };
  }

  if (/\.(sqlrpgle|rpgle|sqlrpg|rpg)$/u.test(lower)) {
    return {
      language: "rpg-fixed",
      dialect: resolveDialectFromPath(fsPath, dialectOverrides)
    };
  }

  if (/\.(clle|clp)$/u.test(lower)) {
    return { language: "cl" };
  }

  return undefined;
}

/**
 * lint（桁位置検査）の対象にする拡張子。先頭ドットなし・小文字。
 *
 * CL / `.cmd` は自由形式で桁の規定が原典に無いため含めない。`.dds` は
 * 種別が決まらないため含めない（`resolveDdsType` が undefined を返す）。
 *
 * **`fileScope.ts` の TARGET_EXTENSIONS の部分集合でなければならない。**
 * あちらは「表示系・入力補助を有効にする範囲」で概念が別（`.clp` `.cmd` を含む）
 * ため統合はしないが、関係は `scripts/verify-lint-core.mjs` で機械検査する。
 */
export const LINTABLE_EXTENSIONS: readonly string[] = [
  // RPG（固定長）
  "rpg",
  "rpgle",
  "sqlrpgle",
  "sqlrpg",
  // DDS（種別が決まるものだけ）
  "pf",
  "lf",
  "dspf",
  "prtf",
  "mnudds"
];
