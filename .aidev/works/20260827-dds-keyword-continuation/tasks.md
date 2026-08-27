# タスク: キーワード欄の継続行を実機どおりに読む

- [x] T1: `joinContinuations`（継続の判定と結合）
      対象: `vscode-extension/src/core/dds/ddsLogicalUnits.ts:137` / 根拠: research A1, F1
- [x] T2: `toLogicalUnits` を結合結果の上で動かす（`sourceLines` に継続行を含める）（依存: T1）
      対象: 同上 / 根拠: research F5
- [x] T3: 継続にまたがるキーワード欄の書き換えを拒否（依存: T2）
      対象: `vscode-extension/src/core/dds/ddsEdit.ts` / 根拠: research A3
- [x] T4: 単体テスト（期待値は実機の実測値）（依存: T1-T3）
      対象: `vscode-extension/test/unit/ddsContinuation.test.ts`（新規）
- [x] T5: 実機との突き合わせスクリプトを残す（依存: T4）
      対象: `.aidev/works/20260827-dds-keyword-continuation/verify/`
- [x] T6: 記録（backlog・`ibmi-remote` skill の DBCS 未確認事項の解消・設計文書）（依存: 全部）
      対象: `.aidev/backlog/dds.md` / `.claude/skills/ibmi-remote/SKILL.md`
