# レビュー記録

## タスク点検ログ（coding 工程内・「3.3」(b)）

- [nit][conv:-] `vscode-extension/src/testing/streamTarget.ts`（T1）名前部分が空のファイル（`.test.rpgle`）の扱いが IBM i Testing と違う（向こうは `T`）のに、
  JSDoc が「同じ規則」とだけ書いていた。 / 対応: 修正済（T1・ラウンド1。違いを 2 点として JSDoc に明記）
- [nit][conv:-] `vscode-extension/src/sync/memberTarget.ts`（T1）`isIbmiObjectName` を公開したのに、同じファイルの判定が定数を直に呼んだままで入口が 2 つあった。
  / 対応: 修正済（T1・ラウンド1。`resolveMemberTarget` も関数を使う）
- [nit][conv:-] `vscode-extension/test/unit/streamTarget.test.ts`（T1）元の関数の癖が出る分岐（`_` が 2 つ以上・`-` より前が 10 文字超・大文字化で長さが変わる文字）の
  例が無く、簡単な方に直す変更で落ちなかった。点検側は元の関数と 30 万件の総当たりで食い違いゼロを確認。 / 対応: 修正済（T1・ラウンド1。元の関数で採った期待値を 3 件足した）
- [nit][conv:-] `vscode-extension/src/testing/suiteRunner.ts`（T3）展開先が `/` のとき末尾の `/` を落として空文字になり、`INCDIR` に `''` が入った
  （design は `posix.join`/`posix.dirname` で組むとしていた）。 / 対応: 修正済（T3・ラウンド1。`node:path` の `posix` で組み、`/` を残す。単体テストを足した）
- [should][conv:-] `vscode-extension/src/testing/codeForIbmi.ts`（T4）利用者の既定のデプロイ方法がこの環境で使えない（`compare` なのに `md5sum` 無し等）と、
  Code for IBM i が警告と方法の選択 UI を出し、テストの実行が選択待ちで止まる（3.0.13 `deployTools.ts` 115-127 行）。 /
  対応: 修正済（T4・ラウンド1。`chooseDeployMethod` に Code for IBM i と同じ「使えるか」の判定を入れ、使えない既定は無視する。decisions D5 を更新）
- [nit][conv:-] `vscode-extension/test/unit/codeForIbmi.test.ts`（T4）`deploy()` 経由で既定の方法があるときに方法を渡さないことを見ていなかった。 /
  対応: 修正済（T4・ラウンド1。`[[2, undefined]]` を確かめるテストを足した）
- [should][conv:-] `vscode-extension/src/testing/discovery.ts`（T5）`src/L/F/calc-add.test.rpgle` がメンバー方式（メンバー CALC・テキスト add.test）に当たり、
  IFS 方式のつもりのファイルが既存メンバーを上書きしうる（`resolveMemberTarget` は最初の `-` で切る）。design の「`.` を含むので重ならない」は
  `-` を含む名前で成り立たなかった。 / 対応: 修正済（T5・ラウンド1。`*.test.rpgle` を先に IFS 方式と判定。decisions D14・design を更新。単体テストを足した）
- [nit][conv:-] `vscode-extension/test/unit/discovery.test.ts`（T5）IFS 方式の走査の除外（`node_modules`）を確かめていなかった。 / 対応: 修正済（T5・ラウンド1）
- [nit][conv:-] `vscode-extension/src/testing/discovery.ts`（T5）型ガード `isStreamTest` が共通部品の `isStreamTestFile`（ファイル名の判定）と紛らわしい。
  / 対応: 修正済（T5・ラウンド1。`isDiscoveredStreamTest` に改名）
- [should][conv:-] `vscode-extension/src/testing/testController.ts`（T6）デプロイの例外が `runHandler` の try の外で、`run.end()` に届かずメンバー方式も走らない。
  `wrapConnection.deploy` も `getRemoteDeployDirectory` を try の外で呼んでいた。 / 対応: 修正済（T6・ラウンド1。両方で failed に倒す。単体テストを足した）
- [should][conv:-] `vscode-extension/test/unit/testController.test.ts`（T6）IFS 方式でバインド指定（testing.json）が効くこと・誤りでコンパイルしないことを
  確かめるテストが無かった。 / 対応: 修正済（T6・ラウンド1）
- [nit][conv:-] `vscode-extension/test/unit/testController.test.ts`（T6）「未保存の内容を使わない」のテストが、エディターの内容を読まないことを見ていなかった。
  / 対応: 修正済（T6・ラウンド1。`getText` の呼び出しを数え、CPY の元がデプロイ先であることを見る）
- [nit][conv:-] `vscode-extension/src/testing/testController.ts`（T6）ワークスペース・フォルダーに属さないファイルの扱いが説明されていない。 /
  対応: 修正済（T6・ラウンド1。検出がフォルダーの中しか探さないので起きない旨をコメントに書いた）
- [should][conv:-] `tools/run-rpgunit.mjs`（T7）ソースが送信の最上位の外（シンボリックリンク・ドライブ文字の違い）だと黙ってファイル名だけに落ち、
  最上位の直下の同名の別ファイルを送りうる。 / 対応: 修正済（T7・ラウンド1。`realpathSync` と `path.relative` で求め、外なら終了コード 2。self-test を足した）
- [should][conv:-] `tools/run-rpgunit.mjs`（T7）作業ツリーで消した追跡済みファイルを `git ls-files --cached` が返し、読めずに実行全体が「IFS へ送れない」で止まる。
  / 対応: 修正済（T7・ラウンド1。存在するものに絞り、ローカルの読み取り失敗は別の文言にした）
- [should][conv:-] `tools/run-rpgunit.mjs`（T7）IFS への送信がファイルごとに接続とサインオンを張り直していた（AGENTS.md「共用機への負荷」）。 /
  対応: 修正済（T7・ラウンド1。`writeStreams` で 1 本にまとめた）
- [nit][conv:-] `tools/run-rpgunit.mjs`（T7）書き込み途中で失敗したファイルが片付けの対象から漏れる。 / 対応: 修正済（T7・ラウンド1。書く前に記録する）
- [nit][conv:-] `tools/run-rpgunit.mjs`（T7）変換失敗の見出しと共通部品の detail で同じ文言が 2 回出る。 / 対応: 修正済（T7・ラウンド1。見出しを「ビルド失敗（IFS のソースの変換）」に）
- [nit][conv:-] `tools/run-rpgunit.mjs`（T7）相対パスの算出が self-test されていない。 / 対応: 修正済（T7・ラウンド1。`relativeToRoot` に切り出して self-test）
- [should][conv:-] `vscode-extension/dev/rpgunit-e2e.mjs`（T8）結果を待つ条件が「どれかの行に結果がある」で、user-data-dir を使い回すため前のシナリオの結果
  （outdated result）で待ちが抜け、実行が終わる前に読んでいた（シナリオ 7 が偽の失敗）。 / 対応: 修正済（T8・実機で発見。全行に今回の結果が揃うまで待つ）
- [nit][conv:-] `vscode-extension/dev/rpgunit-e2e.mjs`（T8）IFS 方式の行の aria-label はファイル名ではなく description（プログラム名）から始まる。
  / 対応: 修正済（T8・実機で発見。プログラム名で見る）
- [should][conv:-] `vscode-extension/dev/rpgunit-e2e.mjs`（T8）`/run/user/<uid>` が消えた WSLg で VS Code の窓が開かず起動が 180 秒で時間切れになった。
  / 対応: 修正済（T8・実機で発見。`XDG_RUNTIME_DIR` が無ければ `/mnt/wslg/runtime-dir` を使う）
- [should][conv:-] `docs/workflow/rpgunit-test-explorer.md`（cross）`/COPY` を探す「最上位」が VS Code（ワークスペース・フォルダー）と道具（git の最上位）で違い、
  送るファイルの集合も違うのに、文書が「同じ部品」とだけ書いていた。 / 対応: 修正済（cross。違いと起きうる食い違いを書いた）
- [nit][conv:-] `docs/workflow/rpgunit-test-explorer.md`（cross）名前の規則の「全部小文字なら先頭 10 文字」が実装（`T` ＋先頭 9 文字）と違う。 / 対応: 修正済（cross）
- [nit][conv:-] `docs/workflow/rpgunit-test-explorer.md`（cross）困ったときの表にデプロイ失敗・API 無し・名前を作れないのメッセージが無い。 / 対応: 修正済（cross）
- [nit][conv:-] `tools/run-rpgunit.mjs`（cross）`--keep` の help が IFS 方式で残るもの（送ったソース・写し）を書いていない。 / 対応: 修正済（cross）

## ラウンド 1（2026-09-26）

CHECK: findings / FINDINGS: 2（nit のみ）
- 要件適合: AC1〜AC12・AC14 は単体テスト・self-test・実機 E2E（VS Code 24 項目・道具 31 項目）で確認（test-result.md）。AC13 は PR の CI で確かめる。
  `aidev coverage --strict` は gap 0。
- 価値適合: 「`*.test.rpgle` をワークスペースの好きな場所に置き、日本語入りの UTF-8 のまま Test Explorer と道具の両方から回せる」は、
  実機 E2E で両方の経路が同じソース（`rpgunit-e2e-fixtures.mjs`）に同じ判定を返したことで満たされた。7.3 の日本語環境で UTF-8 の主ソースを
  そのまま渡すと開けないこと（IBM i Testing の組み立てで起きると考えられる。research F12）を、対照つきで実機に示した。
- 正確性・安全: IFS のパスは `quoteClString` で CL の文字列にしてから渡す。道具の送信失敗（D12 で review に回した分岐）は
  `writeStreams` が `IFS へソースを送れません: <path>` を投げ、呼び出し側が終了コード 2 にする（`tools/run-rpgunit.mjs` 479-485・574-575 行）。
  接続そのものの失敗も同じ catch で終了コード 2、`finally` で送ったものを片付ける——コードを読んで確認。
- [nit][conv:-] `vscode-extension/test/unit/`（既存）負荷が高いときだけ「CDML 由来の相関規則」の全コマンド総当たり等の既存テストが時間切れで落ちる。
  この work の変更とは無関係（直後の再実行で毎回合格）。 / 対応: 許容（backlog に起票するほどの頻度か、次に落ちたときに失敗名を採って判断する）
- [nit][conv:-] `vscode-extension/dev/rpgunit-e2e.mjs` WSLg の `/run/user/<uid>` が消えると VS Code が開かない件は E2E 側で回避したが、
  同じハーネスを使う他の E2E（`dev/prompter-e2e.mjs` 等）には入れていない。 / 対応: 許容（この work の範囲外。起きたら同じ手で直す）
