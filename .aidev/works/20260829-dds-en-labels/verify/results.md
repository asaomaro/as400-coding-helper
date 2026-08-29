# 検証結果（2026-08-29）

| 検証 | 結果 |
|---|---|
| **英語版の日本語** | **146 箇所 → 0 箇所** |
| `npm test` | **1150 passing / 0 failing**（1148 から +2） |
| `npm run verify` | **rc=0** |
| プロンプター e2e / DDS e2e | **71/71** / **182/182** |
| `docs/src` 全 11 サンプル | 指摘 0 件 |
| **日本語版の出力** | **1 バイトも変わらず**（`ja/DDS-*.json` と `dds-*.json` に差分なし） |
| 戻すと落ちるか | 英語ラベルを戻すと単体 2 件 ＋ `verify` rc=1 |

## 桁の日英一致

| 種別 | ja | en |
|---|---|---|
| DDS-PF / DDS-DSPF / DDS-PRTF | `[1,6,7,8,17,18,19,29,30,35,36,38,39,45]` | **同じ** |

## 英語のラベル（原典の見出しそのまま）

```
Sequence number / Form type / Comment / Condition / Type of name or specification /
Reserved / Name / Reference / Length / Data type / Decimal positions / Usage /
Location / Keyword entries
```

表示装置だけ `Data type and keyboard shift` と `DDS keyword entries`（原典がそう書いている）。

## 途中で気付いたこと

- **英語の平文は解析できない。** `(positions 1 through 5)` と**数字の前**に語が来るため、
  日本語向けの正規表現（`…(\d+)…桁目`）と構造が合わない。無理に当てると
  **ラベルが前の文を巻き込む**（`A K ITMNBR ABSVAL A Sequence number`）。
  **リンクの文言**は完全で境界が明確なので、そこから採った。
- **`Positional entries` は欄ではなく見出し。** 表示装置のページは先頭 3 欄をまとめて
  「1 through 7」とだけ書く。欄として採ると補完が働かず **14 → 12 欄**に減った。
  日本語側も同じ語（`定位置項目`）を除いている。

## 受け入れ基準

| AC | 結果 |
|---|---|
| AC1 英語版に日本語 0 | ✓ |
| AC2 欄の名前が原典の見出しどおり | ✓ テストで固定 |
| AC3 桁の構造が日英一致 | ✓ `verify-dds-prompter.mjs` で強制 |
| AC4 日本語を混ぜると落ちる | ✓ 実際に混ぜて確認（キーと値まで出る） |
| AC5 日本語版に差分なし | ✓ |
| AC6 テスト・検査・往復・e2e | ✓ |
