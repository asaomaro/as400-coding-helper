# テスト結果: ソース・ファイル単位でメンバーを一括で送受信する

## 結果
- 単体テスト: `npm test` 1598 passing / 0 failing（追加: `bulkSync.test.ts` 核と画面の vscode 締め出し、`bulkSyncPanel.test.ts` パネル 12 件、`memberSync.test.ts` の `listMembers` 3 件）。
- 変異の確認: パネルの「日時を揃える」と「上書き確認」を外すと 4 件が落ちる（戻し済み）。
- `verify-contributes.mjs`: OK。`openBulk` がパレットと `explorer/context` に在り、when が `src/<LIB>/<SRCFILE>` のフォルダだけに出ること（`src/LIB` や 1 段深いフォルダには出ない）を検査。when を崩すと NG になることを確認。
- GUI e2e `dev/sync-e2e.mjs`: 25/25 PASS（向きの切り替え・チェックボックスと全選択（中間表示・選べないものは除く）・差分・上書き確認の取り消しと実行・新規ファイル名・転送後に「同じ日時」・アップロード）。
- 統合テスト: `test/integration/bulkSync.test.ts`（コマンド登録）を追加。手元は VS Code の起動後に進まず（表示環境）、**CI で確認**する。

## 実機（SR-OSAKA、IBM i 7.3）
- `verify/probe-member-list.mjs`: `SYSPARTITIONSTAT` の列、`JSON_ARRAYAGG`、`RUNSQL` → `QSYS2.IFS_WRITE_UTF8` が 7.3 で動く。
  `VARCHAR_FORMAT` の書式に `"T"` を入れると SQLCODE -20447（書式から外した）。`- CURRENT TIMEZONE` で UTC（TIMEZONE=+9:00 の機械で 02:09:48 → 前日 17:09:48）。
  日本語と `"` `'` を含むテキスト記述が JSON で崩れない（`KWVALD` に一時的に付けて `*BLANK` に戻した）。
- `verify/probe-list-command.mjs`: **製品の `buildListMembersCommand` の出力そのもの**（remote shell の層だけ外す）を QCMDEXC で流し、製品の `parseMemberListing` で読む。
  - `ASAOLIB/QDDSJ`: exists=true、40 件、名前順、日時は UTC（現地 11:14:38 → 02:14:38Z）。
  - 対照 `NOSUCHF`（無い）: exists=false、0 件。
  - 対照 `KWVALF`（ソースでない物理ファイル）: exists=false（メンバーは 1 件あるが「ソース・ファイルが無い」扱い）。
- 実機に残したもの: なし（IFS の一時ファイルは読んだ後に消した。テキスト記述は元の空に戻した）。

## 未検証の穴
- **SSH 経路そのもの**（`system "RUNSQL ..."` を sshd 経由で送る、SFTP で読む）は実機で通していない。検証環境の接続は host server で、SSH の接続情報は使えない（既存の 1 メンバーの同期と同じ制約）。
  remote shell の層の逃がしは単体テスト（`$` を含むライブラリー名）で固定した。
- 実際のダウンロード・アップロード（CPYTOSTMF / CPYFRMSTMF）は既存の 1 メンバーの同期と同じ transport のメソッドを呼ぶだけで、変えていない。
