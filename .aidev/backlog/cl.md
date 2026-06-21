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

### P2 メッセージ — 20260621-cl-defs-batch-p2p4（issue #43）で実装・原典照合済み

- [x] SNDMSG — メッセージ送信
- [x] SNDUSRMSG — ユーザー・メッセージ送信
- [x] SNDRPY — 応答送信
- [x] RMVMSG — メッセージ除去
- [x] RTVMSG — メッセージ検索

### P3 データ域 — 20260621-cl-defs-batch-p2p4（issue #43）で実装・原典照合済み

- [x] CRTDTAARA — データ域作成
- [x] CHGDTAARA — データ域変更
- [x] RTVDTAARA — データ域検索
- [x] DLTDTAARA — データ域削除

### P4 ファイル/メンバ/DB — 20260621-cl-defs-batch-rest（issue #43）で実装・原典照合済み

- [x] ADDPFM — 物理ファイル・メンバー追加（20260621-cl-defs-batch-p2p4 / issue #43）
- [x] CLRPFM — 物理ファイル・メンバー消去
- [x] RGZPFM — 物理ファイル・メンバー再編成
- [x] RMVM — メンバー除去
- [x] CPYF — ファイル・コピー
- [x] OVRDBF — データベース・ファイル一時変更
- [x] OPNQRYF — QUERYファイル・オープン
- [x] CHGPF — 物理ファイル変更
- [x] CRTPF — 物理ファイル作成
- [x] CRTLF — 論理ファイル作成
- [x] CRTSRCPF — ソース物理ファイル作成
- [x] DCLF — ファイル宣言
- [x] RCVF — ファイル受信
- [x] SNDF — ファイル送信
- [x] OVRPRTF — 印刷装置ファイル一時変更
- [x] CLOF — ファイルのクローズ

### P5 オブジェクト/権限 — 20260621-cl-defs-batch-rest（issue #43）で実装・原典照合済み

- [x] ALCOBJ — オブジェクト割り振り
- [x] DLCOBJ — オブジェクト割り振り解除
- [x] CHGOBJD — オブジェクト記述変更
- [x] RTVOBJD — オブジェクト記述の検索
- [x] DSPOBJD — オブジェクト記述表示
- [x] MOVOBJ — オブジェクト移動
- [x] RNMOBJ — オブジェクト名変更
- [x] CRTDUPOBJ — 複製オブジェクト作成
- [x] DLTOBJ — オブジェクトの削除
- [x] CHKOBJ — オブジェクト検査
- [x] GRTOBJAUT — オブジェクト権限認可
- [x] RVKOBJAUT — オブジェクト権限取り消し
- [x] SAVOBJ — オブジェクト保管
- [x] RSTOBJ — オブジェクト復元

### P6 ライブラリ — 20260621-cl-defs-batch-rest（issue #43）で実装・原典照合済み

- [x] ADDLIBLE — ライブラリー・リスト項目追加
- [x] CRTLIB — ライブラリー作成
- [x] DLTLIB — ライブラリー削除

### P7 ジョブ — 20260621-cl-defs-batch-rest（issue #43）で実装・原典照合済み

- [x] CHGJOB — ジョブ変更
- [x] SBMJOB — ジョブ投入
- [x] WRKJOB — ジョブ処理
- [x] WRKACTJOB — 活動ジョブ処理
- [x] DLYJOB — ジョブ延期

### P8 スプール — 20260621-cl-defs-batch-rest（issue #43）で実装・原典照合済み

- [x] CHGSPLFA — スプール・ファイル属性変更
- [x] CPYSPLF — スプール・ファイル・コピー
- [x] DLTSPLF — スプール・ファイル削除
- [x] HLDSPLF — スプール・ファイルの保留
- [x] RLSSPLF — スプール・ファイル解放
- [x] WRKOUTQ — 出力待ち行列処理

### P9 作成（PGM/ファイル） — 20260621-cl-defs-batch-rest（issue #43）で実装・原典照合済み

- [x] CRTBNDCL — バインドCL PGMの作成
- [x] CRTBNDRPG — バインドRPG PGMの作成
- [x] CRTCLPGM — CLプログラム作成
- [x] CRTPGM — プログラムの作成
- [x] CRTRPGMOD — RPGモジュールの作成
- [x] CRTDSPF — 表示装置ファイル作成
- [x] CRTPRTF — 印刷装置ファイル作成

### P10 検索/表示 — 20260621-cl-defs-batch-rest（issue #43）で実装・原典照合済み

- [x] RTVSYSVAL — システム値検索
- [x] RTVMBRD — メンバー記述の検索
- [x] DSPFD — ファイル記述表示
- [x] DSPFFD — ファイル・フィールド記述表示
