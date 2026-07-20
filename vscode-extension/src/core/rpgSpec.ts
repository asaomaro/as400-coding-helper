import type { Dialect } from "../prompter/types";

/**
 * RPG 固定長ソース行のスペック種別（keyword）判定を **単一の真実**として提供する。
 * ルーラー表示（ruler.ts）と F4 プロンプター／タブナビ（positionResolver.ts）、
 * および lint core が同じ規約を共有し、片方だけに種別追加が漏れる（ドリフト）のを防ぐ。
 *
 * 6 桁目（index 5）のスペック文字で分類する。C は新旧を cNewOpcodes で判定するが、
 * RPG III(rpg3) には C-NEW(自由形演算) が存在しないため、dialect 指定時は常に C-SPEC。
 *
 * このモジュールは **vscode を import しない**。設定（`rpgClSupport.cNewOpcodes`）の
 * 読み取りは `prompter/specClassifier.ts` 側（殻）が担い、ここには集合を渡すだけにする。
 *
 * ■ 2 つの使い方
 *   - `classifyRpgSpecKeyword(text, {precedingLines})` … 1 行だけ知りたいとき。
 *     先行行を毎回渡すので、ファイル全体に対して回すと O(n^2) になる。
 *   - `createRpgSpecContext()` … ファイルを頭から流すとき（lint）。先行行から作る
 *     索引を蓄積するので O(n)。**判定ロジックは共有**していて、前者は後者に
 *     先行行を流し込むだけのラッパー。
 */

/** C 仕様の「新形式」オペコードの既定集合。設定はこれに追加する形で効く。 */
export const DEFAULT_C_NEW_OPCODES: ReadonlySet<string> = new Set([
  "EVAL",
  "EVALR",
  "IF",
  "ELSEIF",
  "ELSE",
  "ENDIF",
  "SELECT",
  "WHEN",
  "OTHER",
  "ENDSL"
]);

export interface RpgSpecOptions {
  readonly dialect?: Dialect;
  /**
   * I/O 仕様書はプログラム記述か外部記述かで桁の意味が変わる。それは
   * その行ではなく F 仕様書（22 桁目）で決まるため、前の行が必要になる。
   *
   * **未指定と空配列は意味が違う**。未指定は「先行行という概念が無い」で
   * 記述種別を既定の PGM にする。空配列は「先行行が 0 行あった」で、
   * F 仕様書が見つからない扱い（＝EXT）になる。既存の呼び出し元は
   * 常に配列を渡すが、この差は挙動として保持する。
   */
  readonly precedingLines?: readonly string[];
  /** 未指定なら DEFAULT_C_NEW_OPCODES。 */
  readonly cNewOpcodes?: ReadonlySet<string>;
}

/**
 * ファイルを頭から 1 行ずつ流して種別を得るための文脈。
 * `classify` は **現在までに読んだ行から作った索引**で判定してから、
 * その行自身を索引に取り込む（＝呼んだ行は自分自身の先行行にならない）。
 */
export interface RpgSpecContext {
  classify(text: string, dialect?: Dialect): string | undefined;
}

interface ContextState {
  /**
   * F 仕様書の 7-16 桁名（大文字）→ 22 桁目が E か。
   * **既出の名前は上書きしない**（先行行を先頭から走査して最初に一致した
   * ものを採る、という元の実装と一致させるため）。
   */
  readonly fileDescription: Map<string, "PGM" | "EXT">;
  /**
   * 直近のレコード識別行の名前（I / O 別）。
   * **毎回上書きする**（先行行を末尾から遡って最初に見つかったものを採る、
   * という元の実装と一致させるため）。
   */
  lastRecordName: { I?: string; O?: string };
  /**
   * 先行行という概念があるか。`precedingLines` 未指定の呼び出しを
   * 再現するために持つ（false のとき記述種別は常に PGM）。
   */
  readonly hasStream: boolean;
}

export function createRpgSpecContext(
  cNewOpcodes: ReadonlySet<string> = DEFAULT_C_NEW_OPCODES
): RpgSpecContext {
  return createContext(cNewOpcodes, true);
}

function createContext(
  cNewOpcodes: ReadonlySet<string>,
  hasStream: boolean
): RpgSpecContext {
  const state: ContextState = {
    fileDescription: new Map(),
    lastRecordName: {},
    hasStream
  };

  return {
    classify(text: string, dialect?: Dialect): string | undefined {
      const keyword = classifyWithState(text, dialect, cNewOpcodes, state);
      absorb(text, state);
      return keyword;
    }
  };
}

/** 1 行を索引に取り込む（分類の後に呼ぶ）。 */
function absorb(text: string, state: ContextState): void {
  if (text.length < 6) return;
  const specChar = text.charAt(5).toUpperCase();

  if (specChar === "F") {
    // 元の実装は length < 22 の F 行を読み飛ばす。
    if (text.length < 22) return;
    const name = nameField(text).toUpperCase();
    if (name.length === 0) return;
    // 先頭から最初に一致したものを採るので、既出は上書きしない。
    if (state.fileDescription.has(name)) return;
    state.fileDescription.set(
      name,
      text.charAt(21).toUpperCase() === "E" ? "EXT" : "PGM"
    );
    return;
  }

  if (specChar === "I" || specChar === "O") {
    const name = nameField(text);
    if (name.length > 0) {
      // 末尾から最初に見つかったものを採るので、毎回上書きする。
      state.lastRecordName[specChar] = name;
    }
  }
}

function classifyWithState(
  text: string,
  dialect: Dialect | undefined,
  cNewOpcodes: ReadonlySet<string>,
  state: ContextState
): string | undefined {
  if (text.length < 6) {
    return undefined;
  }

  const specChar = text.charAt(5).toUpperCase();
  switch (specChar) {
    case "H":
      return "H-SPEC";
    case "F":
      return "F-SPEC";
    case "D":
      return "D-SPEC";
    case "I":
    case "O":
      // RPG III(rpg3) は I/O をレイアウト別に分けていない（原典が別系統で、
      // rpg3 側の定義は I-SPEC / O-SPEC の1本ずつ）。分割は ILE に限る。
      return dialect === "rpg3"
        ? `${specChar}-SPEC`
        : classifyIoSpec(specChar as "I" | "O", text, state);
    case "P":
      return "P-SPEC";
    case "C":
      return classifyCSpec(text, dialect, cNewOpcodes);
    default:
      return undefined;
  }
}

/**
 * 1 行だけ分類する。`precedingLines` があればその場で文脈を作って流し込む。
 * 判定そのものは文脈版と同じ実装を通る（写しを作らない）。
 */
export function classifyRpgSpecKeyword(
  text: string,
  options?: RpgSpecOptions
): string | undefined {
  const precedingLines = options?.precedingLines;
  const context = createContext(
    options?.cNewOpcodes ?? DEFAULT_C_NEW_OPCODES,
    precedingLines !== undefined
  );

  if (precedingLines) {
    for (const line of precedingLines) {
      context.classify(line, options?.dialect);
    }
  }

  return context.classify(text, options?.dialect);
}

/** 7-16 桁目を取り出す（ファイル名／レコード様式名の欄）。 */
function nameField(text: string): string {
  return text.slice(6, 16).trim();
}

/**
 * I/O 仕様書の種別を決める。
 *
 * 行タイプ:
 *   7-16 桁目に名前がある → レコード識別行、空 → フィールド記述行。
 * 記述種別:
 *   直前のレコード識別行の名前を F 仕様書から探し、22 桁目が E なら外部記述。
 *   F 仕様書に無い名前（外部記述のレコード様式名）も外部記述として扱う。
 *   判断材料が無い場合はプログラム記述を既定とする（固定形式の既定の姿）。
 */
function classifyIoSpec(
  spec: "I" | "O",
  text: string,
  state: ContextState
): string {
  const isRecordLine = nameField(text).length > 0;
  const lineType = isRecordLine ? "REC" : "FLD";

  const recordName = isRecordLine
    ? nameField(text)
    : state.lastRecordName[spec];

  const describedBy = resolveFileDescription(recordName, state);
  return `${spec}-SPEC-${lineType}-${describedBy}`;
}

/**
 * 名前に対応するファイルがプログラム記述か外部記述かを F 仕様書から判定する。
 * F 仕様書の 22 桁目は「ファイル形式」で、E=外部記述 / F=プログラム記述。
 */
function resolveFileDescription(
  name: string | undefined,
  state: ContextState
): "PGM" | "EXT" {
  if (!name || !state.hasStream) return "PGM";
  // F 仕様書に無い名前は、外部記述ファイルのレコード様式名とみなす。
  return state.fileDescription.get(name.toUpperCase()) ?? "EXT";
}

/**
 * C 仕様の新旧判定。dialect が rpg3 のときは C-NEW が存在しないため常に C-SPEC。
 * それ以外（ile / 未指定＝ルーラー表示）は先頭オペコードで C-NEW を判定する。
 */
function classifyCSpec(
  text: string,
  dialect: Dialect | undefined,
  cNewOpcodes: ReadonlySet<string>
): string {
  if (dialect === "rpg3") {
    return "C-SPEC";
  }
  const tail = text.length > 6 ? text.slice(6) : "";
  const tokens = tail.trim().split(/\s+/u).filter(token => token.length > 0);
  const opcode = (tokens[0] ?? "").toUpperCase();
  return opcode && cNewOpcodes.has(opcode) ? "C-NEW" : "C-SPEC";
}
