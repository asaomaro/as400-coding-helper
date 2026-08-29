# タスク: RPGUnit の pub400 導入可否を確かめる

- [x] T1: pub400 の特殊権限と復元系（`RSTLIB` / `RSTOBJ`）を測る。
      対象: `verify/probe-authority.mjs` / 根拠: spec D1
- [x] T2: 代替経路（`CRTLIB` / `CRTBNDRPG` 等のビルド系）を測る。
      対象: `verify/probe-build-commands.mjs` / 根拠: spec D1
- [x] T3: SR-OSAKA で同じ probe を回して対比する。
      対象: 同じ 2 本（接続先を差し替え）/ 根拠: spec D2
- [x] T4: 結果を記録し、backlog の依存項目の前提を書き換える。
      対象: `verify/results.md` / `.aidev/backlog/workflow.md` / 根拠: AC4
