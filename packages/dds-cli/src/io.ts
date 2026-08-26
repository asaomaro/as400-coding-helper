/**
 * ファイルの読み書きとエンコーディングの扱い。
 *
 * ## Shift_JIS の書き戻し
 *
 * Node には Shift_JIS の**エンコーダが無い**（`TextDecoder` はデコード専用）。
 * そこで **`TextDecoder` から逆引き表を組み立てて**エンコーダを自作する。
 * 有効なバイト列を総当たりでデコードし、`文字 → バイト列` の対応を作るだけ。
 *
 * この方法を採る理由:
 * - **依存を増やさない。** `iconv-lite` を足せば済むが、この用途のためだけに
 *   依存を持つより、`TextDecoder` が既に持っている対応表を使い回すほうが素直。
 * - **表の出所が明確。** 自前の変換表を持ち込むのではなく、Node（ICU）の表から導く。
 *
 * 表は 9,000 件強で、必要になったときに一度だけ作る。
 *
 * **読み込んだエンコーディングで書き戻す。** UTF-8 で読んだら UTF-8、
 * Shift_JIS で読んだら Shift_JIS。**勝手に変換しない**——編集していない部分まで
 * 変わってしまい、「触っていない行はバイト不変」という約束が壊れる。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { decodeSource, type SourceEncoding } from "@as400/dds-core";

/** 読み込み結果。 */
export interface LoadedSource {
  readonly text: string;
  readonly encoding: SourceEncoding;
  readonly bom: boolean;
  readonly warning?: string;
}

/** ファイルを読み、エンコーディングを判定する。 */
export function loadSource(path: string): LoadedSource {
  const bytes = new Uint8Array(readFileSync(path));
  return decodeSource(bytes);
}

let shiftJisTable: Map<string, readonly number[]> | undefined;

/** `TextDecoder` から `文字 → バイト列` の対応表を組み立てる（初回のみ）。 */
function shiftJisEncoder(): Map<string, readonly number[]> {
  if (shiftJisTable !== undefined) {
    return shiftJisTable;
  }

  const decoder = new TextDecoder("shift_jis", { fatal: true });
  const table = new Map<string, readonly number[]>();

  for (let byte = 0; byte < 0x80; byte += 1) {
    try {
      table.set(decoder.decode(new Uint8Array([byte])), [byte]);
    } catch {
      // Shift_JIS として不正な単バイト。表に載せない。
    }
  }

  // 2 バイト文字の先導バイト範囲（Shift_JIS の定義どおり）。
  for (const [from, to] of [
    [0x81, 0x9f],
    [0xe0, 0xfc]
  ] as const) {
    for (let lead = from; lead <= to; lead += 1) {
      for (let trail = 0x40; trail <= 0xfc; trail += 1) {
        try {
          const char = decoder.decode(new Uint8Array([lead, trail]));
          if (!table.has(char)) {
            table.set(char, [lead, trail]);
          }
        } catch {
          // 不正な組み合わせ。表に載せない。
        }
      }
    }
  }

  shiftJisTable = table;
  return table;
}

/** Shift_JIS で表せない文字。 */
export class EncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncodingError";
  }
}

/**
 * テキストを指定のエンコーディングでファイルへ書く。
 *
 * @throws EncodingError Shift_JIS で表せない文字が含まれる場合
 *   （**黙って化けさせない**。落として理由を伝える）
 */
export function saveSource(
  path: string,
  text: string,
  encoding: SourceEncoding,
  bom: boolean
): void {
  if (encoding === "utf8") {
    const body = bom ? "﻿" + text : text;
    writeFileSync(path, Buffer.from(body, "utf8"));
    return;
  }

  const table = shiftJisEncoder();
  const bytes: number[] = [];

  for (const char of text) {
    const encoded = table.get(char);
    if (encoded === undefined) {
      throw new EncodingError(
        `Shift_JIS で表せない文字が含まれています: ${JSON.stringify(char)}（U+${char
          .codePointAt(0)!
          .toString(16)
          .toUpperCase()}）。` +
          "このファイルは Shift_JIS なので、そのままでは書き戻せません。"
      );
    }
    bytes.push(...encoded);
  }

  writeFileSync(path, Buffer.from(bytes));
}
