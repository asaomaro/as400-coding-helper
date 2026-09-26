# テスト結果: RPGUnit のテストを IFS に展開してコンパイル・実行できるようにする

## 実行したもの

- `npm test`（`vscode-extension/`） — **1407 passed / 0 failed**（追加: `streamTarget.test.ts`、`suiteRunner.test.ts`・`rpgunitCommands.test.ts`・
  `discovery.test.ts`・`codeForIbmi.test.ts`・`testController.test.ts` に IFS 方式の項目。既存の期待値は変えていない）。
  coding 中に負荷が高いとき（実行 11〜22 秒）だけ既存の 1〜2 件（「CDML 由来の相関規則」の全コマンド総当たり等）が落ちたことがあり、
  直後の再実行では毎回全件合格——時間に依存する既存のテストの揺らぎ（前の work でも観測）。
- `node tools/run-rpgunit.mjs --self-test` — OK（IFS 方式の引数・送るファイル・相対パスの項目を追加）
- `aidev smoke` — pass
- 実機 E2E（VS Code 1.137.0＋Code for IBM i 3.0.13＋SR-OSAKA・IBM i 7.3・RPGUnit v6.0.2.r） `vscode-extension/dev/rpgunit-e2e.mjs` —
  **24 項目すべて合格**（既存 12 項目＋IFS 方式 12 項目。シナリオ 6〜9）
- 実機 E2E（道具） `tools/run-rpgunit-e2e.mjs` — **31 項目すべて合格**（既存 23 項目＋IFS 方式 8 項目。シナリオ 8〜10）
- 実機の調査（research・design 前）: `verify/probe-srcstmf.mjs`・`probe-stmf-ccsid.mjs`・`probe-stmf-convert.mjs`・`probe-stmf-include.mjs`・
  `probe-stmf-details.mjs`（すべて片付けて残存ゼロを数えた。スプールは消していない）

追加した検査が実装の誤りを捕まえることを確認した（実装を壊して `npm test` が落ちること）:
- `streamTarget.ts`: 名前の検査を外す／大文字の拾い方を変える／共通部品でないものを import する → いずれも落ちる。
- `rpgunitCommands.ts`: `'` を重ねない／`INCDIR` の順を逆にする → 落ちる。
- `suiteRunner.ts`: `INCDIR` の順を逆にする／変換の失敗を見ない／写しの `RMVLNK` の例外を握りつぶさない → 落ちる。
- `testController.ts`・`codeForIbmi.ts`: フォルダーごとのデプロイの重複除去を外す／未設定でも `launchDeploy` を呼ぶ → 落ちる。現行ライブラリーの検査を外す → 型検査で落ちる。
- 名前の規則は IBM i Testing の `getSystemNameFromPath` を実際に実行して期待値を採り（`streamTarget.test.ts`）、点検側でも 30 万件の総当たりで食い違いゼロ。

## 受け入れ基準ごとの判定

- AC1: pass — 単体（`src/` の外・メンバー方式と同時・`.sqlrpgle`・大文字）。実機 E2E シナリオ 7（`TIFSBASIC` と `RUE2EMBR` が同時に出て両方判定）・
  シナリオ 9（`IFSBIND.TEST.RPGLE` が glob の `[tT]…` で検出）。
- AC2: pass — 実機 E2E シナリオ 7（`TESTPASS` Passed・`TESTFAIL` Failed・`Expected '2', but was '3'.`）。道具 E2E シナリオ 9。
- AC3: pass — 実機 E2E シナリオ 8（`/COPY qcopy/e2ecopy_h.rpgleinc` で Passed、対照の無いコピー句で「コンパイルに失敗しました」の Errored）。道具 E2E シナリオ 8。
- AC4: pass — 実機 E2E シナリオ 7（日本語の注記と日本語リテラルの比較。件数と失敗メッセージがメンバー方式と同じ）・シナリオ 8（コピー句の日本語リテラル）。道具 E2E シナリオ 8・9。
- AC5: pass — 道具 E2E シナリオ 10: `--keep` で残した主ソース（タグ 1208 を確認）を共通部品を通さず `RUCRTRPG SRCSTMF` に渡すと
  `CPE3490: 変換エラー。` / `RNS9339: ファイル…を開くことができません。`。
- AC6: pass — AC2 の E2E ソースは `/COPY RPGUNIT/QINCLUDE,TESTCASE` を含む。
- AC7: pass — `streamTarget.test.ts`（IBM i Testing と同じ 16 件・不正な名前）、`testController.test.ts`（ライブラリーが現行ライブラリー `CURLIB`）。
  規則は `tools/README.md`・`docs/workflow/rpgunit-test-explorer.md` に記載。
- AC8: pass — 道具 E2E シナリオ 8〜10。self-test の見張り（共通部品を使っている）も通る。
- AC9: pass — `npm test` 全件（既存の期待値不変）・VS Code E2E の既存 12 項目・道具 E2E の既存 23 項目。
- AC10: pass — 単体（デプロイ未設定・失敗（undefined と例外）・API 無し・現行ライブラリー無し・名前不正・変換失敗・コンパイル失敗・写しの `RMVLNK` 失敗）。
  実機 E2E シナリオ 6（未設定で Errored と「デプロイ先が設定されていません」）。道具の送信失敗は D12 のとおり review でコードを読む。
- AC11: pass — 実機 E2E シナリオ 9（`test/testing.json` の `bndSrvPgm` で `TESTADD` Passed）。道具も `testing.json` を同じ部品で読む（既存シナリオ 4〜6）。
- AC12: pass — `tools/README.md`（IFS 方式の節）・skill `rpgunit-test`・新規 `docs/workflow/rpgunit-test-explorer.md`。
- AC13: 未確定 — PR の CI で確かめる（deliver で記す。T11）。
- AC14: pass — `discovery.test.ts`（`src/L/F/x.test.rpgle` は IFS 方式だけ、`src/L/F/X.rpgle` はメンバー方式だけ、`calc-add.test.rpgle` も IFS 方式。D14）。

## 失敗の証跡

実装の失敗ではなく、E2E の側の誤りで 5 件落ちた回がある（review.md の T8 に記録）。

```
シナリオ 7: IFS 方式・日本語入り（メンバー方式と同時）
  ✗ IFS 方式とメンバー方式の項目が同時に出る（TIFSBASIC (Errored), outdated result / RUE2EMBR (Not yet run)）
  ✗ IFS 方式: TESTPASS（日本語リテラルの比較）が Passed
  …
シナリオ 9: …
  ✗ 大文字の接尾辞も検出される（glob の [tT]…）
```

前のシナリオの結果（outdated result）で待ちが抜けていた・行の aria-label はプログラム名から始まる、の 2 点を直して 24 項目すべて合格。
その前の回は `/run/user/1000` が消えて VS Code の窓が開かず、起動が時間切れになった（WSLg の実行時ディレクトリを使うようにした）。
