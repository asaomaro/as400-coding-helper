/**
 * プロンプターの値から、**書き戻す文字列を組み立てる**。
 *
 * ## なぜ `applyChanges.ts` から分けたか
 *
 * ここにあるのは全部 `vscode` API を使わない純粋関数で、元は `applyChanges.ts` に
 * 同居していた（コメントにも「純粋関数のため検証用に公開する」とあった）。
 * しかし**同じファイルの 1 行目が `import * as vscode`** なので、
 * ブラウザ側（WebView・単独起動ハーネス）からは import できなかった。
 *
 * 分けたことで、単独起動ハーネスが「確定したらこの行が書き戻される」を実際に描ける。
 * **中身は 1 行も変えていない**——書き戻しは全定義の往復検証
 * （`scripts/verify-prompter-roundtrip.mjs`）が見張っている。
 *
 * 文書を書き換えるのは `applyChanges.ts` の `applyChanges()` だけ。
 */
import type { ParameterDefinition, PrompterDefinition } from "./types";
import { parseClCommand } from "./clCommandParser";
import { isDbcsCodePoint, printWidth } from "../core/dbcs";
import { buildKeywordFormLine, isKeywordFormDefinition } from "./keywordForm";
import {
  countOccurrences,
  isRepeatableGroup,
  occurrenceName
} from "./occurrences";

export interface AppliedValues {
  readonly [parameterName: string]: string | string[];
}

export interface ClCommandContext {
  /** ソース上に付いていたラベル（`TAG1:`）。プロンプター確定後も残す。 */
  readonly label?: string;
  /** ソース上に書かれていたコメント。失わないよう末尾に付け直す。 */
  readonly comments?: readonly string[];
  /**
   * 元のソースに書かれていたパラメータ名。
   * 触っていない省略可能パラメータを書き出さないための判定に使う
   * （元から書いてあったものは、既定値と同じでも残す）。
   */
  readonly presentParameters?: readonly string[];
}

/**
 * そのパラメータが「既定値のまま＝利用者が触っていない」か。
 * group は末端まで見て、すべて既定値なら既定値のままとする。
 */
function isAtDefault(parameter: ParameterDefinition, values: AppliedValues): boolean {
  const children = parameter.children ?? [];

  if (parameter.inputType !== "group" || children.length === 0) {
    const value = readSingle(values[parameter.name]).trim();
    const fallback = (parameter.defaultValue ?? "").trim();
    return value.toUpperCase() === fallback.toUpperCase();
  }

  return children.every(child => isAtDefault(child, values));
}

function buildParameterTokens(
  definition: PrompterDefinition,
  values: AppliedValues,
  context: ClCommandContext
): string[] {
  const present = new Set(
    (context.presentParameters ?? []).map(name => name.toUpperCase())
  );

  const tokens: string[] = [];
  for (const parameter of definition.parameters) {
    // 既定値のままの省略可能パラメータは書かない。CL は省略時に既定値が効くので、
    // 全部書き出すと元のソースに無かった記述が増え、行数も無駄に伸びる。
    // 必須のもの、元から書いてあったものは残す。
    if (
      !parameter.required &&
      !present.has(parameter.name.toUpperCase()) &&
      isAtDefault(parameter, values)
    ) {
      continue;
    }

    // 元のソースに無かったパラメーターは、既定値のままの修飾子・後ろの要素を省く（利用者が入れたものだけ書く）。
    const token = buildParameterToken(parameter, values, !present.has(parameter.name.toUpperCase()));
    if (token) {
      tokens.push(token);
    }
  }
  return tokens;
}

/**
 * 素の 1 行コマンド文字列（`CALL PGM(MYLIB/A) PARM('1')`）を作る。
 *
 * ソース行と違い、ラベル欄の桁揃えも 72 桁での折り返しもしない。
 * 入れ子のプロンプター（SBMJOB の CMD 欄など）に書き戻す値はソース行では
 * なく値なので、桁揃えを持ち込むと余計な空白が入る。
 */
export function buildClCommandBody(
  definition: PrompterDefinition,
  values: AppliedValues,
  context: ClCommandContext = {}
): string {
  const tokens = buildParameterTokens(definition, values, context);
  return [definition.keyword.toUpperCase(), ...tokens].join(" ");
}

// CL コマンド行の組み立ては vscode API に依存しない純粋関数のため、検証用に公開する。
export function buildClCommandText(
  definition: PrompterDefinition,
  values: AppliedValues,
  context: ClCommandContext = {}
): string {
  const keyword = definition.keyword.toUpperCase();

  // Columns 1–13: label area, column 14: command.
  const label = context.label ? `${context.label}:` : "";
  const labelArea = label.length >= 13 ? `${label} ` : label.padEnd(13, " ");
  let line = labelArea + keyword;

  // Parameters start at column 25.
  const paramStartColumn = 25; // 1-based
  const desiredParamIndex = paramStartColumn - 1; // 0-based
  if (line.length < desiredParamIndex) {
    line = line.padEnd(desiredParamIndex, " ");
  } else {
    line += " ";
  }

  const paramTokens = buildParameterTokens(definition, values, context);

  for (const comment of context.comments ?? []) {
    paramTokens.push(`/* ${comment} */`);
  }

  return wrapClCommand(line, paramTokens);
}

// CL ソースの桁幅。継続行はパラメータ開始桁に揃える。
const CL_LINE_WIDTH = 72;
const CL_PARAM_COLUMN = 25; // 1-based

/**
 * コマンド行を CL ソースの桁幅に折り返す。
 * 1行に収まらない場合は継続文字 `+` を付け、次行をパラメータ開始桁に揃える。
 *
 * 折り返しは「パラメータ単位」でのみ行う。トークンの途中で折ると
 * 再解析したときに値が変わってしまうため（往復で同じ結果になる必要がある）。
 */
function wrapClCommand(head: string, paramTokens: readonly string[]): string {
  if (paramTokens.length === 0) {
    return head.trimEnd();
  }

  const indent = " ".repeat(CL_PARAM_COLUMN - 1);
  const lines: string[] = [];
  let current = head;
  // その行に既にパラメータを載せたか。1つも載せずに折り返すと
  // コマンド名だけの行ができてしまうため、最低1つは載せる。
  let hasToken = false;

  for (const token of paramTokens) {
    const candidate = `${current}${current.endsWith(" ") ? "" : " "}${token}`;

    // `+ ` の分を見込んで幅を判定する。**幅は実機の桁で数える**（DBCS の前後に SO/SI が入り、
    // 全角 1 文字は 2 桁）。文字数で数えると 67 文字の行が実機で 82 桁になり 80 桁を超えた（実操作調査の P14）。
    if (hasToken && printWidth(candidate) > CL_LINE_WIDTH - 2) {
      lines.push(`${current.trimEnd()} +`);
      current = indent + token;
      hasToken = true;
      continue;
    }

    current = candidate;
    hasToken = true;
  }

  lines.push(current.trimEnd());
  return lines.join("\n");
}

/**
 * 文字ストリングの値を、必要なら引用符で囲む。
 *
 * 囲むのは空白・DBCS・`'` を含むときだけ（囲まないとコンパイルできない）。次は**そのまま**:
 * 既に `'` で始まる（利用者が囲んだ・`'a' *CAT &X` のような式）、`&` 変数・`*` 特殊値・`(` 式・`%` 組み込み関数で始まる。
 */
export function quoteCharacterString(value: string): string {
  if (/^['&*(%]/u.test(value)) return value;
  const needs =
    /[\s']/u.test(value) || [...value].some(character => isDbcsCodePoint(character.codePointAt(0) ?? 0));
  return needs ? `'${value.replace(/'/gu, "''")}'` : value;
}

/** 1つの入力値を、前後空白を落とした文字列として取り出す。 */
function readSingle(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").trim();
}

/** 反復入力（maxOccurrences）を空要素を除いた配列として取り出す。 */
function readMultiple(raw: string | string[] | undefined): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.length > 0
      ? raw.split(/\r?\n/u)
      : [];

  return list.map(value => String(value ?? "").trim()).filter(value => value.length > 0);
}

/**
 * パラメータの「中身」（NAME(...) の括弧の内側）を組み立てる。空なら undefined。
 * group は入れ子になりうるため再帰する。
 *
 *  - singleValues に該当する値が先頭の子に入っていれば単一値として返す。
 *    例: POSITION → "*FIRST"（参照ライブラリーは伴わない）
 *  - qualified は "/" 連結。空の修飾子は落とす。例: "MYLIB/MYPGM" / "MYPGM"
 *    子は出力順（ライブラリーが先）で定義する。原典の修飾子N の並びとは逆になる。
 *  - elements は " " 連結。末尾の空要素は落とし、途中の空要素は CL の
 *    省略指定 *N に置き換える。例: "*AFTER REFLIB"
 */
function buildParameterBody(
  parameter: ParameterDefinition,
  values: AppliedValues,
  // 繰り返し指定の何件目か（0 始まり）。入れ子の末端まで引き継ぐ。
  occurrence = 0,
  /**
   * 既定値のままの修飾子（`*LIBL/`）・後ろの要素（`PAGESIZE` の `*ROWCOL`）を省くか。
   * 利用者が入れたものだけを書く（2026-09-27 の決定。実操作調査の P16）。元のソースに書かれていた
   * パラメーターは省かない（呼び出し側が決める）。
   */
  omitDefaults = false
): string | undefined {
  const children = parameter.children ?? [];

  if (parameter.inputType !== "group" || children.length === 0) {
    const single = readSingle(values[occurrenceName(parameter.name, occurrence)]);
    if (single.length === 0) return undefined;
    return parameter.attributes?.characterString ? quoteCharacterString(single) : single;
  }

  const childBodies = children.map(
    child => buildParameterBody(child, values, occurrence, omitDefaults) ?? ""
  );

  // 単一値はどの入力欄に入っているとは限らない。修飾名では
  // ライブラリーではなくオブジェクト側の欄に *SAME 等が入る。
  // 単一値が指定されたら、他の欄（ライブラリーの *LIBL 等）は無視する。
  const singleValues = parameter.singleValues ?? [];
  const single = childBodies.find(
    body =>
      body.length > 0 &&
      singleValues.some(candidate => candidate.toUpperCase() === body.toUpperCase())
  );
  if (single) {
    return single;
  }

  if (childBodies.every(value => value.length === 0)) {
    return undefined;
  }

  const isDefault = (child: ParameterDefinition, body: string): boolean =>
    omitDefaults &&
    body.length > 0 &&
    (child.children ?? []).length === 0 &&
    child.defaultValue !== undefined &&
    body.toUpperCase() === child.defaultValue.trim().toUpperCase();

  if ((parameter.groupKind ?? "qualified") === "qualified") {
    // 修飾子（オブジェクト名より前の子）は既定値のままなら省く。オブジェクト名（最後の子）は残す。
    return childBodies
      .map((value, index) => (index < childBodies.length - 1 && isDefault(children[index], value) ? "" : value))
      .filter(value => value.length > 0)
      .join("/");
  }

  // 要素リストは**後ろから**既定値のままの要素を省く（途中を省くと `*N` が要るので残す）。
  let trimmedLength = childBodies.length;
  while (trimmedLength > 1 && (childBodies[trimmedLength - 1].length === 0 || isDefault(children[trimmedLength - 1], childBodies[trimmedLength - 1]))) {
    trimmedLength -= 1;
  }
  childBodies.length = trimmedLength;

  let lastFilled = -1;
  for (let i = 0; i < childBodies.length; i += 1) {
    if (childBodies[i].length > 0) {
      lastFilled = i;
    }
  }

  return childBodies
    .slice(0, lastFilled + 1)
    .map(value => (value.length > 0 ? value : "*N"))
    .join(" ");
}

/**
 * パラメータ1つを `NAME(VALUE)` トークンに組み立てる。値が空なら undefined。
 *
 * 繰り返し指定の group は、各出現を括弧で包む必要がある。
 * 例: ALCOBJ OBJ((LIBB/FILEA *FILE *EXCL MEMBERA))
 */
function buildParameterToken(
  parameter: ParameterDefinition,
  values: AppliedValues,
  omitDefaults = false
): string | undefined {
  if (isRepeatableGroup(parameter)) {
    const bodies: string[] = [];
    const count = countOccurrences(parameter, values);
    for (let index = 0; index < count; index += 1) {
      const body = buildParameterBody(parameter, values, index, omitDefaults);
      if (body) bodies.push(body);
    }

    if (bodies.length === 0) {
      return undefined;
    }

    // 各出現を括弧で包むかどうかは原典の記法に合わせる。
    //   修飾名の繰り返し     … 包まない  例: MODULE(LIB/MOD1 LIB/MOD2)
    //   要素リストの繰り返し … 出現が複数、または要素が複数なら包む
    //                          例: OBJ((LIB/F *FILE *EXCL M))  KEYFLD((F *DESCEND))
    //                          単一要素1件だけなら包まない 例: FILE(ORDFILE)
    const isElements = (parameter.groupKind ?? "qualified") === "elements";
    const needsParens =
      isElements && (bodies.length > 1 || bodies.some(body => /\s/u.test(body)));

    const joined = needsParens
      ? bodies.map(body => `(${body})`).join(" ")
      : bodies.join(" ");

    return `${parameter.name}(${joined})`;
  }

  const isRepeatable =
    typeof parameter.maxOccurrences === "number" && parameter.maxOccurrences > 1;

  if (isRepeatable) {
    const list = readMultiple(values[parameter.name]);
    return list.length > 0 ? `${parameter.name}(${list.join(" ")})` : undefined;
  }

  const body = buildParameterBody(parameter, values, 0, omitDefaults);
  return body ? `${parameter.name}(${body})` : undefined;
}

// RPG 固定長行の組み立ても vscode API に依存しないため、検証用に公開する。
export function buildRpgLineText(
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

  // キーワード形式（H 仕様書）は桁ではなくキーワードで書く（実操作調査の P1）。
  if (!hasColumnInfo && isKeywordFormDefinition(definition)) {
    return buildKeywordFormLine(original, definition, values);
  }

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

    // 値が変わっていない項目は、元の桁の中身をそのまま残す。
    // 取り出すときに前後の空白を落としているため、書き戻しで詰め直すと
    // 元の寄せ方（右寄せ/中寄せ）が失われ、編集していない項目まで行が
    // 変形してしまう（F仕様書の外部記述 'E' などで実際に発生していた）。
    const originalSlice = original.slice(
      parameter.sourceStart - 1,
      parameter.sourceStart - 1 + parameter.sourceLength
    );
    if (originalSlice.trim() === trimmed) {
      continue;
    }

    const isNumericField =
      parameter.inputType === "number" || parameter.attributes?.numericOnly;

    const padded = (() => {
      if (trimmed.length > parameter.sourceLength) {
        return trimmed.slice(-parameter.sourceLength);
      }

      const laidOut = layOutColumns(trimmed, parameter.sourceLength, parameter.attributes?.columnLayout);
      if (laidOut !== undefined) return laidOut;

      // 字下げを残す欄（D 仕様の名前）は、元の欄の先頭の空白を残す（収まる範囲で）。
      if (parameter.attributes?.keepIndent === true && trimmed.length > 0) {
        const indent = (originalSlice.match(/^ */u)?.[0].length ?? 0) % parameter.sourceLength;
        if (indent > 0 && indent + trimmed.length <= parameter.sourceLength) {
          return (" ".repeat(indent) + trimmed).padEnd(parameter.sourceLength, " ");
        }
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

export type NarrowedEdit =
  | { readonly ok: true; readonly start: number; readonly text: string }
  | { readonly ok: false };

/**
 * 先頭 `protectedColumns` 桁を変えずに書けるなら、置き換える範囲を `protectedColumns` 桁目以降に狭める。
 *
 * RPG 固定長の 4 行目は 1〜6 桁目を変えない決まりがある（初期の仕様 FR-031。`language/rpgEditGuards.ts`）。
 * プロンプターは行全体を組み立て直すので、そのままでは 1 桁でも範囲に掛かって丸ごと拒まれ、何も書けなかった。
 * 組み立てた行の先頭が元の行と同じなら、先頭を残して後ろだけ書けばよい。違うなら書けない（`ok: false`）。
 * 比べるときは両方を `protectedColumns` 桁まで空白で埋める（元の行が短くても比べられるように）。
 */
export function narrowToEditableColumns(original: string, updated: string, protectedColumns: number): NarrowedEdit {
  const head = (text: string): string => text.slice(0, protectedColumns).padEnd(protectedColumns, " ");
  if (head(original) !== head(updated)) {
    return { ok: false };
  }
  const start = Math.min(protectedColumns, original.length);
  return { ok: true, start, text: updated.slice(start) };
}

/**
 * `columnLayout` に従って値を桁幅ぶんの文字列にする。レイアウトが無い、または値がその形に
 * 合わないときは undefined（形の誤りは `columnLayoutError` が欄のエラーにする）。
 */
export function layOutColumns(
  value: string,
  width: number,
  layout: "right" | "indicatorSlots" | "rowColumn" | undefined
): string | undefined {
  if (layout === undefined || value.length === 0) return undefined;
  if (layout === "right") return value.padStart(width, " ");

  if (layout === "rowColumn") {
    const parts = value.split(/\s+/u);
    if (parts.length > 2 || parts.some(part => part.length > 3)) return undefined;
    const [row, column] = parts.length === 2 ? parts : ["", parts[0]];
    return (row.padStart(3, " ") + column.padStart(3, " ")).padEnd(width, " ");
  }

  // indicatorSlots
  if (value.startsWith("*")) return ` ${value}`.padEnd(width, " ");
  const slots = indicatorSlots(value);
  if (slots === undefined || slots.length * 3 > width) return undefined;
  return slots.map(slot => slot.padStart(3, " ")).join("").padEnd(width, " ");
}

/** `columnLayout` の形に合わない値の理由（合えば undefined）。 */
export function columnLayoutError(
  value: string,
  width: number,
  layout: "right" | "indicatorSlots" | "rowColumn" | undefined
): string | undefined {
  if (layout === undefined || layout === "right" || value.length === 0) return undefined;
  if (layOutColumns(value, width, layout) !== undefined) return undefined;
  return layout === "rowColumn"
    ? "行と桁を空白で区切って入力してください（例: 7 74）。桁だけなら 1 つ。"
    : "標識は N と 2 桁の数字で、3 つまで入力してください（例: N40 41）。";
}

/** `N40 41` / `N4041` → [`N40`, `41`]。形に合わなければ undefined。 */
function indicatorSlots(value: string): string[] | undefined {
  const compact = value.replace(/\s+/gu, "");
  if (!/^(?:N?\d{2})+$/u.test(compact)) return undefined;
  return compact.match(/N?\d{2}/gu) ?? undefined;
}
