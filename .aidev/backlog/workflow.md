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

- [ ] EVFEVENT の SQL 取得を実機確認する — `CRTBNDRPG OPTION(*EVENTF)` →
      EVFEVENT メンバーを SELECT → `@ibm/ibmi-eventf-parser` で解析まで通す。
      pub400 復旧後最初に実施（設計書 7 章 #1）
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

- [ ] lint core パッケージを作る（桁検査） — 本 PJ の桁定義を使う VS Code 非依存
      パッケージ。まず RPG/DDS の桁位置検査（設計書 4.3）
- [ ] lint core にキーワード使用レベル検査を足す — DDS の file/record/field レベル
      （依存: 上の桁検査）
- [ ] 任意 CL 実行・IFS 書き込みを MCP に配線する (repo:as400-web-emulator) —
      `CommandConnection` / `IfsConnection` の公開（設計書 F3 の不足 2）
- [ ] 既存スプール読み取りを MCP に配線する (repo:as400-web-emulator) —
      Network Print 経由 `listSpooledFiles` / `readSpooledText`（コンパイルリスト取得に必要）
- [ ] レシピを CLI 化する — 実証済みレシピを npm パッケージに固定化
      (needs: 実機操作レシピの skill 化)
- [ ] clPrompter との F4 衝突を確認する — 併用時の keybinding 挙動（設計書 7 章 #3）

## P3: 将来

- [ ] E2E ハーネスを DSL 化する (repo:as400-web-emulator) — example-automation.mjs の
      雛形をパッケージ化（レポーター・フィクスチャ管理）
- [ ] CI を整える — 本 PJ の lint core と as400-web-emulator のオフライン回帰を CI で
- [ ] PowerVS トライアル環境の手順を文書化する — 申請〜接続〜片付け（設計書 5.1）
- [ ] チーム向け導入手順を書く — 一人検証の完了後（設計書 5.3）
