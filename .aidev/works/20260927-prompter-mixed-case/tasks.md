# タスク: 英大文字だけに縛っている欄を実機に合わせる

## タスク
- [x] T1: DDS の生成スクリプトでキーワード欄に `characterSet` を付けない。ILE RPG の名前欄から外す（英語版は生成し直す）。単体テストと実機。
      対象: `docs/origin/generate-dds-prompter.mjs` / `resources/prompter/{dds,rpg/ile}/**` / `test/unit/prompterRegressions.test.ts` / `verify/`
      依存: なし
      AC: AC1, AC2, AC3
