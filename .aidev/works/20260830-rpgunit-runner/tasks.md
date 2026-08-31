# タスク: RPGUnit ランナー

- [x] T1: 骨格と純粋な部分。`parseArgs` / `summarize` / `--self-test`
      対象: `tools/run-rpgunit.mjs`（新規）/ 根拠: spec「設計方針 1」
- [x] T2: 前提の確認（ts5250・環境変数）と接続の型（依存: T1）
      対象: 同上 / 根拠: research F2・A1（`ibmi-remote` 6.1 の型を写す）
- [x] T3: 転送（IFS → `CPYFRMSTMF` → `CHGPFM SRCTYPE`）。`CRTSRCPF` は無ければ作る（依存: T2）
      対象: 同上 / 根拠: research F1
- [x] T4: ビルド。`SBMJOB RUCRTRPG` ＋ 完了待ち ＋ 失敗時にスプール名とジョブ名（依存: T3）
      対象: 同上 / 根拠: spec「エラー処理」AC8・research F4/F5
- [x] T5: 実行と XML 取得。`RUCALLTST OUTPUT(*NONE) XMLSTMF` ＋ 完了待ち（依存: T4）
      対象: 同上 / 根拠: research F1
- [x] T6: 表示・`--xml` 保存・終了コード（0/1/2）・`finally` で後始末（依存: T5）
      対象: 同上 / 根拠: spec「振る舞いの詳細」
- [x] T7: `tools/README.md`（前提・使い方・CI での使い方・既知の制約）（依存: T6）
      対象: `tools/README.md`（新規）
- [x] T8: skill `rpgunit-test` から案内する（「毎回書く」前提を改める）（依存: T7）
      対象: `.claude/skills/rpgunit-test/SKILL.md`
- [x] T9: 実機で通し確認 5 通り（合格のみ / 失敗あり / SQLRPGLE / ビルド失敗 / `--xml`）
      ＋ IFS の残留とジョブの残留を確認（依存: T6）
      対象: SR-OSAKA / 根拠: plan「テスト方針」
