# 棚卸し結果（2026-08-29）

リポジトリ: `/workspaces/ts5250`（旧 `as400-web-emulator`）。
`git remote`: `https://github.com/asaomaro/ts5250.git`。

## 3 件とも配線済み

| backlog の項目 | 実体 | 場所 |
|---|---|---|
| SQL ツール | `host_sql` | `packages/server/src/host-server-tools.ts:144` |
| 任意 CL 実行 | `host_command` | 同 `:624` |
| IFS 書き込み / 読み取り | `host_write_file` / `host_read_file` | 同 `:774` / `:745` |
| 既存スプール読み取り | `host_list_spools` / `host_get_spool` | 同 `:660` / `:697` |

**MCP に実際に公開されている。** `packages/server/src/mcp-server.ts:14` が
`registerHostServerTools(server, deps)` を呼び、`host-server-tools.ts:129` の
`registerHostServerTools` が上記を `server.registerTool` している。
**定義があるだけでなく到達可能**（AGENTS.md「追加したリソースは到達可能になって初めて完了」）。

**登録されている `host_*` は 24 個**——起票時の想定より広い:
`host_call_program` / `host_call_service_program` / `host_command` / `host_dtaq_attributes` /
`host_dtaq_clear` / `host_dtaq_create` / `host_dtaq_delete` / `host_dtaq_receive` /
`host_dtaq_send` / `host_get_spool` / `host_list_jobs` / `host_list_messages` /
`host_list_objects` / `host_list_spools` / `host_list_users` / `host_plan_list` /
`host_read_file` / `host_remove_messages` / `host_reply_message` / `host_send_message` /
`host_sql` / `host_sql_explain` / `host_upload_table` / `host_write_file`

**スプール読み取りはこの一連の作業で実際に使っている**——DDS の実機検証で
コンパイル・リストを読むのに `readSpooledPages` 経路を回した。

## 満たしていない受け入れ条件が 1 つある

SQL の項目は「書き込みは**対象スキーマ検証付き**（設計書 6 章 #1）」を求めている。
実装は**スキーマ検証ではなく `allowWrite: true` の明示**で、
**コードに理由が書いてある**（`host-server-tools.ts` の `allowWrite` の JSDoc）:

> ⚠ **これは安全の境界ではない。** `host_command` から `RUNSQL` を撃てば同じことが
> できるので、SELECT 専用に縛っても書き込みは止まらない。**意図を毎回述べさせる**
> ためのもので、「SELECT のつもりで打った文が更新だった」を防ぐ。

**設計書 6 章 #1 の前提が成り立たないことを示している。**
「MCP の SQL ツール側でスキーマ検証を実装する」だけでは、同じ MCP の別ツールから
迂回できる。**どこに境界を置くかは設計の判断**なので、残件として分けた。

## 受け入れ基準

| AC | 結果 |
|---|---|
| AC1 ファイルと行番号 | ✓ |
| AC2 MCP に公開されている（登録経路まで） | ✓ `mcp-server.ts:14` → `registerHostServerTools` |
| AC3 満たしていない部分を残件に | ✓ 「書き込みの安全境界をどこに置くか決める」を起票 |
| AC4 リポジトリ名の変更を反映 | ✓ `(repo:ts5250)` に書き換え |
