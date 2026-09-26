# レビュー記録

## タスク点検ログ（coding 工程内・「3.3」(b)）

- T7・T8（`vscode-extension/src/testing/testController.ts` の登録配線、
  `vscode-extension/test/support/vscode-stub.js` の `tests`/`extensions`/`workspace.findFiles`/
  `workspace.fs.readFile` スタブ追加、`vscode-extension/src/extension/extension.ts` の
  `registerRpgUnitTesting(context)` 追加）を対象に same_session で点検した。
  CHECK: ok / FINDINGS: 0
  - スタブの`TestItemCollection`（`add`/`replace`が`item.parent`を正しく設定するか）、
    `findFiles`/`readFile`のエラー時挙動（`stat`と同じ「無ければreject」規約に揃っているか）、
    `extension.ts`の登録順序（既存機能と同じパターンか）を確認。指摘なし。

## クロス点検（全タスク完了後・「3.3」(b) 5.5）

CHECK: findings / FINDINGS: 1
- [must][conv:-] `vscode-extension/src/testing/testController.ts`（`runFile`関数、T7）
  `uploadMemberContent`実行後にSRCTYPE属性を設定していなかった。`RUCRTRPG`は
  `getMemberType()`でメンバーのSRCTYPE属性を見て分岐するため（T3のコマンド構築時に
  参照した`.claude/skills/rpgunit-test/SKILL.md:247-249`、`.claude/skills/ibmi-remote/SKILL.md:60-64`
  「ソースタイプは別途設定する（コピーだけでは付かない）」）、設定漏れのままではコンパイルが
  正しく動作しない。T1の実機確認スクリプトでは`CHGPFM ... SRCTYPE(RPGLE)`を明示的に
  呼んでいたにもかかわらず、T7の実装に引き継がれていなかった（タスクをまたいだ知識の
  取りこぼし）。 / 対応: 修正済（`runFile`に`CHGPFM FILE(...) MBR(...) SRCTYPE(...)`呼び出しを追加。
  `memberTarget.ts`の`deriveSourceType`を再利用）。テスト実行・全1290件green確認済み。

## ラウンド 1（2026-09-22）

CHECK: findings / FINDINGS: 2
- [should][conv:-] `vscode-extension/src/testing/testController.ts`の`runHandler`
  — テスト実行中にキャンセルされると、まだ処理していない対象ファイルの子テストが
  `enqueued`のまま残り、`run.skipped`等の終端状態に遷移しない。VS Code Testing UIでは
  「実行中のまま止まって見える」状態になりうる（AC-I2「実行中はキャンセル操作で
  中断できる」の質を損なう）。
- [should][conv:-] `vscode-extension/src/testing/testController.ts`の`runFile`
  — `RUCRTRPG`実行時に`{ getSpooledFiles: true }`を渡していたが、`CommandResultLike`
  （`codeForIbmi.ts`）にスプールファイル関連のフィールドが無く、取得した内容を一切
  使っていなかった（渡しても何も起きない死んだオプション）。

対応: 両方その場で修正（`review.md`記録後にaidev event review sent_backでcoding工程へ
正式に差し戻し、修正・再検証した）。
- キャンセル時、未処理の対象ファイルの子テストを`run.skipped`にするよう変更
  （`testController.ts`の`runHandler`）。回帰テスト
  「開始前にキャンセル済みなら対象の子テストはskippedになる」を追加。
- `getSpooledFiles: true`を削除（効果が無いオプションを渡さない）。代わりに、
  実機確認（T1）で判明した所要時間（約1.4秒）と、大規模テストでタイムアウトする場合の
  切り替え先（`runCommandSubmitted`。decisions.md D2）をコード上のコメントで明示した。

修正後、`npm test`は1291件全てgreen（回帰テスト1件追加）。`npx tsc -p ./`もエラー無し。

## ラウンド 2（2026-09-22・再点検）

CHECK: ok / FINDINGS: 0
ラウンド1の2指摘の修正を確認。修正差分以外の新規の欠陥は無し。

## クロス点検 ラウンド 2（deliver 後の修正 T10〜T13・2026-09-26）

CHECK: findings / FINDINGS: 1
- [should][conv:-] `vscode-extension/src/testing/testController.ts`（`runFile`）
  結果 XML のパスは毎回同じ（`<tempDirectory>/<メンバー>.xml`）で、後始末は読み取り後の `finally` だけ。
  前回の実行が中断して XML が残っていると、今回 `RUCALLTST` が XML を出さなかったときに**古い結果を読む**
  （T11 で直した「古い `*SRVPGM` による誤判定」と同じ種類）。 / 対応: 修正済（`RUCALLTST` の前にも
  `RMVLNK` する。回帰テスト追加。1 行外すと落ちることを確認）。
  あわせて「テスト失敗時は `RUCALLTST` の code が 0 以外になる」という未実測の断定をコメントから外した。

## ラウンド 3（deliver 後・実機 E2E で見つかった欠陥の修正・2026-09-26）

CHECK: ok / FINDINGS: 0
- 前提: 欠陥 3 件（`CPF4102`・古い `*SRVPGM` による誤判定・未保存内容／例外で run が終わらない）は
  レビューではなく**実機 E2E で見つかった**（decisions.md D8）。ラウンド 1・2 のレビューは
  偽物の接続を前提にした読解で、ライブラリー・リストの欠落を指摘できなかった。
- 要件適合: AC1〜AC4・AC6・AC-I4 を本物の VS Code／Code for IBM i／実機で確認（test-result.md ラウンド 3）。
- 価値適合: 「人間の開発者が Test Explorer で RPGUnit を実行し結果を確認できる状態」は、修正前は
  **1 件も実行できず満たされていなかった**。修正後に満たされた。
- 正確性: `&LIBL` は `Variables.expand` で**コマンド文字列にも置換がかかる**（`new RegExp(key)`）。
  RUCRTRPG/RUCALLTST/CHGPFM/RMVLNK の文字列に `&LIBL` は現れないので影響なし。
- 規約: 追加テストは修正前に戻して落ちることを確認済み（AGENTS.md「テストの走らせ方」）。
