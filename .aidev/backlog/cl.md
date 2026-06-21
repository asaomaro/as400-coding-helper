---
backlog: cl
kind: standing        # standing（定常ドメインキュー）| split（タスク分割由来・短命）
priority: 1           # 複数backlog選択順（小さいほど先）
---
# CLコマンド定義 バックログ

`aidev-util-batch` が消化する対象リスト。各未チェック行 = 1件のタスク（autonomous aidev の requirement）。
処理が済んだら `[x]` にし、PR/コミット参照を追記する。
（`aidev-util-batch` は未チェックの先頭から、1回の上限件数まで処理する。）

## 定義対象（プロンプター用 CL コマンド定義 JSON: `vscode-extension/resources/prompter/cl/<CMD>.json`）

- [x] CALL — プログラム呼び出し（既存）
- [x] SNDPGMMSG — プログラム・メッセージ送信（PR #8 マージ済）
- [x] DCL — CL変数宣言（PR #9）
- [x] CHGVAR — 変数変更（PR #9）
- [x] MONMSG — メッセージ・モニター（PR #9）
- [x] RCVMSG — メッセージ受信（aidev-batch 試走で生成・PR feature/cl-rcvmsg）
- [x] DLTF — ファイル削除の定義JSONを作成（aidev-batch / feature/cl-defs-batch-20260620）
- [x] RTVJOBA — ジョブ属性検索の定義JSONを作成（aidev-batch / feature/cl-defs-batch-20260620）
- [x] SNDRCVF — レコード送受信の定義JSONを作成（aidev-batch / feature/cl-defs-batch-20260620）
- [x] WRKSPLF — スプール・ファイル処理の定義JSONを作成（aidev-batch / feature/cl-defs-batch-20260620）

> 各行のタスクは「<CMD> の定義JSONを作成」。実処理は PJ skill `cl-command-def` に委譲される
> （IBM docs を Playwright で取得 → types.ts 準拠でマッピング・検証）。

## 拡充対象（issue #43 / 原典 `docs/origin/cl/<CMD>.html` を正とする 未定義85件）

PR #42 収集の原典HTML（IBM i 7.4 / `ssw_ibm_i_74`、`docs/origin/manifest.yml`）を grounded ソースとして定義化する。
優先度カテゴリ P1（制御構造）から着手。本作業（20260621-cl-defs-expand）で P1 を実装、残りは後続 batch で消化。

### P1 制御構造（CL論理） — 20260621-cl-defs-expand（issue #43）で実装・原典照合済み

- [x] PGM — プログラム
- [x] ENDPGM — プログラム終了
- [x] IF — IF（条件分岐）
- [x] ELSE — ELSE
- [x] DO — DOグループ
- [x] ENDDO — DOグループ終了
- [x] DOWHILE — DO WHILE
- [x] DOUNTIL — DO UNTIL
- [x] DOFOR — DO FOR
- [x] SELECT — SELECT
- [x] WHEN — WHEN
- [x] OTHERWISE — OTHERWISE
- [x] ENDSELECT — SELECTグループ終了
- [x] GOTO — GO TO
- [x] ITERATE — ITERATE
- [x] LEAVE — LEAVE
- [x] RETURN — 戻り
- [x] SUBR — サブルーチン
- [x] ENDSUBR — サブルーチンの終了
- [x] CALLSUBR — サブルーチンの呼び出し
- [x] CALLPRC — 結合プロシージャーの呼び出し

### P2 メッセージ

- [ ] SNDMSG — メッセージ送信
- [ ] SNDUSRMSG — ユーザー・メッセージ送信
- [ ] SNDRPY — 応答送信
- [ ] RMVMSG — メッセージ除去
- [ ] RTVMSG — メッセージ検索

### P3 データ域

- [ ] CRTDTAARA — データ域作成
- [ ] CHGDTAARA — データ域変更
- [ ] RTVDTAARA — データ域検索
- [ ] DLTDTAARA — データ域削除

### P4 ファイル/メンバ/DB

- [ ] ADDPFM — 物理ファイル・メンバー追加
- [ ] CLRPFM — 物理ファイル・メンバー消去
- [ ] RGZPFM — 物理ファイル・メンバー再編成
- [ ] RMVM — メンバー除去
- [ ] CPYF — ファイル・コピー
- [ ] OVRDBF — データベース・ファイル一時変更
- [ ] OPNQRYF — QUERYファイル・オープン
- [ ] CHGPF — 物理ファイル変更
- [ ] CRTPF — 物理ファイル作成
- [ ] CRTLF — 論理ファイル作成
- [ ] CRTSRCPF — ソース物理ファイル作成
- [ ] DCLF — ファイル宣言
- [ ] RCVF — ファイル受信
- [ ] SNDF — ファイル送信
- [ ] OVRPRTF — 印刷装置ファイル一時変更
- [ ] CLOF — ファイルのクローズ

### P5 オブジェクト/権限

- [ ] ALCOBJ — オブジェクト割り振り
- [ ] DLCOBJ — オブジェクト割り振り解除
- [ ] CHGOBJD — オブジェクト記述変更
- [ ] RTVOBJD — オブジェクト記述の検索
- [ ] DSPOBJD — オブジェクト記述表示
- [ ] MOVOBJ — オブジェクト移動
- [ ] RNMOBJ — オブジェクト名変更
- [ ] CRTDUPOBJ — 複製オブジェクト作成
- [ ] DLTOBJ — オブジェクトの削除
- [ ] CHKOBJ — オブジェクト検査
- [ ] GRTOBJAUT — オブジェクト権限認可
- [ ] RVKOBJAUT — オブジェクト権限取り消し
- [ ] SAVOBJ — オブジェクト保管
- [ ] RSTOBJ — オブジェクト復元

### P6 ライブラリ

- [ ] ADDLIBLE — ライブラリー・リスト項目追加
- [ ] CRTLIB — ライブラリー作成
- [ ] DLTLIB — ライブラリー削除

### P7 ジョブ

- [ ] CHGJOB — ジョブ変更
- [ ] SBMJOB — ジョブ投入
- [ ] WRKJOB — ジョブ処理
- [ ] WRKACTJOB — 活動ジョブ処理
- [ ] DLYJOB — ジョブ延期

### P8 スプール

- [ ] CHGSPLFA — スプール・ファイル属性変更
- [ ] CPYSPLF — スプール・ファイル・コピー
- [ ] DLTSPLF — スプール・ファイル削除
- [ ] HLDSPLF — スプール・ファイルの保留
- [ ] RLSSPLF — スプール・ファイル解放
- [ ] WRKOUTQ — 出力待ち行列処理

### P9 作成（PGM/ファイル）

- [ ] CRTBNDCL — バインドCL PGMの作成
- [ ] CRTBNDRPG — バインドRPG PGMの作成
- [ ] CRTCLPGM — CLプログラム作成
- [ ] CRTPGM — プログラムの作成
- [ ] CRTRPGMOD — RPGモジュールの作成
- [ ] CRTDSPF — 表示装置ファイル作成
- [ ] CRTPRTF — 印刷装置ファイル作成

### P10 検索/表示

- [ ] RTVSYSVAL — システム値検索
- [ ] RTVMBRD — メンバー記述の検索
- [ ] DSPFD — ファイル記述表示
- [ ] DSPFFD — ファイル・フィールド記述表示
