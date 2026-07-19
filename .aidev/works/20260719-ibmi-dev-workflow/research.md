# 調査: VS Code を軸とした IBM i 開発ワークフローの資源と実現性

調査日: 2026-07-19。方法: 各リポジトリのソース直読（README の要約に頼らない）＋
IBM 原典＋ Web 調査（委譲分は出典 URL 付きで受領し、要点は主エージェントが確認）。

先行調査 `docs/research/code-for-ibmi.md`（Code for IBM i の編集支援・CL プロンプター比較）を
前提とし、本書は「ワークフロー設計」の観点で不足を埋める。

## 調査の問い

- Q1: Code for IBM i の機能のうち、AI エージェントが別経路で叩けるものは何か
- Q2: ソースメンバー送受信（双方向・CCSID・ソース日付）の経路は何か
- Q3: as400-web-emulator の MCP ツールと E2E の到達点はどこか
- Q4: IBM の無料検証環境はあるか
- Q5: RPGUnit / IBM のテスト拡張の現状と AI からの利用可否
- Q6: Db2 for i へ繋ぐ MCP の既存実装はあるか
- Q7: 固定長 RPG/CL/DDS のリンター既存資産はあるか
- Q8: AI 自律ループ（編集→転送→コンパイル→エラー取得→修正）の実機経路は成立するか
- Q9: aidev ハーネスと本ワークフローの役割分担はどうなるか

## 判明した事実

### F1: Code for IBM i の実行系は全部「ssh + CL + SQL」で、AI から同じことができる（Q1, Q8）

`codefori/vscode-ibmi` の `src/api/` を直読して確認した。UI に閉じているのは編集体験だけで、
実行系はすべてサーバー側プリミティブの呼び出しに過ぎない:

| 機能 | 内部実装（根拠） |
|---|---|
| メンバー受信 | `CPYTOSTMF` + CCSID 2 段変換（`IBMiContent.ts:168-226`） |
| メンバー送信 | `CPYFRMSTMF` + 同様（`IBMiContent.ts:272-335`） |
| コンパイル | ssh 上で `liblist -d/-c/-a` → `system` 実行（`CompileTools.ts:188-197`） |
| エラー取得 | SQL で EVFEVENT メンバーを SELECT（`ui/diagnostics.ts:66-69`） |
| エラー解析 | npm `@ibm/ibmi-eventf-parser`（**IBM 公式・Apache-2.0・v2.0.3**） |
| SQL 実行 | npm `@ibm/mapepire-js`（IBM 公式。サーバーコンポーネント要） |
| スプール | `QSYS2.SPOOLED_FILE_INFO` / `SYSTOOLS`（`CompileTools.ts:148-164`） |

**含意**: AI エージェントに Code for IBM i を「使わせる」必要はない。同じ ssh/SQL 経路を
直接叩けばよく、鍵となる部品（EVFEVENT パーサー・SQL クライアント）は IBM 自身が
npm で単体配布している。本 PJ は ssh + `system` + `CPYFRMSTMF` の経路を pub400 で
実証済み（`docs/src/CHECKLIST.md`、`docs/origin/probe-rpg3-opcodes.sh`）。

### F2: メンバー送受信の CCSID レシピは vscode-ibmi の実装がそのまま参考になる（Q2）

- 受信: `CPYTOSTMF FROMMBR TOSTMF STMFCCSID(1208) DBFCCSID(<sourceFileCCSID>)`。
  非 UTF-8 環境では QTEMP 経由 + `CPY TOCCSID(1208)` の 2 段変換。
- 送信: 逆向きに `CPYFRMSTMF` + `CHGATR *CCSID`。
- ソース日付: Code for IBM i は**既定で保持しない**（有効化するとシーケンス番号が
  再採番される警告あり。公式 docs sourcedates ページ）。メンバーロックも無い。
- 本 PJ の実績（送りのみ）と同型で、受信側の型もこれで取れた。

### F3: as400-web-emulator は「画面の E2E」は実用水準、「画面の外」が未配線（Q3）

委譲調査（ソース直読）による。MCP ツールは **19 個**（`packages/server/src/mcp-tools.ts`）:

- セッション: `open_session` / `signon` / `close_session` / `list_sessions` /
  `list_systems` / `list_session_configs`
- 画面: `get_screen`（テキスト＋構造化: fields/cursor/gui）/ `wait_screen` /
  `set_fields`（index または row,col 指定）/ `send_key`（Enter, F1-F24 等）/
  `run_steps`（最大 20 手順、expect 付き）/ `get_job_info` /
  `select_gui_choice` / `submit_gui_selection`
- スプール: `open_printer_session` / `wait_spool` / `list_spools` / `get_spool` /
  `get_spool_pdf`

E2E は 2 層: オフライン回帰（実機トレースのリプレイ、vitest）＋実機 E2E スクリプト 24 本
（`verify-mcp.mjs` は MCP サーバーを実起動して MCP クライアントから検証）。
認証は環境変数（`passwordEnv`）で CI/headless 適性あり。MCP 引数に資格情報は取らない設計。

**足りないもの**（同調査の結論。部品は core に実装済み・未配線）:

1. **SQL が MCP から叩けない**: database ホストサーバーのクライアント
   （`DbConnection.query()`）は core に完成・実機確認済みだが MCP 未公開
   （backlog `hostserver.md` の「MCP ツールとして公開」が未チェック）
2. **任意 CL 実行・IFS 書き込みが未露出**: `CommandConnection` / `IfsConnection` は
   core にあるが REST は固定 4 操作のみ。ソース投入・コンパイルは画面経由になり脆い
3. **既存スプールの読み取りが未配線**: Network Print 経由の `listSpooledFiles` /
   `readSpooledText` は実装済み・未使用。TN5250E 方式は OUTQ 誘導と CPA3394 の壁がある
4. テストハーネスは「コピーして書き足す」雛形止まり（DSL・レポーター無し）
5. MCP 応答にセル属性（色・反転）が無い（core の `snapshot().cells` にはある）
6. 待機条件がテキスト一致のみ
7. CI ワークフローが無い（`.github/` 自体が無い）

### F8: AI 自律ループは既存実証＋F1 の部品で成立する（Q8）

ループの各段が既に個別実証済み:
編集（ローカル）→ 送信（`CPYFRMSTMF`・実証済み）→ コンパイル（`system "CRTxxx ... OPTION(*EVENTF)"`・
実証済み）→ エラー取得（EVFEVENT を SQL で SELECT・vscode-ibmi と同じ経路）→
解析（`@ibm/ibmi-eventf-parser`）→ 修正。
未実証なのは「EVFEVENT の SQL 取得」と「eventf-parser の実出力への適用」のみ
（pub400 が調査時点で到達不可のため。復旧後に確認する）。

### F9: aidev ハーネスとの関係（Q9）

- aidev は**プロセス（工程・承認・記録）**の枠組みで、言語・環境に依存しない。
- 本ワークフローは **IBM i 固有の実行手段**（転送・コンパイル・テスト・E2E）の設計。
- 役割分担は「aidev の coding/test 工程の**中で使う道具**を本設計が定義する」。
  すなわち aidev はそのまま使い、test 工程の実体が RPGUnit/E2E/コンパイル検証になる。
  ハーネス側の変更は不要（PJ 資産優先の規約 protocol「2.5」がそのまま効く）。

### F4: IBM の無料検証環境は「期間限定トライアル」と「コミュニティ」のみ（Q4）

委譲調査（出典 URL 付き）による。**無条件の恒久無償環境は無い**。

- **Power Virtual Server トライアル**: プロモコード `POWERVS2500` で **$2,500 クレジット・
  最大 90 日**。IBM i ワークロードを明示的に対象に含む。新規 PowerVS 顧客のみ、
  プロモは 2026-12-31 まで（IBM Community ブログ 2026-01-13）
- **Merlin トライアル**: 一次情報を確認できず（不明）
- **Partner Plus (ISV)**: 「開発・テスト用の無償/割引アクセス」の記載はあるが
  対象ページが 403 で条件未確認（不明）
- **コミュニティ**: pub400.com（RZKH 運営、IBM i 7.5、300MB）が引き続き実質の選択肢

**含意**: 恒久環境は pub400 前提のまま。負荷の大きい検証（大量コンパイル等）を
まとめて行う時期だけ PowerVS トライアルを使う、という使い分けが現実的。

### F5: RPGUnit は固定長 ILE で書け、CLI（= AI）から実行できる（Q5）

- **RPGUnit**: `tools-400/irpgunit`、**v6.0.0.r (2026-01-25)** と活発。実機に RPGUNIT
  ライブラリを導入。テストは「`test` で始まる名前のエクスポート・プロシージャー」で、
  公式チュートリアルに**固定位置形式の例あり**。コンパイル `RUCRTRPG`・実行 `RUCALLTST`
  は CL コマンドなので ssh から叩ける
- **制限**: ILE RPG 前提。**RPG III のテストは書けない**（サブプロシージャーが無い）
- **IBM 公式 VS Code 拡張** `IBM.vscode-ibmi-testing`（v1.3.4, 2026-06）: エンジンは
  RPGUnit。テストスタブ生成・コードカバレッジ（5770WDS の CODECOV 要）
- **AI からの経路**: コンパニオン CLI **`@ibm/itest`**（npm）が **VS Code なしで**
  SSH 実行できる（`IBMI_HOST`/`IBMI_USER`/`IBMI_PASSWORD` 環境変数、CI/CD 用途明示）。
  エージェントは Bash で `itest` を叩けばよい

### F6: Db2 for i への MCP は「内製が既にあり」、選択肢は 3 つ（Q6）

**内製（ユーザー提供情報。README 全文を受領）**:

- **MCP DB2 Server**（内製・Java 17 + Spring Boot 3.5 + Spring AI MCP + **jt400** + JSqlParser）。
  SSE トランスポートで複数 MCP クライアントから同時接続可。ツールは `list_tables` /
  `list_table_fields` / `execute_select_query` の 3 つ。**現状 SELECT のみ**
  （JSqlParser の構文解析＋Statement 型チェック＋ブロックリストの多層検証、最大 1000 行）。
  **INSERT/UPDATE を許せばテストデータ作成に使える**（ユーザー自身の評価）
- **as400-web-emulator core に jt400 相当の純 TS 実装がある**（ユーザー提供情報。
  F3 で確認した database ホストサーバークライアント `DbConnection.query()` がそれ。
  **Java 環境を作らない形にも対応できる**）

**外部**:

- **IBM 公式 `IBM/ibmi-mcp-server`**（Apache-2.0、npm、Stable 表記）: YAML で SQL ツールを
  定義。ただし **mapepire 必須**（IBM i 側にサーバーコンポーネント導入、ポート 8076）
- コミュニティ: db2i-mcp-server（SELECT のみ）、5250 では **5250ng**（GPL v3、24 ツール）、
  メンバー操作＋コンパイルの `FanMnz/ibmi-mcp-server`（成熟度未確認）等

**比較の要点**: 内製 2 経路（jt400 / TS core）はどちらも **IBM i 標準のホストサーバーに
直接繋がるため、実機側への導入物が無い**。mapepire の pub400 導入可否という不確定要素を
回避できる。IBM 公式は YAML ツール定義の設計が優れるが導入前提が重い。
選定（Java 内製の書き込み拡張 / TS core の MCP 配線 / IBM 公式）は spec で行う。

- **未確認のまま残るもの**: pub400 一般ユーザー権限での RPGUnit 導入可否
  （mapepire は内製経路なら不要になった）

### F7: 固定長のリンターは OSS に存在しない。ただし部品と代替は揃っている（Q7）

委譲調査（実装直読＋本 PJ 内の原典キャッシュとの照合）による。

- **vscode-rpgle のリンターは `**FREE` 限定が実装で確定**
  （`providers/linter/index.ts:191` が先頭 6 文字 `**FREE` を要求）。31 ルールあるが
  固定長には一切効かない。ただし**パーサー自体は固定長を解析する**（固定長で
  Peek/References が動く）ので、固定長ルールの土台には使える（MIT）
- **固定長対応の静的解析は商用のみ**: ARCAD CodeChecker（RPG III 含む固定長対応を
  謳う唯一の製品）、SonarQube RPG（RPG IV のみ・Enterprise）。
  **OSS の固定長 RPG リンター・DDS リンターは見つからなかった**
- **CL**: vscode-clle の checkDocument は**接続先の QCAPCMD API を UDTF 経由で呼ぶ**
  リモート構文検査（構文のみ、スタイル検査なし、要接続）。C++ ソースごと
  Apache-2.0 で再利用可
- **コンパイラ＝リンターの公式手段**（本 PJ の原典キャッシュで照合済み）:
  - RPG（ILE/III）・CL: `OPTION(*NOGEN)` = オブジェクトを作らず構文検査
  - ILE RPG・DDS: `OPTION(*EVENTF)` でイベントファイル出力
  - **DDS には *NOGEN が無い**（QTEMP への実コンパイルで代替するしかない）
  - EVFEVENT の形式は公開されており、IBM 公式パーサー（npm）がある（F1 と同じ）
- **本 PJ の資産が「外部に存在しない固定長ルールベース」になっている**:
  原典から生成した桁定義（`keywordColumns` / DDS 桁定義）・キーワード使用レベル
  （file/record/field）・実機検証済み RPG III 命令集合（`rpg3-opcodes-on-ibmi.json`）は、
  桁レベルの lint を書ける唯一の機械可読データ。特に DDS は外部にリンターが皆無

**含意**: リンターは 2 層になる。**ローカル層**（本 PJ の桁定義による桁・キーワード検査。
オフライン・即時）＋**実機層**（*NOGEN / QCAPCMD / *EVENTF による OS 純正検査。
接続時のみ・確定的）。この 2 層は競合せず補完する。

## 影響範囲

- 本ワークスペース: エージェント向け CLI（転送・コンパイル・エラー整形）を足す場合、
  `vscode-extension/` とは独立のパッケージにできる（VS Code 非依存の資産として）
- as400-web-emulator: MCP への SQL/CL/IFS 配線は同リポジトリの backlog に既載
- AGENTS.md: pub400 負荷配慮・資格情報の扱いの既存規約が本ワークフローにも適用される

## 実現性 / リスク

- **自律ループ**: 成立見込み高（F1/F8）。残る未実証は pub400 復旧待ちの 2 点のみ
- **pub400 が単一障害点**: 調査中も到達不可だった。無料の代替環境（Q4）の結論が重要
- **共用機制約**: コンパイル・テストの繰り返しは自ライブラリ内で完結させる。
  デバイス名衝突・オブジェクトロックは as400-web-emulator の E2E 作法に既知の対処あり

## spec への申し送り

- AI の実行経路は「ssh + CL + SQL 直」を第一級とし、Code for IBM i との共存は
  「人間は UI、AI は同じプリミティブを直接」という分担で設計する
- メンバー送受信は vscode-ibmi の CCSID レシピを採用。ソース日付は既定で保持しない
  （Code for IBM i と同じ割り切り）を提案
- E2E は as400-web-emulator の MCP をそのまま使い、不足（SQL/CL 配線）は
  同リポジトリ側のバックログとして扱う（本ワークスペースに二重実装しない）
- テストは 3 層で設計する: ユニット（RPGUnit + `@ibm/itest`。ILE のみ、RPG III 対象外）
  ／ データ検証（Db2 MCP または SQL 直）／ E2E（as400-web-emulator MCP）
- Db2 経路の選定は 3 択（内製 Java MCP の書き込み拡張 / as400-web-emulator TS core の
  MCP 配線 / IBM 公式 ibmi-mcp-server）。内製 2 経路は実機側導入物ゼロが強み。
  テストデータ作成には書き込み許可の設計（許可 SQL の種類・対象スキーマの制限）が要る
- リンターは「ローカル層（本 PJ 桁定義）＋実機層（*NOGEN/QCAPCMD/*EVENTF）」の
  2 層で設計する。DDS のローカル検査は世に無いので本 PJ の資産が唯一の材料
- 実機依存の検証手段（mapepire・RPGUnit の pub400 導入可否、EVFEVENT の SQL 取得）は
  未確認のまま。spec ではこれらを「前提」でなく「確認タスク」として backlog に含める
- 恒久無償環境は無い。pub400 を既定、負荷の大きい検証期だけ PowerVS トライアル
  （$2,500/90 日、2026-12-31 まで申請可）という使い分けを設計に織り込む
