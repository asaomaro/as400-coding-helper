# テスト結果: RPGUnit の実行ロジックを VS Code と skill で共通にする

## 実行したもの

- `npm test`（`vscode-extension/`） — **1350 passed / 0 failed**（5 回。うち `out-test` を消した直後の 1 回目だけ 1 failed。
  下の「揺らぎ」を参照）。追加: `suiteRunner.test.ts` 8 件・`testingCore.test.ts` 5 件・`findTestingConfigs` 4 件・
  `resultParser.test.ts` 1 件。`testController.test.ts` は import 先の変更のみ（期待値は不変）。
- `npm run compile` / `npm run compile:all` — エラー無し
- `node tools/run-rpgunit.mjs --self-test` — **73 項目すべて合格**
- `aidev smoke` — pass
- 実機 E2E（道具）`tools/run-rpgunit-e2e.mjs`（SR-OSAKA・RPGUnit v6.0.2.r） — **23 項目すべて合格**
- 実機 E2E（VS Code）`vscode-extension/dev/rpgunit-e2e.mjs`（VS Code＋Code for IBM i＋SR-OSAKA） — **12 項目すべて合格**
- 対照: 修正前の道具（`git show HEAD:tools/run-rpgunit.mjs`）を同じ操作で実機に流した（下記）

追加した検査が誤りを捕まえることを確認済み:
- `testingCore.test.ts`: 共通部品に `import "./discovery";` / `import "vscode"` を足すと落ちる（T5）。
- 道具の self-test（AC7）: 本体に `OBJECT_STATISTICS` の問い合わせ、`join(…, ".vscode", "testing.json")` を
  足すとそれぞれ `self-test NG（1 件）`。
- 道具が共通部品を読めないとき: `out/testing/suiteRunner.js` を退避すると、ビルドの手順を出して終了コード 2。

## 対照: 修正前の道具は古い `*SRVPGM` を成功と取り違える（AC2）

同じソース（`rpgunit-e2e-fixtures.mjs` の `basicSource`）で、正常 → `TESTFAIL` が存在しない手続きを呼ぶ（コンパイル不能）の順に流した。

```
== 1 回目: 正常なソース
exit 1
▸ ビルド   RUE2ETST … OK (6.2s)
▸ 実行     RUE2ETST … 2 tests, 1 failure (13.6s)
== 2 回目: コンパイルできないソース（*SRVPGM は残っている）
exit 1
▸ ビルド   RUE2ETST … OK (5.6s)            ← コンパイルは失敗している
▸ 実行     RUE2ETST … 2 tests, 1 failure   ← 前回の *SRVPGM を走らせた結果
```

新しい道具は同じ操作で `✗ ビルド失敗` とジョブログ（`RNS9309 … モジュールRUE2ETSTがライブラリーASAOLIBに作成されませんでした`）
を出して終了コード 2、実行まで進まない（道具の E2E シナリオ 2）。

旧版は `SBMJOB` で投入していたため、この対照の実行でジョブのスプールが残っている（消していない）。
ジョブ名は `RUB*`（ビルド）/ `RUR*A`（実行）、コンパイル・リストのスプール名は `RUE2ETST`。

## 受け入れ基準ごとの判定

- AC1: pass — 道具・VS Code とも `compileSuite`/`runSuite`（`rpgunitCommands`）を呼ぶ。`suiteRunner.test.ts` でコマンド文字列と順序、
  道具の self-test で道具に独自の組み立てが無いこと。
- AC2: pass — `suiteRunner.test.ts`（`code` で判定・問い合わせをしない）。実機: 新しい道具は終了コード 2、修正前は成功扱い（上記）。
- AC3: pass — 単体（`findTestingConfigs`: 上端で止まる・git でないとき・`.vscode`・キーごとの優先）。実機 E2E シナリオ 4
  （最寄りの `bndSrvPgm`）・5（git の最上位の `.vscode/testing.json` の `bndDir`。一時的な git リポジトリで上端まで遡る）。
- AC4: pass — self-test（`--bnd` は `bndSrvPgm` だけを置き換え・大文字化・修飾しない）。実機 E2E シナリオ 6（`--bnd e2ecalc`）。
- AC5: pass — `suiteRunner.test.ts`（実行前の `RMVLNK`・`keepXml` でも実行前は消す）。実機: シナリオ 4 で実行後に XML・ソースが残らない。
- AC6: pass — 単体（`resolveBinding` の 6 種類・ほかのキー）。実機 E2E シナリオ 7（`bndSrvPgm` が文字列 → 終了コード 2・パスと理由・
  `▸ 転送` が出ない＝コンパイルしない。`--bnd` があっても弾く）。
- AC7: pass — `testingCore.test.ts`（5 ファイル）。道具の self-test が本体のソースを読み、コマンド文字列・`<testcase`/`<testsuite`・
  `OBJECT_STATISTICS`・`SBMJOB`・独自のバインド解釈・`testing.json` の探索が無いことを確かめる（変異で落ちることも確認）。
- AC8: pass — self-test（引数・オラクル・テンプレート・`compareRuns`）。実機 E2E シナリオ 1: `--json`（2 件・`assertions`）・`--xml`・`--md`・
  `--keep`（IFS に XML とソースが残る）・`--check-independence`（一致）・`--rclrsc always`、終了コード 1。
- AC9: pass — `npm test` 全件（既存テストの期待値は不変）。`dev/rpgunit-e2e.mjs` 12 項目（共有部品へ移した後の版で）。
- AC10: pass — 道具の実機 E2E（正常・古い `*SRVPGM`・`testing.json`・`--bnd`）。
- AC11: 未確定 — `tools-tests.yml` にビルドを足した。PR の CI で確かめる（deliver で結果を記す）。
- AC12: pass — `tools/README.md`（共通部品・前提・ビルド失敗の表示・`testing.json`・`--bnd`・罠の表・`--keep` と実行前の削除・E2E）、
  skill `rpgunit-test`（バインドの節・道具の節）。
- AC13: pass — `suiteRunner.test.ts`（2 つの既定リスト）。実機: バインドの無いテスト（シナリオ 1）が `RPGUNIT` の `/include` を解決して動いた。

## 失敗の証跡

実装の失敗ではなく、道具の E2E の期待値が 2 つ誤っていた（review.md の T9 に記録）。

```
  ✗ 理由（未解決の UNDEFINEDPROC）がジョブログから出る      ← 行ごとの理由はコンパイル・リストにしか出ない
  ✗ --keep 無し: IFS に残さない（前回の XML も実行前に消える）（[object Object]）
                                                            ← シナリオ 1 の --keep の XML はビルド失敗で残る。PATH_NAME は LOB
```

直して再実行し、23 項目すべて合格。

## 揺らぎ

`npm test` の 1 回目（`out-test` を消した直後・11 秒）だけ 1 件落ちた。失敗したテスト名は採れていない。
直後の 4 回（`out-test` を消してからの 1 回を含む）は 1350 件すべて合格で再現しない。
