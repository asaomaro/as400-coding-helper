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

## レビュー ラウンド 3（US4: AC12〜AC18 追加分）

- [must] `buildChangeAttributesCommand` が組み立てる `CHGPFM` コマンドは `system "CHGPFM ... TEXT('<escapeClStringLiteral 済みの値>')"` の形で `client.exec()` へ渡る。SSH の exec リクエストはサーバー側（sshd）がユーザーのログイン shell に `shell -c '<command>'` の形で実行させるため、外側の**二重引用符も remote shell によって解釈される**。`escapeClStringLiteral` は CL 文字列リテラルのアポストロフィ（`'` → `''`）しかエスケープしておらず、`textDescription` に `"` `$` `` ` `` `\` が含まれる場合、remote shell の二重引用符コンテキストを抜けて任意のコマンドが注入され得る（例: `テキスト記述` に `" ; rm -rf / ; echo "` のような文字列を含むファイル名でアップロードすると、shell に `"..."` の外側で追加コマンドが渡る）。これは research.md F12 で「`system \"...\"` の外側二重引用符と CL 文字列リテラルの単引用符、少なくとも2層のエスケープが必要」と指摘しながら、design.md・実装では CL 単引用符の層しかエスケープを specify/実装していなかった（研究→設計の間で申し送りが1層分落ちた）。修正は、`escapeClStringLiteral` 適用後の文字列にさらに remote shell 用の二重引用符コンテキスト向けエスケープ（`\`, `"`, `$`, `` ` `` を `\` で前置）を適用してから埋め込むこと。既存の `library`/`sourceFile`/`member`/`sourceType` は `IBM_I_OBJECT_NAME`/`SOURCE_TYPE` 正規表現で英数字・`$` `#` `@` `_` のみに制限されているため、この4値には該当文字が現れず影響を受けない。— 根拠: `vscode-extension/src/sync/ibmiSourceTransport.ts`（`buildChangeAttributesCommand`, `escapeClStringLiteral`）, research.md F12, design.md「`textDescription` のエスケープ」 [conv:-]

## レビュー ラウンド 4（US4: ラウンド3 の指摘解消確認）

- 指摘なし。ラウンド3 の must は `escapeForRemoteShellDoubleQuoted` を新設し、`escapeClStringLiteral` の後段で適用してから `TEXT('...')` を組み立てるよう修正して解消した。`\` `"` `$` `` ` `` を含むテキスト記述で、shell → CL の順にエスケープを剥がすと元の生文字列に戻ることを unit test で確認し、修正前に戻すと当該テストが fail することも確認した（test-result.md「review ラウンド3 の指摘修正後の再検証」）。`aidev coverage` は design=23/23・tasks=23/23・gaps=0 のまま変化なし。— 根拠: `vscode-extension/src/sync/ibmiSourceTransport.ts`（`escapeForRemoteShellDoubleQuoted`, `buildChangeAttributesCommand`）, `vscode-extension/test/unit/memberSync.test.ts`, decisions.md D10 [conv:-]
