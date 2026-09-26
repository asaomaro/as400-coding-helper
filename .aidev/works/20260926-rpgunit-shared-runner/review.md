# レビュー記録

## タスク点検ログ（coding 工程内・「3.3」(b)）

- [should][conv:-] `vscode-extension/test/unit/testingCore.test.ts`（T5）共通部品の import を見張る正規表現が
  `from "…"` の形しか見ておらず、`import "./discovery"` のような `from` の無い読み込みと `import "vscode"` を見逃していた。
  変異（共通部品に `import "./discovery";` を足す）を入れても落ちなかったことで気づいた。 / 対応: 修正済（T5・ラウンド1。
  `from`・`import`・動的 `import(` を見る形にし、両方の変異で落ちることを確認）
- [should][conv:-] `tools/run-rpgunit-e2e.mjs`（T9）ビルド失敗の理由として `UNDEFINEDPROC` がジョブログに出ると期待したが、
  ジョブログに出るのは `RNS9309`（モジュールが作成されなかった）まで。行ごとの理由はコンパイル・リストにしか無い
  （AGENTS.md「コンパイルの理由はスプールのリストに出る」と同じ）。期待値の誤り。 / 対応: 修正済（T9・ラウンド1。`RNS9309` を見る）
- [should][conv:-] `tools/run-rpgunit-e2e.mjs`（T9）シナリオ 2 で「IFS に XML が残らない」と期待したが、シナリオ 1 が `--keep` で残した
  XML はビルド失敗で実行まで進まないので残る（次の実行の前に消える＝古い結果は読まない）。期待値の誤り。 /
  対応: 修正済（T9・ラウンド1。シナリオ 2 は転送したソースだけを見、実行後の削除はシナリオ 4 で見る）
- [should][conv:-] `tools/run-rpgunit-e2e.mjs`（T9）`IFS_OBJECT_STATISTICS` の `PATH_NAME` は LOB でロケーターが返り、
  件数は合っても名前が `[object Object]` になっていた。 / 対応: 修正済（T9・ラウンド1。`CAST(... AS VARCHAR(1024))`）
- [should][conv:-] 上流文書（T10）`dev/rpgunit-e2e.mjs` の検査を「13 項目」と書いていたが、実際は 12 項目（PR #179 の 7・#180 の 5）。
  / 対応: 修正済（requirements / design / tasks の件数を 12 に。数えた根拠は実行ログの ✓ 行）
- [may][conv:-] `npm test`（T10）`out-test` を消した直後の 1 回目だけ 1 件失敗（実行時間 11 秒・通常 5〜6 秒）。
  直後の 4 回（`out-test` を消してからの 1 回を含む）は全件 1350 件合格で再現しない。負荷時の時間依存の揺らぎと見る。
  / 対応: 記録のみ（本 work の変更と無関係の可能性が高いが、失敗したテスト名を採れていない）

## ラウンド 1（2026-09-26）

CHECK: findings / FINDINGS: 2（nit のみ）
- 要件適合: AC1〜AC10・AC12・AC13 は単体テスト・self-test・実機 E2E（道具 23 項目・VS Code 12 項目）で確認（test-result.md）。
  AC11 は PR の CI で確かめる。`aidev coverage --strict` は gap 0。
- 価値適合: 「skill と VS Code が同じ実装で RPGUnit を回す」は、両方の実機 E2E が同じテストソース（`rpgunit-e2e-fixtures.mjs`）で
  同じ判定（正常は 1 合格 1 失敗・古い `*SRVPGM` はコンパイル失敗扱い・`testing.json` のバインドで合格）を返したことで満たされた。
  旧版の道具が同じ入力で古いテストを走らせることも実機で示した（AC2 の対照）。
- 正確性・安全: `--bnd` も `testing.json` と同じ `resolveBinding` の正規表現を通ってから CL に入る（旧版は道具独自の正規表現）。
  AC7 の見張りは、道具が独自実装を持ち直すと self-test が落ちる形（変異で確認）。
- [nit][conv:-] `tools/run-rpgunit.mjs` の `openSuiteConnection` は SQL ジョブで `QCMDEXC` を呼ぶため、旧版の `SBMJOB … INQMSGRPY(*DFT)`
  に当たる「照会メッセージで止まらない」保証を持たない（止まればソケットの 300 秒で打ち切られる）。Code for IBM i 経由の
  VS Code 側と同じ条件で、実機では RUCRTRPG・RUCALLTST の失敗ともエスケープとして返ることを確認済み（decisions.md D8）。 /
  対応: 許容（同じ方式に揃えることがこの work の目的。照会で止まる事例が出たら共通部品側で扱う）
- [nit][conv:-] 結果 XML の復号が UTF-8（旧版）から Latin-1（共通部品）に変わる。RPGUnit の XML は CCSID 819 で、日本語は元々
  載らない（tools/README.md「既知の制約」）ので ASCII の範囲では同じ。 / 対応: 許容（VS Code 側と揃えた）
