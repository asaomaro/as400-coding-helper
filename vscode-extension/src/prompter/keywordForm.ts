import type { PrompterDefinition } from "./types";

/**
 * **キーワード形式の仕様書**（ILE RPG の H 仕様書）の読み書き。
 *
 * H 仕様書は 7-80 桁にキーワードを並べるだけで、欄ごとの桁が無い（`DFTACTGRP(*NO) ACTGRP(*NEW)`）。
 * 桁で読み書きする経路（`extractByColumns` / `buildRpgLineText`）は桁の無い定義を素通りさせており、
 * プロンプターで確定しても何も書かず、既存の値も読まなかった（2026-09-27 の実操作調査の P1）。
 *
 * - 定義に無いキーワードは**そのまま残す**（知らないものを消さない）。並びも元のまま。
 * - 定義にあるキーワードは値を差し替え、空にしたら外す。元に無かったものは末尾に足す。
 * - 80 桁を超えたら同じ仕様書の行を足して続ける（H 仕様書は何行でも書ける）。
 *
 * このモジュールは **vscode を import しない**。
 */

type Values = Record<string, string>;

/** 7 桁目から。1-5 桁は順序番号、6 桁目は仕様書の文字。 */
const KEYWORD_START = 6;
/** 80 桁目まで（81 桁目以降は注記）。 */
const KEYWORD_END = 80;

/** 桁を持つ欄が 1 つも無い定義（キーワード形式）か。 */
export function isKeywordFormDefinition(definition: PrompterDefinition): boolean {
  return (
    definition.parameters.length > 0 &&
    definition.parameters.every(parameter => !(typeof parameter.sourceStart === "number" && parameter.sourceStart > 0))
  );
}

interface Entry {
  readonly name: string;
  readonly value: string | undefined;
  readonly raw: string;
}

/** `NAME` / `NAME(…)` の並びに分ける。括弧の深さは引用符の外でだけ数える。 */
export function parseKeywordForm(text: string): Entry[] {
  const entries: Entry[] = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && text[index] === " ") index += 1;
    if (index >= text.length) break;
    const start = index;
    while (index < text.length && text[index] !== " " && text[index] !== "(") index += 1;
    const name = text.slice(start, index);
    let value: string | undefined;
    if (text[index] === "(") {
      let depth = 0;
      let quoted = false;
      const open = index;
      for (; index < text.length; index += 1) {
        const character = text[index];
        if (character === "'") quoted = !quoted;
        if (quoted) continue;
        if (character === "(") depth += 1;
        if (character === ")") {
          depth -= 1;
          if (depth === 0) {
            index += 1;
            break;
          }
        }
      }
      value = text.slice(open + 1, Math.max(open + 1, index - 1));
    }
    entries.push({ name, value, raw: text.slice(start, index) });
  }
  return entries;
}

/** 行のキーワードから、定義にある欄の値を読む。 */
export function readKeywordForm(text: string, definition: PrompterDefinition): Values {
  const names = new Map(definition.parameters.map(parameter => [parameter.name.toUpperCase(), parameter.name]));
  const values: Values = {};
  for (const entry of parseKeywordForm(text.slice(KEYWORD_START, KEYWORD_END))) {
    const name = names.get(entry.name.toUpperCase());
    if (name !== undefined && entry.value !== undefined) values[name] = entry.value.trim();
  }
  return values;
}

/** 欄の値を行に書き戻す。80 桁を超えたら行を足す（改行で区切って返す）。 */
export function buildKeywordFormLine(
  original: string,
  definition: PrompterDefinition,
  values: Readonly<Record<string, string | string[]>>
): string {
  const valueOf = (name: string): string => {
    const raw = values[name];
    return (Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").trim();
  };
  const known = new Map(definition.parameters.map(parameter => [parameter.name.toUpperCase(), parameter.name]));
  const written = new Set<string>();
  const tokens: string[] = [];

  for (const entry of parseKeywordForm(original.slice(KEYWORD_START, KEYWORD_END))) {
    const name = known.get(entry.name.toUpperCase());
    if (name === undefined) {
      tokens.push(entry.raw); // 定義に無いものは触らない
      continue;
    }
    written.add(name);
    const value = valueOf(name);
    if (value.length > 0) tokens.push(`${entry.name.toUpperCase()}(${value})`);
  }
  for (const parameter of definition.parameters) {
    if (written.has(parameter.name)) continue;
    const value = valueOf(parameter.name);
    if (value.length > 0) tokens.push(`${parameter.name.toUpperCase()}(${value})`);
  }

  const prefix = original.slice(0, KEYWORD_START).padEnd(KEYWORD_START, " ");
  const lines: string[] = [];
  let current = "";
  for (const token of tokens) {
    const candidate = current.length === 0 ? token : `${current} ${token}`;
    if (current.length > 0 && KEYWORD_START + 1 + candidate.length > KEYWORD_END) {
      lines.push(`${prefix} ${current}`);
      current = token;
    } else {
      current = candidate;
    }
  }
  lines.push(current.length > 0 ? `${prefix} ${current}` : prefix.trimEnd());
  // 81 桁目以降（注記）は 1 行目に残す。
  const comment = original.length > KEYWORD_END ? original.slice(KEYWORD_END) : "";
  if (comment.trim().length > 0) lines[0] = lines[0].padEnd(KEYWORD_END, " ") + comment;
  return lines.join("\n");
}
