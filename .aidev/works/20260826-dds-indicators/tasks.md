# タスク: 条件標識の解決と標識パネル

- [x] T1: 条件の畳み込み・評価・表示文字列を足す（`conditionGroups` / `evaluateConditioning` / `describeConditioning`）
      対象: `vscode-extension/src/core/dds/ddsConditioning.ts:97`（`readConditioning` の直後）/ 根拠: research A1
- [x] T2: 標識の列挙を足す（`collectIndicators` / `IndicatorUsage`）
      対象: `vscode-extension/src/core/dds/ddsConditioning.ts`（新規関数）/ 根拠: research A2, F3
- [x] T3: 描画モデルに条件と標識一覧を載せる（依存: T1, T2）
      対象: `vscode-extension/src/core/dds/dspfRenderModel.ts:107` `toRenderItem` / `:80` `buildDspfRenderModel` / 根拠: research A3, A4
- [x] T4: `HiddenReason` に `condition-off` を足す
      対象: `vscode-extension/src/core/dds/dspfOutline.ts:42` / 根拠: research A6
- [x] T5: `applyIndicators` を足す（絞り込み・ツリーの理由・状態つき重なり）（依存: T1, T3, T4）
      対象: `vscode-extension/src/core/dds/dspfRenderModel.ts`（新規関数）/ 根拠: research A5
- [x] T6: 左ペインに標識カードを足す（ラジオグループ・矢印キー・すべて未設定）（依存: T3）
      対象: `vscode-extension/src/dds/webview/ui.ts:1027` `template()` / `renderOutline` の隣 / 根拠: research A7, A8
- [x] T7: 状態を描画に反映する（`applyIndicators` を通す・`describeHidden`・プロパティの条件行）（依存: T5, T6）
      対象: `vscode-extension/src/dds/webview/ui.ts:1074` `describeHidden` / `render()` / `renderProperties`
- [x] T8: 標識カードの見た目（依存: T6）
      対象: `vscode-extension/src/dds/webview/ui.css`
- [x] T9: 単体テスト（畳み込み表・3 値真理値表・列挙・`applyIndicators`）（依存: T1-T5）
      対象: `vscode-extension/test/unit/ddsConditioning.test.ts`（新規）/ `test/unit/dspfRenderModel.test.ts`
- [x] T10: GUI e2e を足す（消える・戻る・キーが漏れない・フォーカスが残る）（依存: T7, T8）
      対象: `vscode-extension/dev/e2e.mjs` / `vscode-extension/dev/` の題材 DSPF
- [x] T11: 記録（設計文書の実装状況・未解決、backlog の消し込みと分割）（依存: 全部）
      対象: `docs/design/dds-designer/README.md` / `.aidev/backlog/dds.md:47`
