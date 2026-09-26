# テスト結果: RPGUnit テストにテスト対象のサービスプログラムをバインドする

## 実行したもの

- `npm test`（`vscode-extension/`） — **1332 passed / 0 failed / 0 skipped**
  （追加・変更: `testingConfig.test.ts` 29 件、`rpgunitCommands.test.ts` 3 件（うち 1 件は期待値を D4 で変更）、
  `testController.test.ts` 2 件）
- `npx tsc -p ./` — エラー無し
- `aidev smoke` — pass
- 実機 E2E（`dev/rpgunit-e2e.mjs`。VS Code 1.137.0＋Code for IBM i 3.0.13＋SR-OSAKA） — 13 項目すべて合格

追加したテストが実装の誤りを捕まえることを確認済み:
- `testingConfig.ts` に変異を入れて流した。`.vscode` 側を検査しない→5 件落ちる、大文字にしない→2 件落ちる。
  ワークスペース外まで遡る変異は、止める仕組みが 2 つ（ルートで止まる／外に出たら止まる）あり片方だけでは
  挙動が変わらない（等価）。両方を壊すと「ワークスペースの外にある testing.json は読まない」が落ちる。
- `rpgunitCommands.ts` をコミット済みの版に戻すと新しいテスト 2 件が落ちる。
- `testController.ts` をコミット済みの版に戻すと新しいテスト 2 件が落ちる。

## 受け入れ基準ごとの判定

- AC1: pass — 単体（同じディレクトリ／親／`.vscode` だけ／ワークスペース外は読まない／ファイルごとに別の値）。
  実機 E2E シナリオ 4（同じディレクトリの `testing.json`）。
- AC2: pass — 単体。実機 E2E シナリオ 5（`.vscode/testing.json` の `bndDir`）。
- AC3: pass — 単体（同じキーは最寄りが配列ごと勝つ・片方にしか無いキーはその値）。
- AC4: pass — 単体（修飾を足さない・小文字は大文字で渡る）。実機でも修飾なしの `E2ECALC`/`E2EBND` で解決した。
- AC5: pass — 単体（(a)〜(d)・読めない・パスと理由・該当ファイルだけ errored・アップロードしない）。
- AC6: pass — 既存の単体テスト全件と実機 E2E シナリオ 1・2（`testing.json` 無し）。
- AC7: pass — 実機 E2E シナリオ 3〜5。対照（シナリオ 3）は `CPD5D02: 記号'E2EADD'の定義が見つからない。`
  で落ちており、落ちる理由まで確認した。
- AC8: pass — 単体（`cOption`・`dbgView`・`rucalltst` 等を含む `testing.json`）。
- AC9: pass — 単体（空配列・キー無し）。

## 失敗の証跡

実装の失敗ではなく、E2E の判定を強めた回で 1 件落ちた（対照の理由の確認）。本文のエディターは表示中の
行しか DOM に出ず、先頭しか読めていなかった（decisions.md D8）。

```
シナリオ 3〜5: テスト対象のサービスプログラムをバインドする（testing.json）
  ✗ 対照の理由がバインドの欠落（E2EADD が解決できない）: (見つからない)
```

末尾へ移って読み直すよう E2E を直した後:

```
シナリオ 1: 正常
  ✓ TESTPASS が Passed
  ✓ TESTFAIL が Failed
  ✓ TESTFAIL の失敗メッセージが出る
  ✓ .rpgle の言語モードが RPG Fixed のまま（実際: RPG Fixed）
シナリオ 2: 古い *SRVPGM が残ったままコンパイル失敗
  ✓ 前提: シナリオ 1 の *SRVPGM が残っている
  ✓ 両方 Errored（古いテストを成功と報告しない）
  ✓ コンパイル失敗のメッセージが出る
シナリオ 3〜5: テスト対象のサービスプログラムをバインドする（testing.json）
  ✓ 対照: testing.json 無しでは Errored
  ✓ 対照の理由がバインドの欠落（E2EADD が解決できない）: CPD5D02: 記号'E2EADD'の定義が見つからない。
  ✓ bndSrvPgm: ["E2ECALC"] で Passed
  ✓ bndDir: ["E2EBND"]（.vscode/testing.json）で Passed
  ✓ 片付け後に実機へ何も残っていない
SUCCESS
```

## 起動確認（smoke）

```
smoke: pass (exit 0)
```

CLI の入口は増やしていない（Test Explorer 統合への機能追加）ため `smokeCommands` は変えない。

## 未検証の穴（skip / 環境不足）

- IBM i Testing 拡張で同じ `testing.json` を読ませての突き合わせはしていない（書式・探し方は一次ソースの直読に依る）。
- 両方の `testing.json` に同じキーを書いたときの結果は IBM i Testing と違いうる（D5。意図した差）。
- 利用者向けの説明（`testing.json` の書き方）を置く場所がリポジトリに無く、書いていない。
- 実機 E2E は手動のハーネス（CI には載せない）。
