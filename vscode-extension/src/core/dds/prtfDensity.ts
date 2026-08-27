import densityData from "../../../resources/completion/dds-print-density.json";
import { parseKeywordEntries } from "./ddsKeywords";

/**
 * 帳票の**印刷密度**（CPI / LPI）。
 *
 * ## 値の出所
 *
 * 書ける値は原典の「キーワードの形式」から生成する
 * （`docs/origin/generate-dds-print-density.mjs`）。既定は **DDS ではなく `CRTPRTF`**
 * のパラメータで決まる——原典（`CPI`）:
 * > CPI を指定しなかった場合には、印刷密度は、印刷装置ファイルの作成 (CRTPRTF)…の
 * > CPI パラメーターにより設定されます。
 *
 * ## 紙の大きさ
 *
 * 原典（`LPI`）:
 * > 例えば、ページの長さが 66 行で、ファイルの LPI の値が 6 であるとすれば、
 * > **用紙の長さは 11.0 インチ**です。
 *
 * → 高さ（インチ）＝ 行数 ÷ LPI、幅（インチ）＝ 桁数 ÷ CPI。
 *
 * ## 1 ページの中で変わりうる
 *
 * 原典は「1 つのページについて複数の LPI を使用した場合」を認めており、
 * レコード様式の終わりにファイル・レベルの値へ戻る。**行ごとに高さが変わる**ので、
 * 「行 ＝ 一定の高さ」を前提にするキャンバスでは描けない。
 * この版は**1 つの値で描き、複数あることを知らせる**（黙って 1 つで描かない）。
 *
 * **このモジュールは `vscode` を import しない。**
 */

export const CPI_VALUES: readonly number[] = densityData.cpi.values;
export const LPI_VALUES: readonly number[] = densityData.lpi.values;
/** `CRTPRTF` の既定（CPI 10 / LPI 6）。 */
export const DEFAULT_DENSITY = {
  cpi: densityData.cpi.default,
  lpi: densityData.lpi.default
} as const;

export interface PrintDensity {
  readonly cpi: number;
  readonly lpi: number;
  /** ソースに**複数の値**が書かれていたか（1 つで描いていることを隠さないため）。 */
  readonly mixed: boolean;
  /** ソースに書かれていた値（番号順）。空ならキーワードが無い。 */
  readonly written: { readonly cpi: readonly number[]; readonly lpi: readonly number[] };
}

/**
 * ソースに書かれた `CPI` / `LPI` を集めて、描くのに使う 1 組を決める。
 *
 * **最初に書かれたもの**を採る（レコード様式は上から処理され、
 * 指定が無ければファイル・レベル＝`CRTPRTF` の値に戻るため）。
 * 書かれていなければ `CRTPRTF` の既定。
 */
export function resolvePrintDensity(lines: readonly string[]): PrintDensity {
  const cpi: number[] = [];
  const lpi: number[] = [];

  for (const line of lines) {
    for (const entry of parseKeywordEntries(line.slice(44))) {
      if (entry.kind !== "keyword" || entry.parameters === undefined) continue;
      const value = Number(entry.parameters.trim());
      if (!Number.isFinite(value)) continue;

      // **原典に無い値は採らない**（コンパイラが弾く。描く側が真似する必要は無い）。
      if (entry.name === "CPI" && CPI_VALUES.includes(value) && !cpi.includes(value)) {
        cpi.push(value);
      }
      if (entry.name === "LPI" && LPI_VALUES.includes(value) && !lpi.includes(value)) {
        lpi.push(value);
      }
    }
  }

  return {
    cpi: cpi[0] ?? DEFAULT_DENSITY.cpi,
    lpi: lpi[0] ?? DEFAULT_DENSITY.lpi,
    mixed: cpi.length > 1 || lpi.length > 1,
    written: { cpi, lpi }
  };
}

/** 紙の大きさ（インチ）。原典の例（66 行 ÷ 6 LPI ＝ 11.0）と一致する。 */
export function paperInches(
  page: { readonly rows: number; readonly columns: number },
  density: { readonly cpi: number; readonly lpi: number }
): { readonly width: number; readonly height: number } {
  return {
    width: page.columns / density.cpi,
    height: page.rows / density.lpi
  };
}
