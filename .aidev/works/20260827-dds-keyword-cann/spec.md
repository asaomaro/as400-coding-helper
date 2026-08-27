# 仕様: CAnn / CFnn の取りこぼしを直す

## 設計方針

**原典の書き方をそのまま持つ。** `CAnn` は原典が「CA01 - CA24 の総称」として使う表記で、
展開せずに 1 件として持つ。取り出し側を原典の表記に合わせる。

**検査は名前で突き合わせる。** 件数の下限では 1〜2 件の欠落が抜ける。
生成側と**同じ規則**で索引から名前を取り出し、データに無いものがあれば落とす。

## 対象範囲

| ファイル | 変更 |
|---|---|
| `docs/origin/generate-dds-keywords.mjs` | 名前の正規表現に `nn` を許す |
| `docs/origin/generate-dds-keyword-syntax.mjs` | 同上（**同じ形にする**。片方だけ直すと名前は出るが構文が付かない） |
| `docs/origin/verify-dds-keywords.mjs` | 名前の突き合わせを足す／名前の形の検査に `nn` を許す |
| `docs/origin/dds{,-en}/detail/rzakc_rzakcmstdfc{a,f}nn.htm` | 新規取得（4 件） |
| `vscode-extension/resources/completion/dds-keywords{,.en}.json` | 再生成（+2 件） |
| `docs/origin/README.md` | 詳細ページの件数（285→287 / 291→293） |

## インターフェース / データ構造

データの形は変えない。増えるのは 2 件:

```json
{ "name": "CAnn", "title": "コマンド・アテンション",
  "level": ["file", "record"],
  "syntax": ["CAnn[(response-indicator ['text'])]"], "hasParameters": true,
  "description": "これはファイル・レベルまたはレコード・レベル・キーワードで、…" }
```

## 振る舞いの詳細

- 名前の正規表現: `([A-Z][A-Z0-9]*(?:nn)?(?:\/[A-Z][A-Z0-9]*(?:nn)?)*)`。
  `/` 区切り（`ALTPAGEDWN/ALTPAGEUP`）は従来どおり分割する。
- 検査の名前の形: `^[A-Z][A-Z0-9]*(?:nn)?$`。
- 詳細ページの取得は既存の経路と同じ（IBM Documentation のコンテンツ API、
  `?parsebody=true&lang=<lang>`）。保存名は索引のリンク `rzakc/xxx.htm` → `rzakc_xxx.htm`。

## ドメイン固有の考慮

- **`CAnn` を 24 件に展開しない**（原典との 1:1 対応を崩さない）。
  利用者が `CF03` と書いたときに引き当てたい場合は、**引き当てる側**が
  末尾 2 桁を `nn` に正規化して引く（この work の対象外。利用側の話）。

## エラー処理 / 異常系

- 詳細ページが無いキーワードは、従来どおり構文が付かないだけ（データは出る）。

## 受け入れ基準との対応

| AC | 満たし方 |
|---|---|
| AC1 | 生成側 2 本の正規表現＋詳細ページ 4 件の取得 |
| AC2 | 再生成の前後を機械的に突き合わせ（追加 2 / 削除 0 / 変更 0） |
| AC3 | `originKeywordNames()` を足し、索引にある名前の欠落で `failures` に積む |
| AC4 | 修正前のデータを検査にかけて実際に落ちることを確認する |
| AC5 | `npm run verify` |
