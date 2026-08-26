# タスク: 属性編集（L2）とプロパティ／様式ツリー

- [x] T1: 属性欄の書き戻しを足す。名前（19-28・**大文字化**）／型（35）／小数桁（36-37・右詰め）／使用（38）。既存の `writeBackLength` と同じ流儀（該当桁だけ・行末の空白を落とす）
      対象: `vscode-extension/src/core/dds/ddsEditWriteBack.ts` / 参照: `ddsPositionWriteBack.ts`・`src/core/ddsLayout.ts:14`（`DDS_COLUMNS`） / 根拠: spec D1
- [x] T2: 定数リテラルの差し替えを足す。**先頭のリテラルだけ**を置換し、後続のキーワードをそのまま繋ぐ。`readConstant` と**同じ正規表現**を使い、規則を 2 か所に書かない
      対象: `vscode-extension/src/core/dds/ddsLogicalUnits.ts:70`（`readConstant` の隣に `replaceLeadingConstant`） / 根拠: spec D2, `research.md` F1, 本 plan R1
- [x] T3: `setAttributes` を足す（型・検証・適用）。**与えた欄だけ**書き換える。拒否コードを 5 種追加（名前 10 桁超・小数桁 2 桁超・定数に定位置欄・フィールドにリテラル・100 桁超）（依存: T1, T2）
      対象: `vscode-extension/src/core/dds/ddsEdit.ts:29`（型）`:74`（検証）`:126`（適用） / 根拠: spec D1・「拒否コード」表
- [x] T4: core のテストを書く。属性の書き戻し／**定数の後続キーワードが残ること**／拒否 5 種／**対象行以外がバイト不変**（依存: T3）
      対象: `vscode-extension/test/unit/ddsAttributeEdit.test.ts`（新規） / 根拠: 本 plan「テスト方針」, AC6・AC7
- [x] T5: `decimals`（36-37）と `keywords`（45 桁〜の生テキスト）を `DspfPlacedItem` に公開する。`keywords` は `toLogicalUnits` が既に持っているので**渡すだけ**
      対象: `vscode-extension/src/core/dds/dspfLayout.ts:70`（型）`:281` 付近（組み立て） / 根拠: `research.md` F2
- [x] T6: **配置に依らない項目一覧**を作る。**出所は `toLogicalUnits`**（`layout.items` から作らない——位置欄が空・画面外・非表示用途の項目が落ちるため）。描かれない理由を `hidden` に持たせる（依存: T5）
      対象: `vscode-extension/src/core/dds/dspfOutline.ts`（新規） / 参照: `dspfLayout.ts:220`（非表示用途の除外）`:267`（位置なしの除外） / 根拠: spec D3, `research.md` F3, 本 plan R2
- [x] T7: 描画モデルに `outline` を載せ、`RenderItem` に属性（`ItemAttributes`）を持たせる（依存: T6）
      対象: `vscode-extension/src/core/dds/dspfRenderModel.ts:62` / 根拠: spec D3
- [x] T8: 一覧のテストを書く。**位置欄が空・画面外・非表示用途の項目が出ること**／様式ごとに並ぶこと／`sourceLine` が `items` と対応すること（依存: T7）
      対象: `vscode-extension/test/unit/dspfOutline.test.ts`（新規） / 根拠: AC3・AC5, 本 plan R2
- [x] T9: 3 ペインのシェルを作る（左 200px / 中央 / 右 320px）。**ホスト切替 UI は作らない**。既存のキャンバスを中央に収める（依存: T4, T8）
      対象: `vscode-extension/src/dds/webview/ui.ts:57` 付近（`template`）・`ui.css` / 根拠: spec D5, `docs/design/dds-designer/README.md`
- [x] T10: 右ペイン（プロパティ）を作る。名前・型・長さ・小数・使用／定数の文字列／**占有と右端の余裕**（引き算だけ）／キーワードは読み取り専用／**名前は追随しない旨の注意書き**。確定は `Enter`・フォーカス喪失、`Esc` で戻す。**拒否時はその欄にフォーカスを留める**（依存: T9）
      対象: `vscode-extension/src/dds/webview/ui.ts` / 根拠: spec D4・D6・D8, AC4・AC-I2・AC-I4
- [x] T11: 左ペイン（様式ツリー）を作る。様式ごとに項目を並べ、**描かれない項目も出す**（理由つき）。上下キーで選べる。選択はキャンバス・プロパティと同期（依存: T9）
      対象: `vscode-extension/src/dds/webview/ui.ts` / 根拠: spec D3, AC3・AC5・AC-I1・AC-I3
- [x] T12: 入力中のキー制御を直す。**`keydown` の入口で入力中を判定**し、矢印・`Delete` をキャンバスへ漏らさない（`Esc` は取り消しとして通す）（依存: T10, T11）
      対象: `vscode-extension/src/dds/webview/ui.ts`（`onKeyDown`） / 根拠: spec D7, AC-I5, 本 plan R3
- [x] T13: 2 つの器で通し、e2e を足す。`protocol` に `setAttributes` の検証を足し、単独起動ハーネスで**ツリー選択 → 属性編集 → ソースの該当行だけ変化**を実操作で確かめる。`npm test` / `npm run verify` も通す（依存: T12）
      対象: `vscode-extension/src/dds/webview/protocol.ts`・`dev/standalone.ts`・`dev/e2e.mjs` / 根拠: AC9・AC-I5, 本 plan「テスト方針」
