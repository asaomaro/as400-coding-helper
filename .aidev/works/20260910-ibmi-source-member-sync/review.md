# レビュー記録

## タスク点検ログ

- [should] T5 の文書変更・設定変更の再描画経路には直接の回帰テストが無かったため、VS Code stub のイベント発火器と「本文変更で再計算し、設定を無効化したらすべて解除する」テストを追加した。— 根拠: `vscode-extension/src/language/seuColorMarkers.ts`, `vscode-extension/test/unit/seuColorMarkers.test.ts` [conv:-]
- [should] T6 で cleanup 用 IFS 再接続が失敗したときに一時ファイルを削除せず成功扱いになり得たため、主操作成功時は再接続不能も cleanup failure にするよう修正した。— 根拠: `.aidev/works/20260910-ibmi-source-member-sync/verify/probe-seu-source-color.mjs` [conv:-]
- [must] T7 で Base64 fingerprint の大小文字の誤受理を修正し、旧比較へ戻すと 1 件 fail、修正版で pass となる回帰テストを追加した。— 根拠: `vscode-extension/src/sync/ibmiSourceTransport.ts`, `vscode-extension/test/unit/memberSync.test.ts` [conv:-]

## coding 時点の未検証

- `npm run test:integration` は、ローカルの VS Code 1.137.0 を検出してテスト起動直前まで到達したが、この実行環境の Chromium sandbox が `Operation not permitted` で SIGTRAP となり完走できなかった。
- 実機 probe の `map` / `red` / `dbcs` は、IBM i host server への TCP 接続が sandbox により `EPERM` で拒否され、リモート資源を作成する前に停止した。test 工程でネットワークと Chromium sandbox を許可した環境から再実行する。

## レビュー ラウンド 1

- [must] `hostKeySha256` が `SHA256:` Base64 fingerprint のときも比較全体を `toLowerCase()` しているため、Base64 本体の大文字・小文字だけが異なる別 fingerprint を一致として扱う。Base64 は大小文字を区別するため、hex fingerprint だけを大文字・小文字非区別にし、Base64 は完全一致で照合すること。— 根拠: `vscode-extension/src/sync/ibmiSourceTransport.ts:257`; `SHA256:CfEOS9w3pHE4KlqjcQFwWyWMmyRvvPoehydyMhTxpzg` と `SHA256:cfEOS9w3pHE4KlqjcQFwWyWMmyRvvPoehydyMhTxpzg` は設定書式を満たすが、現実装では一致する。 [conv:-]

## レビュー ラウンド 2

- 指摘なし。前ラウンドの must は hex と Base64 の比較規則を分離して解消され、Base64 本体の大文字・小文字だけが異なる fingerprint を拒否する回帰テストを確認した。— 根拠: `vscode-extension/src/sync/ibmiSourceTransport.ts:253-260`, `vscode-extension/test/unit/memberSync.test.ts:189-211`, `test-result.md` [conv:-]
