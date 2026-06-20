# CLコマンド定義 バックログ

`aidev-batch` が消化する対象リスト。各未チェック行 = 1件のタスク（autonomous aidev の requirement）。
処理が済んだら `[x]` にし、PR/コミット参照を追記する。
（`aidev-batch` は未チェックの先頭から、1回の上限件数まで処理する。）

## 定義対象（プロンプター用 CL コマンド定義 JSON: `vscode-extension/resources/prompter/cl/<CMD>.json`）

- [x] CALL — プログラム呼び出し（既存）
- [x] SNDPGMMSG — プログラム・メッセージ送信（PR #8 マージ済）
- [x] DCL — CL変数宣言（PR #9）
- [x] CHGVAR — 変数変更（PR #9）
- [x] MONMSG — メッセージ・モニター（PR #9）
- [x] RCVMSG — メッセージ受信（aidev-batch 試走で生成・PR feature/cl-rcvmsg）
- [ ] DLTF — ファイル削除の定義JSONを作成
- [ ] RTVJOBA — ジョブ属性検索の定義JSONを作成
- [ ] SNDRCVF — レコード送受信の定義JSONを作成
- [ ] WRKSPLF — スプール・ファイル処理の定義JSONを作成

> 各行のタスクは「<CMD> の定義JSONを作成」。実処理は PJ skill `cl-command-def` に委譲される
> （IBM docs を Playwright で取得 → types.ts 準拠でマッピング・検証）。
