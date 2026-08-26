/**
 * ソースファイルのエンコーディング判定とデコード。
 *
 * ## なぜコアに置くか
 *
 * VSCode 拡張はホスト側でデコード済みの文字列を受け取るが、**CLI はバイト列から読む**。
 * 判定をコアに置けば両者が同じ規則を使い、ファイル無しでテストできる。
 *
 * ## 判定の順序
 *
 * 1. **UTF-8 BOM** があれば UTF-8（BOM は保持し、書き戻しで復元する）。
 * 2. **UTF-8 strict** でデコードできれば UTF-8（純 ASCII もここに入る）。
 * 3. 失敗したら **Shift_JIS**。
 * 4. Shift_JIS でも失敗したら **UTF-8 の非 strict** で読み、**警告を返す**。
 *    黙って化けさせない（spec「エラー処理」）。
 *
 * 順序の根拠（実測）: `TextDecoder("utf-8", { fatal: true })` は Shift_JIS のバイト列で
 * 例外を投げるため、判別に使える。
 *
 * ## 既知の限界
 *
 * - **`TextDecoder` の Shift_JIS は ICU に依存する。** Node が small-icu ビルドだと使えない。
 *   その場合は 4. の経路に落ち、警告が返る（黙って化けない）。
 * - **Shift_JIS のバイト列が偶然 UTF-8 として妥当になる**可能性は理論上ある。
 *   日本語を含む実ソースではほぼ起きないが、**判定結果を返す**ので呼び出し側が気付ける。
 */

/** 判定されたエンコーディング。 */
export type SourceEncoding = "utf8" | "shift_jis";

/** デコード結果。 */
export interface DecodeResult {
  /** デコード後のテキスト（BOM は取り除いてある）。 */
  readonly text: string;
  /** 判定されたエンコーディング。 */
  readonly encoding: SourceEncoding;
  /** UTF-8 BOM があったか。書き戻しで復元するために保持する。 */
  readonly bom: boolean;
  /** 判定に失敗して非 strict で読んだ場合の警告。正常時は undefined。 */
  readonly warning?: string;
}

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === UTF8_BOM[0] &&
    bytes[1] === UTF8_BOM[1] &&
    bytes[2] === UTF8_BOM[2]
  );
}

function tryDecode(bytes: Uint8Array, encoding: string): string | undefined {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * バイト列をデコードし、エンコーディングを判定する。
 *
 * @param bytes ソースファイルの生バイト列
 */
export function decodeSource(bytes: Uint8Array): DecodeResult {
  const bom = hasUtf8Bom(bytes);
  const body = bom ? bytes.subarray(UTF8_BOM.length) : bytes;

  if (bom) {
    // BOM がある時点でエンコーディングは UTF-8 で確定。他を試す意味はない。
    // ただし**エンコーディングの確定と、中身が妥当かの検査は別**。
    // 中身が壊れていれば、BOM の有無にかかわらず警告を返す（黙って化けさせない）。
    const strict = tryDecode(body, "utf-8");
    if (strict !== undefined) {
      return { text: strict, encoding: "utf8", bom: true };
    }
    return {
      text: new TextDecoder("utf-8").decode(body),
      encoding: "utf8",
      bom: true,
      warning:
        "UTF-8 BOM がありますが、本文に UTF-8 として不正なバイトが含まれています。" +
        "文字化けしている可能性があります。"
    };
  }

  const asUtf8 = tryDecode(body, "utf-8");
  if (asUtf8 !== undefined) {
    return { text: asUtf8, encoding: "utf8", bom: false };
  }

  const asSjis = tryDecode(body, "shift_jis");
  if (asSjis !== undefined) {
    return { text: asSjis, encoding: "shift_jis", bom: false };
  }

  // どちらでもない。壊れたまま黙って進めず、警告を添えて返す。
  return {
    text: new TextDecoder("utf-8").decode(body),
    encoding: "utf8",
    bom: false,
    warning:
      "UTF-8 としても Shift_JIS としても解釈できませんでした。" +
      "UTF-8 として読み込んでいますが、文字化けしている可能性があります。"
  };
}
