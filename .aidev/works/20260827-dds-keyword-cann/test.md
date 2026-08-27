# テスト結果: CAnn / CFnn の取りこぼしを直す

## 実施

| 検査 | 結果 |
|---|---|
| `node docs/origin/verify-dds-keywords.mjs` | ✓ OK（DSPF ja=176 / en=176） |
| **修正前のデータを同じ検査にかける** | **✗ NG（2 件）** — 検査が効いていることの確認 |
| `npm run verify`（14 項目） | すべて ✓ |
| `npm test`（単体） | 570 passing / 0 failing |
| 再生成の前後の突き合わせ | 追加 2（`CAnn` / `CFnn`）/ 削除 0 / **変更 0**（日英とも） |

## 受け入れ基準ごとの確認

| AC | 確認 |
|---|---|
| AC1 | `CAnn` / `CFnn` が ja/en とも入り、`title` / `level:[file,record]` / `syntax:["CAnn[(response-indicator ['text'])]"]` / `description` が付いている |
| AC2 | 既存 174 件を `JSON.stringify` で 1 件ずつ突き合わせ、**変更 0**（PF 49 件・PRTF 65 件も変更 0） |
| AC3 | `originKeywordNames()` を足した。索引の名前がデータに無ければ `failures` に積む |
| AC4 | 修正前のデータで実行 → `ja/DDS-DSPF: 原典の索引にあるのにデータに無い（CAnn, CFnn）` / `en/DDS-DSPF: 同` で exit=1 |
| AC5 | `npm run verify` 14 項目すべて ✓ |

## 未検証の穴

- **VSCode 上での補完の見え方は手動確認していない**（統合テストは main でハングする既知の不具合があり
  実行していない。`.aidev/backlog/prompter.md`）。データは検査済みで、補完側のコードは無変更。
- **詳細ページ 4 件は `manifest.yml` に載せていない**。DDS の詳細ページは元から
  `manifest.yml` の対象外（索引ページだけが載っている）ため、既存の扱いに揃えた。
  取得元 URL は `decisions.md` D2 に記録した。
