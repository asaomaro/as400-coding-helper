export type SeuBaseColor =
  | "green"
  | "white"
  | "red"
  | "turquoise"
  | "yellow"
  | "pink"
  | "blue";

/** 1 つの IBM i source attribute byte に対応する、VS Code 上の可視 marker。 */
export interface VisibleColorMarker {
  readonly color: SeuBaseColor;
  readonly marker: string;
  readonly wireCodePoint: number;
  readonly ibmiAttributeByte: number;
}

/** VS Code 非依存の行内 decoration 範囲（UTF-16 code unit index）。 */
export interface ColorSegment {
  readonly range: {
    readonly line: number;
    readonly start: number;
    readonly end: number;
  };
  readonly color: SeuBaseColor;
}

/**
 * 初期 UI で入力・表示する7基底色の唯一の真実源。
 * 修飾済み属性（反転・下線など）はここに入れず、wire text のまま通過させる。
 */
export const VISIBLE_COLOR_MARKERS: readonly VisibleColorMarker[] = [
  { color: "green", marker: "Ĝ", wireCodePoint: 0x0080, ibmiAttributeByte: 0x20 },
  { color: "white", marker: "Ŵ", wireCodePoint: 0x0082, ibmiAttributeByte: 0x22 },
  { color: "red", marker: "Ŕ", wireCodePoint: 0x0088, ibmiAttributeByte: 0x28 },
  { color: "turquoise", marker: "Ŧ", wireCodePoint: 0x0090, ibmiAttributeByte: 0x30 },
  { color: "yellow", marker: "Ŷ", wireCodePoint: 0x0016, ibmiAttributeByte: 0x32 },
  { color: "pink", marker: "Ṕ", wireCodePoint: 0x0098, ibmiAttributeByte: 0x38 },
  { color: "blue", marker: "Ḃ", wireCodePoint: 0x009a, ibmiAttributeByte: 0x3a }
];

const markerByWire = new Map(
  VISIBLE_COLOR_MARKERS.map(entry => [String.fromCodePoint(entry.wireCodePoint), entry])
);
const markerByText = new Map(VISIBLE_COLOR_MARKERS.map(entry => [entry.marker, entry]));

/** IBM i が UTF-8 へ変換した基底色 control を可視 marker に置き換える。 */
export function wireToVisible(text: string): string {
  return Array.from(text, character => markerByWire.get(character)?.marker ?? character).join("");
}

/** VS Code で入力された可視 marker を IBM i の UTF-8 wire control へ戻す。 */
export function visibleToWire(text: string): string {
  return Array.from(
    text,
    character =>
      markerByText.get(character) === undefined
        ? character
        : String.fromCodePoint(markerByText.get(character)!.wireCodePoint)
  ).join("");
}

/**
 * marker 自身から次の marker の直前、または行末までをその色の範囲として返す。
 * marker は BMP の1 code unit なので、VS Code の character offset と一致する。
 */
export function findColorSegments(lines: readonly string[]): readonly ColorSegment[] {
  const segments: ColorSegment[] = [];

  lines.forEach((line, lineNumber) => {
    let active: VisibleColorMarker | undefined;
    let start = 0;

    for (let index = 0; index < line.length; index += 1) {
      const marker = markerByText.get(line[index]);
      if (marker === undefined) {
        continue;
      }

      if (active !== undefined) {
        segments.push({
          range: { line: lineNumber, start, end: index },
          color: active.color
        });
      }
      active = marker;
      start = index;
    }

    if (active !== undefined) {
      segments.push({
        range: { line: lineNumber, start, end: line.length },
        color: active.color
      });
    }
  });

  return segments;
}
