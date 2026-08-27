# テスト結果: キーワード欄のチップ表示と原典ヘルプ

## 実施

| 層 | 結果 |
|---|---|
| 単体（`npm test`） | **593 passing / 0 failing**（この work で +23） |
| 型検査（拡張ホスト / WebView） | 通過 |
| 原典検証（`npm run verify`） | 14 項目すべて ✓ |
| 桁位置 lint（DDS / PRTF / PF / LF / CMD / CL） | 指摘なし |
| GUI e2e（`dev/e2e.mjs`） | **66/66 PASS**（この work で +11） |

## 受け入れ基準ごとの確認

| AC | 確認 |
|---|---|
| AC1 | 単体: 空白区切り・引用符の中の空白（`EDTWRD('   0. ')`）・引用符の中の括弧（`DFT('(A)')`）・引数の中の空白・入れ子の括弧・閉じない括弧/引用符 |
| AC2 | 単体: `kind: "literal"`／リテラル ＋ キーワードの並び／`''` のエスケープ。e2e: 印が付かないこと |
| AC3 | 継続行は `unit.keywords` に連結済み。`CUSTMNT.dspf` の様式 HEADER で `OVERLAY` と `CF03(…)`（別の行）が並ぶことを e2e で確認 |
| AC4 | e2e: チップを押すと和名・レベル・構文・説明が出る |
| AC5 | VSCode 側は `resolveDefinitionLanguage()`（補完と同じ関数）。**手動確認はしていない**（下記） |
| AC6 | 実装（`unknown` クラス ＋ `?` の印）。**原典に無い綴りの実例が手元のサンプルに無い**ため e2e では逆側（印が付かないこと）を固定 |
| AC7 | 実装（`keywords` は任意。表が無ければ印も出さない）。**e2e では未検証**（下記） |
| AC8 | e2e: `.kw-raw` に生テキストが残っている |
| AC-I1 | e2e: 押すと開く／もう一度押すと閉じる |
| AC-I2 | 読むだけ。`edit` を送らない（`protocol.ts` の UI→ホストは無変更） |
| AC-I3 | e2e: `F1` で開く。`Enter` / `Space` は `<button>` の既定動作 |
| AC-I4 | e2e: 開いてもフォーカスがチップに残る |
| AC-I5 | e2e: チップ上の `Delete` でキャンバスの項目が消えない |

## 未検証の穴

- **AC5（言語切替）は手動確認していない。** `resolveDefinitionLanguage()` は既存の
  キーワード補完と同じ関数で、そちらは既に稼働している。英語データ（176 件）も同時に再生成済み。
- **AC7（表が渡らないホスト）は e2e で作れていない。** 単独起動は必ず表を束ねるため。
  実装上は `message.keywords ?? []` の 1 行で、表が空なら印も出さない（D2）。
- **原典に無い綴りの実例が無い。** 手元のサンプルはすべて正しい綴りなので、
  `unknown` の印が付く側は e2e で踏めていない（付かない側は固定した）。
- **GUI e2e は CI で走らない**（`playwright-core` は devDependency にしていない）。
- **VSCode 統合テストは実行していない**（F4 プロンプターのテストが main でハングする既知の不具合）。
  この work は `src/dds/` と `src/core/dds/` と `src/language/ddsKeywordCompletion.ts` の
  型の寄せ替えだけで、プロンプター経路には掛からない。
- **ファイル・レベルのキーワード**（`DSPSIZ` / `REF` / `INDARA` / `PRINT`）は
  **依然として読めない**（`decisions.md` D4）。backlog に起票した。
