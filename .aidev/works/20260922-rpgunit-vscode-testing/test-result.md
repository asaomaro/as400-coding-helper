# テスト結果: RPGUnitテストのVS Code Test Explorer統合

## 実行したもの

- `npm test`（`vscode-extension/`。`tsc -p tsconfig.test.json` → mocha、`test/support/vscode-stub.js`で
  VS Code APIをスタブ化） — **1290 passed / 0 failed / 0 skipped**
  （うち新規: resultParser 5件・rpgunitCommands 5件・discovery 10件・codeForIbmi 9件・
  coverage 3件・testController 6件 = 38件）
- `npm run compile`（`tsc -p ./`。webviewを除く本体のプロダクションビルド） — エラー無し
- `aidev smoke`（DDS CLIのparse/lint、既存の起動確認コマンド） — exit 0

## 受け入れ基準ごとの判定

- AC1: pass — `testController.test.ts`「resolveHandlerがテストソースを検出しTestItemツリーを作る」で、
  ワークスペース内の`.rpgle`ファイルからTestItemツリー（ファイル→手続き）が構築されることを確認。
- AC2: pass — 「コンパイル成功・テスト成功ならrun.passedが呼ばれる」「コンパイル失敗（*SRVPGMが
  作られない）ならerroredとコンパイルエラー詳細を報告する」で、実行操作がCode for IBM iの接続
  （fakeConnection経由）を使ってコンパイル・実行される流れを確認。
- AC3: pass（間接） — VS Code標準のTest Explorer UIが`run.started`/`run.passed`/`run.failed`/
  `run.errored`のAPI呼び出しから状態表示を行う仕様（VS Code側の実装であり本PJの対象外）。
  本PJ側の責務である「正しいタイミングで正しいAPIを呼ぶこと」はテストで確認済み。
  **実際の見た目（アイコン・色）はVS Code実機での確認をしていない**（下記「未検証の穴」参照）。
- AC4: pass — 「テスト失敗（failure）ならrun.failedがlocation付きで呼ばれる」でTestMessageの
  message/locationが正しく設定されることを確認。コンパイルエラーのケースも同テストファイルで確認。
- （AC5だったコードカバレッジは、この検証ラウンドで**対象外へ差し戻した**。decisions.md
  D7参照。requirements.md/design.md/tasks.mdを更新済み。`isCodeCoverageAvailable`
  （検出）のみ実装・テスト済み。）
- AC6: pass — 全1290件のunit testが回帰なしで通過。`git diff --stat vscode-extension/package.json`は
  無関係な整形差分を除去済みで実質差分ゼロ（新規コマンド・設定の追加なし）。既存の
  `rpg-fixed`言語登録・プロンプター・ルーラー・SOSI等のテストに影響がないことを確認。
- AC-I1: pass（間接） — VS Code標準のTest Explorerパネル自体（本PJでの追加実装なし）。
- AC-I2: pass — `runHandler`が`CancellationToken`を受け取り`token.isCancellationRequested`で
  中断できる実装になっていることをコードレベルで確認（キャンセル発火の実機確認はしていない）。
- AC-I3: pass（間接） — VS Code標準のTest Explorerキーボード操作（本PJでの追加実装なし）。
- AC-I4: pass — 上記AC4のテストで`TestMessage.location`が設定されることを確認（ジャンプ先の
  実機での見た目確認はしていない）。
- AC-I5: pass — package.jsonに新規キーバインド・コマンドが追加されていないことを確認
  （既存の`rpgClSupport.rpgTabNext`等と衝突しない）。

## 失敗の証跡

このラウンドでは失敗が発生していない（1290件すべて初回から合格）。

## ラウンド2（review差し戻し後の再検証・2026-09-22）

reviewラウンド1の指摘2件（キャンセル時のskipped未遷移、`getSpooledFiles`の死んだオプション）を
coding工程で修正後、再検証した。

```
$ npm test（vscode-extension/）
  1291 passing (979ms)
```

回帰テスト「開始前にキャンセル済みなら対象の子テストはskippedになる」を含め全件green。
`aidev smoke`も再実行しpass（exit 0）。このラウンドでも失敗は発生していない。

**踏んだ罠**: `npm test`の直前に`rm -rf out out-test`を打ったところ、本番ビルド成果物
（`out/`）まで削除され、`aidev smoke`が`node vscode-extension/out/cli/dds.js`を見つけられず
exit 1で落ちた。`npm run compile`で再ビルドしてから`smoke`を打ち直し、pass を確認した。
（`out-test/`のみクリーンすべきところ、`out/`も巻き込んだ操作ミス。テスト用と本番用の
成果物ディレクトリを毎回区別する必要がある。）

## 起動確認（smoke）

```
$ node vscode-extension/out/cli/dds.js parse vscode-extension/test/golden/RENDER1.dspf && node vscode-extension/out/cli/lint.js vscode-extension/test/golden/RENDER1.dspf
（DSPFのJSON出力とSARIF形式のlint結果。省略）
smoke: pass (exit 0)
```

この work はCLIの新しい入口を追加していない（VS Code Testing APIへの統合であり、既存のDDS CLIには
触れていない）ため、`smokeCommands`への追加は行わない。追加した表面（Test Explorer統合）は
VS Code拡張機能ホストの起動を要し、現在の`smokeCommand`の枠組み（CLIプロセスの起動確認）では
検証できない（下記「未検証の穴」参照）。

## ラウンド3（deliver 後・本物の VS Code／Code for IBM i／実機での E2E・2026-09-26）

### 修正前（PR #178 のマージ済みコード）で観測した失敗

VS Code 1.137.0（`.vscode-test/`）を `playwright-core` の `_electron` で起動し、Code for IBM i 3.0.13 で
SR-OSAKA に接続して Testing ビューから全テストを実行した。検出は正しい（`RUE2ETST` 配下に
`TESTPASS`/`TESTFAIL`）が、両方とも Errored。Test Results パネルの本文（そのまま）:

```
コンパイルに失敗しました。
CPC3305: 0個のファイルが削除された。0個のファイルは削除されていません。
CPC2198: 現行ライブラリーが*CRTDFTに変更された。
CPC2101: ライブラリー・リストが変更された。
null: CRTRPGMOD
null:   MODULE(ASAOLIB/RUE2ETST)
null:   SRCFILE(ASAOLIB/QUNITSRC)
null:   SRCMBR(RUE2ETST)
null:   OPTION(*SRCSTMT)
null:   DBGVIEW(*LIST)
null:   TGTRLS(*CURRENT)
null:   DEFINE(*NONE)
CPF427D: データ変換に置換文字が使用された可能性があります。
CPF4102: メンバーTEMPLATESを含むファイルQINCLUDEがライブラリー*LIBLに見つからない。
```

原因と修正は decisions.md D8・tasks.md T10〜T13。古い `*SRVPGM` による誤判定は、修正後のコードで
`*SRVPGM`（`OBJCREATED 2026-09-26-11.33.03`）が残った状態のままコンパイル失敗させ、
Errored になることを実機で確認した。

### 修正後

```
$ npm test（vscode-extension/）
  1299 passing

$ cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify <repo>/vscode-extension/dev/rpgunit-e2e.mjs
シナリオ 1: 正常
  ✓ TESTPASS が Passed
  ✓ TESTFAIL が Failed
  ✓ TESTFAIL の失敗メッセージが出る
  ✓ .rpgle の言語モードが RPG Fixed のまま（実際: RPG Fixed）
シナリオ 2: 古い *SRVPGM が残ったままコンパイル失敗
  ✓ 前提: シナリオ 1 の *SRVPGM が残っている
  ✓ 両方 Errored（古いテストを成功と報告しない）
  ✓ コンパイル失敗のメッセージが出る
  ✓ 片付け後に実機へ何も残っていない
SUCCESS
```

画面でも、テストツリー（`TESTPASS` ✓ / `TESTFAIL` ✗）、エディターの行頭マーカー（3 行目 ✓・7 行目 ✗。
`TestMessage.location`／`TestItem.range` が効いている）、失敗本文 `Expected '2', but was '3'.`、
既存機能（ルーラー・SOSI・言語モード `RPG Fixed`）が Code for IBM i と同居して動くことを確認した。
追加した単体テスト 8 件は、実装を修正前に戻すと落ちることを確認済み。

## 未検証の穴（skip / 環境不足）

- ~~実際のVS Code拡張機能ホストでの動作確認をしていない~~ → ラウンド3で解消（「起動できない」は誤りだった。
  decisions.md D8）。
- ~~実際のCode for IBM i拡張機能・実際のIBM i接続での動作確認をしていない~~ → ラウンド3で解消。
- 実機 E2E は手動のハーネス（`dev/rpgunit-e2e.mjs`）で、CI には載せていない（実機と資格情報が要るため）。
- Code for IBM i は 3.0.13 の 1 版でのみ確認。
- テスト 1 件だけの実行（手続き単位の `TSTPRC`）は未実装で、ファイル単位でまとめて走る。
- キャンセル操作（AC-I2）の実機での操作確認はしていない（単体テストのみ）。
- **コードカバレッジは対象外**（D7）。
