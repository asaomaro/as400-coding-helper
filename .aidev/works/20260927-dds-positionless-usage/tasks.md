# タスク: 使用を H / P / M にしたら位置欄を空ける

## タスク
- [x] T1: `setAttributes` で位置の持てない使用なら 39-44 桁を空け、2 次画面の上書き行を消す。単体テストと実機。
      対象: `vscode-extension/src/core/dds/ddsEdit.ts` / `test/unit/ddsEdit.test.ts` / `verify/`
      依存: なし
      AC: AC1, AC2, AC3
