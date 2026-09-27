# レビュー: ソース・ファイル単位でメンバーを一括で送受信する

## 観点と結果
- 到達性: `extension.ts` で登録、`package.json` のコマンドと `explorer/context`、WebView の資産は `esbuild.webview.mjs` が `out/sync-webview/` に束ねる（`vscode:prepublish` も同じスクリプト）。検査（verify-contributes）と統合テストで固定。
- 契約: 画面 → ホストのメッセージは `parseSyncMessage` を通す（DDS で踏んだ「新しい種類を足して parse に無く黙って捨てられる」を避けるため、パネルのテストは実際にメッセージを送って確かめる）。
- 安全: 名前は `isIbmiObjectName` で検査してから SQL に入れる。CL の `'` と remote shell の `\ " $ `` ` `` を別々に逃がす（既存の CHGPFM と同じ 2 層）。未保存の文書は転送しない。上書きは転送先が新しいものだけ確認（利用者の判断）。
- 単一の真実源: ファイル名 ⇔ メンバーの読み方は既存の `resolveMemberTarget`、新規の名前 `downloadFileName` はそれで読み戻せることをテストで固定。
- 判断の記録: 「状態は更新日時の新旧だけ」を成り立たせるため、転送後にローカルの更新日時を IBM i に揃える（揃えないとダウンロードしただけでローカルが「新しい」になる）。記述にファイル名に使えない文字があるときは置き換えずに付けない（置き換えるとアップロードで IBM i の記述が変わる）。
- 残る制約: SSH 経路の実機確認は未了（test-result の「未検証の穴」）。

## 判定
承認。
