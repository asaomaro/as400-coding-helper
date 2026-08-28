# 仕様: ファイル・レベルのキーワードを編集できるようにする

## 設計方針

**編集の種類は増やさない。** `setKeywords` の宛先を広げるだけ——
書き戻し（`keywordLines` の折り返し）は項目・様式と**同じ経路**を通る。

宛先の引き当てだけを分ける: 論理単位から引けなければ、
**生の行から**ファイル・レベルの行を引く（`fileLevelAt`）。

## 対象範囲

- `src/core/dds/ddsLogicalUnits.ts` — `FileKeywordLine.sourceLines`（継続行を含む区間）
- `src/core/dds/ddsEdit.ts` — `fileLevelAt` と `setKeywords` の分岐
- `src/dds/webview/ui.ts` — 読み取り専用をやめる

## 振る舞いの詳細

- 置き換える区間は**その行と継続行**。注記行が挟まれば `keyword-lines-not-contiguous`。
- **`＋`（候補から足す）は出さない**——候補はキーワードの**使用レベル**で絞っており、
  ファイル・レベルの一覧をまだ持っていない。生テキストからは書ける。

## 受け入れ基準との対応

- AC1: `fileLevelAt` ＋ `setKeywords` の分岐
- AC2: 区間を `sourceLines` に限る
- AC3: `keywordLines`（項目と同じ）
- AC4: `contiguous`
- AC5: 単位から引ける場合は従来の経路
