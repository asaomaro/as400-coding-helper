# タスク: 表示切替（SO/SI・属性バイト・グリッド・他様式・ズーム）

- [x] T1: 区切りに SO/SI の種別を足す。`RenderSegment.shift?: "so" | "si"`。**幅は変えない**（既に桁は空けてある）
      対象: `vscode-extension/src/core/dds/dspfRenderModel.ts:26`（型）`:129`（`constantSegments`） / 根拠: spec D1, `research.md` F2
- [x] T2: core のテストを足す。DBCS の前後が `so` / `si` になる／半角だけなら種別が付かない／**`cols` の合計は `printWidth` と一致したまま**（依存: T1）
      対象: `vscode-extension/test/unit/dspfRenderModel.test.ts` / 根拠: AC1・AC2
- [x] T3: 表示状態を持ち、**実測値と表示値を分ける**。`DisplayOptions` を `render()` の外に置き、`--cell-w` には**実測 × 倍率**を入れる。`geometry` に渡す `metrics` も倍率込みにする
      対象: `vscode-extension/src/dds/webview/ui.ts:154`（`measure`）・`cellMetrics()` / 根拠: spec D2・D4, 本 plan R2・R6
- [x] T4: SO/SI を描く。**区切りの中に**`{` `}` を出す（既存の SOSI 表示と同じ記号）。**項目の幅と位置は変えない**（依存: T1, T3）
      対象: `vscode-extension/src/dds/webview/ui.ts`（`buildItem`）・`ui.css` / 根拠: spec D1, `research.md` F1, 本 plan R1
- [x] T5: 属性バイト・グリッド・他様式の淡色表示を切り替えられるようにする。淡さは `opacity: 0.35`（**読めなくなると意味が無い**）。アクティブ様式は**選択から導く**（依存: T3）
      対象: `vscode-extension/src/dds/webview/ui.ts`（`renderItems` / `attributeMarkers`）・`ui.css`（`.dds-attr` / `.dds-canvas`） / 根拠: spec D5, 本 plan R4
- [x] T6: ズームを足す（90 / 100 / 125 / 150%）。**キーボードショートカットは張らない**（ホストのズームと取り合わない）（依存: T3）
      対象: `vscode-extension/src/dds/webview/ui.ts` / 根拠: spec D3, `docs/design/dds-designer/README.md` の未解決 5
- [x] T7: ツールバーを整える。**配置（置く）と表示（切替）を区切り線で分ける**。入っている切替は押下状態で分かるようにし、`Tab` で辿れる `<button>` にする。**「スナップ」は作らない**（相手が存在しないため）（依存: T4, T5, T6）
      対象: `vscode-extension/src/dds/webview/ui.ts`（`template`）・`ui.css` / 根拠: spec D7, AC-I1・AC-I3, 本 plan R5
- [x] T8: 桁勘定をプロパティに出す。選択中の**定数**について `SO 1 + 全角 4×2 + SI 1 = 10 桁` の形。**区切りを数えるだけ**（文字を数え直さない）（依存: T7）
      対象: `vscode-extension/src/dds/webview/ui.ts`（`renderProperties`） / 根拠: spec D6, AC2
- [x] T9: e2e と全体検証。**切替で項目の位置と幅が変わらないこと**／150% でドラッグが指した桁に入ること／**編集の適用後も切替が保たれること**を実操作で確かめ、`npm test` / `npm run verify` / 桁位置 lint を通す（依存: T8）
      対象: `vscode-extension/dev/e2e.mjs` / 根拠: AC1・AC5・AC7・AC8・AC-I5, 本 plan「テスト方針」
