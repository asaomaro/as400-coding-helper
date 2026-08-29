# タスク: MCP 配線 3 件の棚卸し

- [x] T1: ts5250 で `host_sql` / `host_command` / `host_write_file` / `host_read_file` /
      `host_list_spools` / `host_get_spool` の実体を探す。
      対象: `/workspaces/ts5250/packages/server/src/host-server-tools.ts` / 根拠: spec D1
- [x] T2: MCP への登録経路を辿る。
      対象: `/workspaces/ts5250/packages/server/src/mcp-server.ts:14` / 根拠: spec D1
- [x] T3: 受け入れ条件（SQL の「対象スキーマ検証」）と照らす。
      対象: `host-server-tools.ts` の `allowWrite` の JSDoc / 根拠: spec D2
- [x] T4: backlog を更新（3 件消し込み・リポジトリ名・残件 1 件）。
      対象: `.aidev/backlog/workflow.md` / 根拠: AC3 AC4
