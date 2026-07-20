---
backlog: workflow
kind: standing        # 定常ドメインキュー（ワークフロー基盤の実装・確認タスク）
priority: 2           # cl(1) の次。設計書: docs/workflow/ibmi-dev-workflow.md
---
# IBM i 開発ワークフロー バックログ

設計書 `docs/workflow/ibmi-dev-workflow.md`（work `20260719-ibmi-dev-workflow`）から
起票した実装・確認タスク。各未チェック行 = 1 件のタスク。
**`(repo:as400-web-emulator)` 付きの行は実装先が別リポジトリ**であり、本 PJ の
`aidev-util-batch` では着手しない（追跡のみ。実装はあちらの backlog と合流させる）。

## P1: 自律ループ成立に必須

- [x] EVFEVENT の取得を実機確認する — 2026-07-19 pub400(7.5) で全段確認。
      **SQL は不可**（`RUNSQLSTM` は SQL0084 / PASE `db2` は権限なし）で
      `CPYTOSTMF` を使う。行・桁・msgId・重大度が取れることまで確認。
      コマンド列は skill `ibmi-remote` に、訂正は設計書 4.1 に反映
- [ ] RPGUnit の pub400 導入可否を確認する — RPGUNIT ライブラリの導入を試み、
      `@ibm/itest` で 1 本実行する。あわせて **`RUCALLTST` の結果出力の形**を採取する
      （失敗は CPF9897 例外で伝わるため EVFEVENT とは別経路。設計書 4.2 / 7 章 #2）
- [ ] 実機操作レシピを skill 化する — メンバー送受信（CCSID レシピ）・コンパイル
      （liblist + *EVENTF）・エラー取得の 3 レシピを `.claude/skills/` に。
      資格情報は環境変数のみ（設計書 4.1）(needs: EVFEVENT の SQL 取得を実機確認する)
- [ ] SQL ツールを MCP に配線する (repo:as400-web-emulator) — core の `DbConnection` を
      MCP ツール（query 系）として公開。書き込みは対象スキーマ検証付き
      （設計書 4.2 / 6 章 #1。あちらの backlog `hostserver.md` と合流）

## P2: 品質向上

- [x] lint core パッケージを作る（桁検査） — 2026-07-20 PR#101 でマージ。
      `src/lint/` (vscode 非依存) ＋ CLI(SARIF) ＋ 編集中の診断。判定の共有は
      `src/core/` に切り出した。**規則は 3 つだけ既定 ON**（`line-length` /
      `numeric-field` / `numeric-alignment`）。要件の 4 項目のうち「必須欄の未入力」と
      「定義済み値以外」は、実機コンパイル確認済み 1060 行への実測で 30 件の偽陽性が
      出たため既定 OFF で枠だけ用意した（下の follow-up 参照）
- [ ] lint core にキーワード使用レベル検査を足す — DDS の file/record/field レベル
      （依存: 上の桁検査）
- [ ] 任意 CL 実行・IFS 書き込みを MCP に配線する (repo:as400-web-emulator) —
      `CommandConnection` / `IfsConnection` の公開（設計書 F3 の不足 2）
- [ ] 既存スプール読み取りを MCP に配線する (repo:as400-web-emulator) —
      Network Print 経由 `listSpooledFiles` / `readSpooledText`（コンパイルリスト取得に必要）
- [ ] レシピを CLI 化する — 実証済みレシピを npm パッケージに固定化
      (needs: 実機操作レシピの skill 化)
- [ ] AI によるテスト生成の方式を確立する — 設計書 4.2「AI にテストを書かせる場合の方針」を
      実行手順に落とす。受け入れ条件: (1) 新規は設計書をオラクルにする (2) 既存は特性化と
      明記させる (3) ミューテーションで検出力を検品 (4) `ORDER(*REVERSE)` で独立性を検品。
      壁の解消が前提 (needs: SQL ツールを MCP に配線する)
- [ ] 固定長（P 仕様書）で RPGUnit テストが書けることを実機確認する — 原典の例は
      すべて `**free` で固定長の実例が無い。本 PJ の対象は固定長なので要確認
      (needs: RPGUnit の pub400 導入可否を確認する)
- [ ] clPrompter との F4 衝突を確認する — 併用時の keybinding 挙動（設計書 7 章 #3）
- [ ] lint の値集合を修復して `restricted-value` を有効にする — 原典が有効値の一覧の
      **直後の「注」**で DBCS のデータ・タイプ(J/E/O/G)を足しており生成器が読めていない。
      表示装置 38 桁目は「ブランクまたは 0」で 1 文字の正規表現に合わず両方落ちている。
      実機が受けるのに原典に無い値もある(`CUSTMNT.dspf` の 38 桁 "O")。
      `generate-dds-prompter.mjs` の注記解析＋実機での裏取りが要る (needs: lint core パッケージを作る（桁検査）)
- [ ] RPG III の桁属性を実機で確定する — `numericOnly` の欄が定義に 1 つも無く、
      `.rpg`/`.sqlrpg` には `line-length` しか届かない。RPG/400 Reference が入手できない
      ため原典照合ができず、実機のコンパイラに判定させる（`probe-rpg3-opcodes.sh` の手法）
- [ ] CI の「再生成しても差分が出ないこと」を直す — **PR#95 以降 main がずっと赤い**。
      (1) 再生成ステップが `generate-cdml-rules.mjs` を呼んでおらず CDML 由来データ
      (`dependencies`/`valueMap`) が消える（401 ファイル差分） (2) それを直しても
      `attributes` のキー順が再現せず 87 ファイル差分が残る（中身は同一）。
      生成器のキー順を正規化して全件再生成する必要がある
- [ ] `docs/src/` の未検証サンプルを実機で確かめる — `CHECKLIST.md` は「すべて
      コンパイル確認済み」と書くが「作成物」欄は 6 件しか埋まっていない。lint は
      `EMPMNT01.rpgle` に 12 件・`SLSENT01.rpgle` に 18 件を検出しており、D 仕様書の
      長さ欄が 33-39 桁に収まっていない疑いがある（確認済みの `IOSAMP.rpgle` は規定どおり）。
      真陽性なら**サンプルの方を直す**。あわせて CHECKLIST の記述と実態を一致させる
- [ ] `positionResolver` に RPG 注記行のガードを足す — `ruler.ts:573` にはあるが
      `positionResolver` に無く、`     H* コメント` に F4 を当てると `H-SPEC` が開く

## P3: 将来

- [ ] E2E ハーネスを DSL 化する (repo:as400-web-emulator) — example-automation.mjs の
      雛形をパッケージ化（レポーター・フィクスチャ管理）
- [ ] CI を整える — 本 PJ の lint core と as400-web-emulator のオフライン回帰を CI で
- [ ] PowerVS トライアル環境の手順を文書化する — 申請〜接続〜片付け（設計書 5.1）
- [ ] チーム向け導入手順を書く — 一人検証の完了後（設計書 5.3）
