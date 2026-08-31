# タスク: テスト対象のバインド

- [x] T1: 実例 3 本（`CALCPR` / `CALCSRV` / `CALCTST`）を書き、対象を実機でビルドする
      対象: `tools/example/` / 根拠: research F1, F2
- [x] T2: `--bnd` の解析と `BNDSRVPGM` の組み立て（`library/name` を保つ）（依存: T1）
      対象: `tools/run-rpgunit.mjs` `parseArgs` / `SBMJOB CMD(RPGUNIT/RUCRTRPG …)` / 根拠: research F3
- [x] T3: `SBMJOB` の成否を確認して落ちた理由を出す（ビルド・実行の両方）
      対象: 同上 / 根拠: spec「設計方針 3」
- [x] T4: `--self-test` に 5 件追加（依存: T2）
      対象: 同上 `selfTest` / 根拠: AC6
- [x] T5: 実機でバインドして緑を確認（依存: T2, T3）
      対象: SR-OSAKA / 根拠: AC1, AC2
- [x] T6: **対象を壊して落ちることを確認**し、戻して緑に復帰（依存: T5）
      対象: SR-OSAKA / 根拠: **AC3**（plan「リスク」の本体）
- [x] T7: `tools/example/README.md`・`tools/README.md`・skill を書く（依存: T6）
      対象: `tools/example/README.md` / `tools/README.md` / `.claude/skills/rpgunit-test/SKILL.md`
