# 決定記録

## D1: full で進める

- 背景: 着手時の三層判定。
- 決定: full。
- 理由: 2 つの実装の境界を動かす（共通部品の抽出）うえ、道具の外に見える挙動（`--bnd` の解釈、CI の手順）が
  変わる。light の条件（共有モジュールに触らない・振る舞いを変えない）を満たさない。

## D2: 共通部品は `vscode-extension/src/testing/` に置き、道具はビルド済みの JS を読む

- 背景: 道具（`tools/run-rpgunit.mjs`）は素の Node の ESM、拡張機能は TypeScript（`out/` へ CommonJS）。
- 決定: 共通部品は `vscode-extension/src/testing/` の `vscode` を import しないファイルにし、道具は
  `vscode-extension/out/testing/*.js` を読む。CI の `tools self-test` は、先に拡張機能をビルドする。
- 理由 / 代替案: 道具側に写しを置く案は、写しの同期漏れという今回の問題そのものを再生産する。共通部品を
  別パッケージにする案は、この規模では過剰。ビルドの手間（`npm run compile`）は、道具の前提チェックで
  足りなければ何を打てばよいかを出して終了コード 2 にする（既存の前提チェックと同じ流儀）。
- 影響: CI の workflow を変える（`.github/workflows/tools-tests.yml`）。

## D3: 道具の接続は hostserver の SQL ジョブで `QSYS2.QCMDEXC` を呼ぶ形にする

- 背景: 共通の手順は「ライブラリー・リストを変えてからコマンドを実行し、結果（成功／失敗とジョブログ）を受け取る」
  接続を前提にする。Code for IBM i は SQL ジョブで `CHGLIBL` とコマンドを順に実行している
  （`codefori/vscode-ibmi` の `src/api/CompileTools.ts`）。道具の `CommandConnection` はコマンドごとに別ジョブで
  ライブラリー・リストを持ち越せず（skill `ibmi-remote` 6.3）、そのため `SBMJOB INLLIBL(...)` と
  オブジェクトの有無での判定に頼っていた。
- 決定: hostserver の `DbConnection` を 1 本張り、`executeStatement(conn, "CALL QSYS2.QCMDEXC(?)", { parameters })`
  で `CHGLIBL` とコマンドを同じジョブで実行する。`SqlError` を失敗とし、ジョブログは `QSYS2.JOBLOG_INFO('*')` から読む。
- 理由: Code for IBM i と同じ方式にそろえれば、成否の判定とライブラリー・リストの扱いを共通部品に寄せられる。
  値はパラメーターで渡すので、CL に引用符が混ざっても壊れない
  （`/workspaces/ts5250/packages/hostserver/dist/db/execute.d.ts` の `executeStatement`・`ExecuteOptions.parameters`）。
- 影響: requirements「未確定事項」を実機で確かめる。`SBMJOB` とジョブ完了待ちのポーリングは道具から消える。

## D4: 道具の `--bnd` は `testing.json` より優先し、修飾の無い名前を補わない

- 背景: 道具の `--bnd` は修飾の無い名前をテストのライブラリーで補っていた。VS Code（`testing.json`）は補わない。
- 決定: 補わない（`*LIBL`）。`--bnd` を 1 つでも渡したら `testing.json` の `bndSrvPgm` を置き換える。
- 理由: 同じ名前が経路によって別のオブジェクトを指すのを無くす（US2）。コマンドラインで明示した指定を
  設定ファイルより優先するのは一般的な慣習。テストのライブラリーはライブラリー・リストの 2 番目にあるので、
  これまで `--bnd CALCSRV` で見つかっていたものは引き続き見つかる。
- 影響: 利用者向けの文書（`tools/README.md`・skill `rpgunit-test`）に書く。

## D5: research 工程は挟まない

- 決定: 挟まない。必要な事実は着手前に直読済み——`tools/run-rpgunit.mjs` 全体、hostserver の
  `dist/db/execute.d.ts`・`dist/index.d.ts`、`.github/workflows/tools-tests.yml`、`tools/README.md`、
  Code for IBM i の `src/api/CompileTools.ts`（前 work で直読）。残る未確定（SQL ジョブでの実行）は実機で閉じる。

## D6: hostserver の SQL ジョブでのコマンド実行を実機で確かめた（requirements 着手時）

- 背景: D3 の前提（SQL ジョブで `CHGLIBL` が持ち越され、失敗が `SqlError` で返り、ジョブログが読める）が未確認だった。
- 決定: 方式として採る。2026-09-26 に SR-OSAKA で確認した事実——
  `CALL QSYS2.QCMDEXC('CHGLIBL LIBL(RPGUNIT <lib> QGPL QTEMP) CURLIB(*CRTDFT)')` のあと、同じ接続の
  `QSYS2.LIBRARY_LIST_INFO` のユーザー部分が `RPGUNIT ASAOLIB QGPL QTEMP`。存在しないメンバーでの `RUCRTRPG` は
  `SqlError -443 / 38501`、本文に `CPF9897 Member NOSUCHT not found in source file ASAOLIB/QUN…`（44ms）。
  `QSYS2.JOBLOG_INFO('*')` に `CPF9897`（本文は半角カナに化ける）と `SQL0443`。
- 影響: `RUCALLTST` を SQL ジョブで流したときに XML が書かれるかは別に確かめる（requirements「未確定事項」）。

## D7: requirements の独立点検は 2 巡で打ち切る

- 2 巡目の 6 件（AC7 の確かめ方、AC3・AC6 の範囲、`--keep` の例外、未確定事項の扱い）はすべて反映した。

## D8: `RUCALLTST` も SQL ジョブで実行できる（未確定事項を閉じる）

- 2026-09-26 に SR-OSAKA で、SQL ジョブで `CPYFRMSTMF`→`CHGPFM`→`CHGLIBL`→`RUCRTRPG`（418ms）→`RUCALLTST`（97ms）を流した。
  XML は書かれ、`user.librarylist` は `RPGUNIT ASAOLIB QGPL QTEMP`。テストが 1 件失敗しているので `RUCALLTST` は
  `SqlError -443`（本文 `CPF9897 FAILURE. 2 test cases, 2 assertions, 1 failure, 0 error.`）を返した。
  作ったものは片付けて残存 0 件を確認。
- 決定: `RUCALLTST` も SQL ジョブで実行する（`SBMJOB` へ戻す分岐は不要）。合否は XML で決め、`RUCALLTST` の結果は見ない。
- 影響: 前 work（`20260922-rpgunit-vscode-testing`）で `testController.ts` に書いた「合否は XML で判定するので code は見ない」
  の前提（テスト失敗時に `RUCALLTST` が失敗を返す）が、ここで初めて実測で裏付いた。

## D9: design の独立点検は 2 巡で打ち切る／requirements に例外を 1 つ足す

- design 2 巡目の 8 件を反映した。うち 1 件は requirements の非機能要件にかかる（ビルド失敗時の表示の変化が
  例外の一覧に無かった）ので、承認済みの requirements に例外として追記し、AC12 の文書化対象にも足した。
  AC は増やしていない（AC12 の範囲の補足）。
- D2 の補足: 共通部品には `src/sync/memberTarget.ts` も含む。道具はこれを直接読まない。
- 実機・実物での確認: 道具の ESM から `out/` の CommonJS を動的 import し、名前付きの関数を取り出せた（design「依拠する既存の事実」）。
