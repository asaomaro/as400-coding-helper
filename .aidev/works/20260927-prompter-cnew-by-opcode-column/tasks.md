# タスク: C 仕様の新旧の判定を 26-35 桁の命令で行う

## タスク
- [x] T1: `classifyCSpec` を 26-35 桁の命令（演算拡張を除く）で判定する。C-NEW の定義に条件標識を足す（英語版・原典照合も）。単体テストと実機。
      対象: `vscode-extension/src/core/rpgSpec.ts` / `resources/prompter/rpg/ile/*/C-NEW.json` / `docs/origin/{rpg-spec-en-strings.json,verify-rpg-definitions.mjs}` / テスト
      依存: なし
      AC: AC1, AC2, AC3, AC4
