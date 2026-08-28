# 仕様: 行長の数え方を実機の桁に揃える

## 設計方針

**数え方を `printWidth` に一本化する。** 既にある関数で、実機の可否と
完全に一致することを確かめた（`research.md` F2）。作り直さない。

足りないのは「どこから溢れたか」だけ。`indexExceedingWidth` を足す
——lint の下線は**エディタの列（JS の添字）**で指す必要があり、桁とは別物。

**上限の値（100 / 36）は変えない。** 数え方だけを直す。

## 対象範囲

- `src/core/dbcs.ts` — `indexExceedingWidth` を足す。
- `src/lint/rules/lineLength.ts`
- `src/core/dds/ddsEdit.ts`（`line-too-long`）
- `src/core/dds/ddsEditWriteBack.ts`（`foldKeywordArea`）

## インターフェース / データ構造

```ts
/** 実機の桁数が `max` を超え始める位置（**JS の添字**）。超えなければ undefined。 */
export function indexExceedingWidth(text: string, max: number): number | undefined;
```

## 振る舞いの詳細

### lint

- 判定は `printWidth(line) > 100`。
- 下線は `indexExceedingWidth(line, 100)` から行末まで。
- 文言に**実機の桁と JS の文字数の両方**を出す（半角だけなら同じなので省く）。

### 折り返し

- 「入るか」の判定を `printWidth` にする。
- `-` で切る経路は `indexExceedingWidth(rest, 36 - 1)` で切る位置を決める
  （継続記号の 1 桁を残す）。**全角を半分に割らない。**
- 切る位置が 0 なら止める（無限に積まない）。

## 受け入れ基準との対応

- AC1: `printWidth` に置き換え。
- AC2: 文言に両方を出す。
- AC3: 折り返しの判定と切る位置。
- AC4: 単体（読み直し）＋ 実機（`verify/verify-folded-dbcs.mjs`）。
- AC5: 半角だけの折り方を単体で固定（回帰）。
- AC-I1: `indexExceedingWidth`。
