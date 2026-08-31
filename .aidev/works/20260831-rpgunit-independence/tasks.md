# タスク

- [x] T1: `--order` / `--rclrsc` / `--check-independence` の解析
      対象: `tools/run-rpgunit.mjs` `parseArgs`
- [x] T2: 実行部を `runOnce` に関数化（依存: T1）
      対象: 同上
- [x] T3: `compareRuns`（合否だけ比較）（依存: T2）
      対象: 同上
- [x] T4: `--self-test` に 8 件追加（依存: T3）
      対象: 同上 `selfTest`
- [x] T5: **実機で発火を確認**（独立＝一致 / 順序依存＝検出）（依存: T3）
      対象: SR-OSAKA
- [x] T6: skill と `tools/README.md`（依存: T5）
      対象: `.claude/skills/rpgunit-test/SKILL.md` / `tools/README.md`
