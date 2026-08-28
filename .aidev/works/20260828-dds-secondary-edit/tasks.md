# タスク: 2 次画面サイズでの編集

- [x] T1: `unitRunEnd` を足す（単位が占める最後の行）
      対象: `vscode-extension/src/core/dds/ddsLogicalUnits.ts` / 根拠: research A3 の周辺
- [x] T2: `conditionNameFor` を足す（2 次に書く条件名）
      対象: `vscode-extension/src/core/dds/dspfScreenSize.ts:37` / 根拠: research A6
- [x] T3: `move.screenSize` と `clearAlternatePosition` を型に足す（依存: なし）
      対象: `vscode-extension/src/core/dds/ddsEdit.ts:69` / 根拠: research A1
- [x] T4: 検証（`screen-size-not-declared` / `screen-size-not-editable` /
      `alternate-position-not-found`）（依存: T2, T3）
      対象: `vscode-extension/src/core/dds/ddsEdit.ts:297` / 根拠: research A2
- [x] T5: 適用（既存を置換 / 無ければ挿入 / 削除）（依存: T1, T3, T4）
      対象: `vscode-extension/src/core/dds/ddsEdit.ts:376` / 根拠: research A1
- [x] T6: UI（掴む・矢印・Delete・resize を塞ぐ）（依存: T5）
      対象: `vscode-extension/src/dds/webview/ui.ts:1684` / 根拠: research A4
- [x] T7: プロトコルの受け渡し（依存: T3）
      対象: `vscode-extension/src/dds/webview/protocol.ts` / 根拠: research 影響範囲
- [x] T8: 単体テスト（AC1-AC5）（依存: T5）
      対象: `vscode-extension/test/unit/ddsSecondaryEdit.test.ts` （新規作成）
- [x] T9: e2e（依存: T6）
      対象: `vscode-extension/dev/e2e.mjs` / 根拠: research 影響範囲
