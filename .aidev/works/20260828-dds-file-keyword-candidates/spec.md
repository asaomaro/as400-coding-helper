# 仕様: ファイル・レベルのキーワードの候補

## 設計方針

`addKeywordButton` の呼び出しを塞いでいる `level !== "file"` を外すだけ。
**新しい経路を作らない**——書き戻しは `sendKeywords` で、様式・項目と同じ。

併せて、候補の絞り込みを **core へ出す**（`keywordsForLevel`）。
いまは `ui.ts` の中にインラインで書かれており、
**画面に出る規則を単体で確かめられない**。出すのは絞りの規則だけで、
判断そのものは変えない。

## 対象範囲

- `src/core/dds/ddsKeywords.ts` — `keywordsForLevel` / `KeywordLevel` を足す。
- `src/dds/webview/ui.ts` — 塞ぎを外し、絞りを core に委ねる。

## インターフェース / データ構造

```ts
export type KeywordLevel = "file" | "record" | "field";
export function keywordsForLevel(
  help: readonly DdsKeywordHelp[],
  level: KeywordLevel
): readonly DdsKeywordHelp[];
```

## 振る舞いの詳細

- レベルを持たないキーワードは**どのレベルでも出す**（AGENTS.md）。
- 絞りは**候補の並びにだけ**効かせる。書けるかどうかの検証には使わない
  （レベルの判定を誤ると正しい記述を拒否する）。既存の方針をそのまま引き継ぐ。

## 受け入れ基準との対応

- AC1: 塞ぎを外す。e2e。
- AC2: `keywordsForLevel(help, "file")`。単体 ＋ e2e（datalist の中身）。
- AC3: `sendKeywords` は前 work でファイル・レベルの行を引けるようにしてある。e2e。
- AC4: `keywordsForLevel` の未設定の扱い。単体。
- AC-I1 / AC-I2: 同じ関数を通るので既存の振る舞いのまま。
