# タスク: RPGUnit テストにテスト対象のサービスプログラムをバインドする

## 実装方針

純粋ロジック（`testing.json` の解釈・検査・合成、コマンド組み立て）を先に単体テスト付きで作り、
I/O（探して読む）と `runFile` への配線でつなぐ。最後に実機 E2E で `BNDSRVPGM`・`BNDDIR` が実物で効くことを
確かめる。

## 作業順序と依存関係

下の `依存:` に従う。実機 E2E（T5）で `BNDDIR` が効かなければ、design「ドメイン固有の考慮」の分岐に入る:
T5 で止め、理由と観測した出力を decisions.md に残し、requirements を差し戻して `bndDir` を対象外へ移す。
そのうえで T1（`bndDir` の読み取り）・T3（`BNDDIR` の付与）・T4 の該当箇所を外すタスクを足し、T5（`bndDir` の
シナリオを外す）と T6 をやり直す。

## リスク / 留意点

- `BNDDIR` が IBM i 7.3 ＋ iRPGUnit v6.0.2.r で効くかは未確認（T5 で確かめる）。
- 既存の単体テスト「BNDSRVPGM はライブラリー修飾の無い名前に library を補う」の期待値を意図して変える（D4）。
  変えた理由がテスト名から読めるよう、テスト名も改める。

## テスト方針

- T1〜T4 は単体テスト（`npm test`）。追加したテストは、実装を外すと落ちることを確かめる（AGENTS.md）。
- T5 は実機 E2E（`dev/rpgunit-e2e.mjs`）。テスト対象のサービスプログラムとバインディング・ディレクトリは
  E2E が実機に作り、終わったら消して残りが無いことを数える。スプールは消さない。
- 既存の E2E シナリオ（正常・古い `*SRVPGM`）も同じ実行で回し、回帰が無いことを見る。

## タスク

- [x] T1: `resolveBinding`（純粋関数）を実装する。検査 (a)〜(d)・最上位と中間階層の型・大文字化・
      最寄り→`.vscode` の順の検査・キー単位の合成・ほかのキーの無視・両方 undefined なら空・
      `readError` を持つファイルは errored。単体テスト付き。
      対象: 新規 `vscode-extension/src/testing/testingConfig.ts` `resolveBinding` /
      新規 `vscode-extension/test/unit/testingConfig.test.ts` / 根拠: design「インターフェース」「振る舞いの詳細」4
      依存: なし
      AC: AC3, AC4, AC5, AC6, AC8, AC9
- [x] T2: `readTestingConfigs`（I/O）を実装する。テストファイルのディレクトリから親へワークスペースフォルダーの
      ルートまで最寄りを探し、`.vscode/testing.json` を読む。存在しない／読めないの区別。単体テスト付き
      （`test/support/vscode-stub.js` の既存の `getWorkspaceFolder`・`fs.stat`・`fs.readFile` を使い、
      足りなければディレクトリを返す `stat` を足す。design「対象範囲」の stub の変更に含める）。
      対象: `vscode-extension/src/testing/testingConfig.ts` `readTestingConfigs` /
      `vscode-extension/test/support/vscode-stub.js` / 根拠: design「振る舞いの詳細」3
      依存: T1
      AC: AC1, AC2, AC5
- [x] T3: `buildCreateTestCommand` に `bindingDirectories`（`BNDDIR`）を足し、`BNDSRVPGM` の修飾をやめる。
      空なら付けない。既存テストの期待値とテスト名を改める。
      対象: `vscode-extension/src/testing/rpgunitCommands.ts` `buildCreateTestCommand` /
      `vscode-extension/test/unit/rpgunitCommands.test.ts` / 根拠: design「インターフェース」、D4
      依存: なし
      AC: AC2, AC4, AC9
- [x] T4: `runFile` でアップロード前にバインド指定を解決し、誤りなら errored（コンパイルしない）、
      正しければ `buildCreateTestCommand` に渡す。単体テスト付き（ファイルごとに別の値・誤りは該当ファイルだけ・
      メッセージに `testing.json` のパスと理由が出る）。
      対象: `vscode-extension/src/testing/testController.ts` `runFile` /
      `vscode-extension/test/unit/testController.test.ts` / 根拠: design「振る舞いの詳細」1〜2
      依存: T2, T3
      AC: AC1, AC2, AC5, AC6
- [x] T5: 実機 E2E にバインドのシナリオを足す。テスト対象のサービスプログラム（手続きを 1 つ `EXPORT`）と
      バインディング・ディレクトリを実機に作り、`testing.json` 無し→Errored、`bndSrvPgm` 指定→Passed、
      `bndDir` 指定→Passed を判定する。片付けと残存ゼロの確認に含める。
      対象: `vscode-extension/dev/rpgunit-e2e.mjs` / 根拠: design「受け入れ基準との対応」AC7
      依存: T4
      AC: AC7
- [x] T6: 回帰確認。`npm test` 全件と、既存の E2E シナリオ（正常・古い `*SRVPGM`）が T5 と同じ実行で通ること。
      対象: 未特定（`vscode-extension/test/unit` と `dev/rpgunit-e2e.mjs` の実行結果）
      依存: T5
      AC: AC6
