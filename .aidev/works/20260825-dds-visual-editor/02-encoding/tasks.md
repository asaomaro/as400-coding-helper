# タスク: 02-encoding

- [x] T1: `isDbcsCodePoint` と `displayWidth` を実装する。判定範囲は現行を一字一句そのまま移送する（`3040-30FF` / `3400-9FFF` / `F900-FAFF` / `FF01-FF60` / `FFE0-FFE6`）。`displayWidth` は SBCS=1 / DBCS=2 に加え、**DBCS run ごとに SO 1 桁と SI 1 桁**を足す
      対象: `packages/dds-core/src/text/encoding.ts`（新規） / 移送元: `vscode-extension/src/language/dbcsShiftMarkers.ts:7` `isDbcsCodePoint` / 根拠: research F5・F6, spec D3・D4
- [x] T2: 位置換算を実装する。`charIndexToColumn(text, index)`（0 始まり索引 から 1 始まり桁へ）と `columnToCharIndex(text, column)`（`{ index, straddles }` を返す）。**DBCS の 2 桁目・SO・SI を指したら `straddles: true`。黙って丸めない**（依存: T1）
      対象: `packages/dds-core/src/text/encoding.ts` / 根拠: spec「振る舞いの詳細・エッジケース」, 本 plan R2
- [x] T3: `sosiPositions(text)` を実装する。DBCS run から SO / SI が入る**表示桁位置**を算出して返す（依存: T1）
      対象: `packages/dds-core/src/text/encoding.ts` / 根拠: spec「インターフェース / 表示桁換算 API」
- [x] T4: 2 つの座標系を語彙で分ける薄いラッパを足す。`charIndexToSourceColumn` / `sourceColumnToCharIndex`（ソース行内の桁）と `displayWidthOf`（画面上の表示桁）。**実装は共通、名前と JSDoc で適用対象を強制**する（依存: T2, T3）
      対象: `packages/dds-core/src/text/encoding.ts` / 根拠: design「換算 API の適用先を型で分ける」, spec D3
- [x] T5: research の実測値をテスト化する。実機メンバ相当の文字列で **`displayWidth` が 11**、**UTF-16 長が 7** であることを固定する（**この乖離がモジュールの存在理由**）（依存: T1）
      対象: `packages/dds-core/test/encoding.test.ts`（新規） / 根拠: research F1・F3・F6
- [x] T6: エッジケースのテストを足す。索引 0 / 末尾 / 空文字列 / run が先頭・末尾に接する / **run 終了直後の索引で SI が数え込まれる** / `straddles` の 3 パターン / 往復（桁に変換して索引に戻す）/ **サロゲートペアは DBCS ではないが 2 コード単位を消費する現行挙動**（依存: T2, T3）
      対象: `packages/dds-core/test/encoding.test.ts` / 根拠: 本 plan「決めておく前提」, spec エッジケース
- [x] T7: `text/encoding` を `dds-core` の公開 API として re-export する（依存: T4）
      対象: `packages/dds-core/src/index.ts` / 根拠: spec「対象範囲」
- [x] T8: `dbcsShiftMarkers.ts` の DBCS 判定を `@as400/dds-core` の `isDbcsCodePoint` に差し替える。**ロジックは移送であって書き直しではない**。移送前後で代表コードポイント群（各範囲の境界値を含む）の判定が一致することをテストで示す（AC8）（依存: T7）
      対象: `vscode-extension/src/language/dbcsShiftMarkers.ts:7`（`isDbcsCodePoint` 定義）・`:71`（利用箇所） / 根拠: spec D4, 本 plan R1
- [x] T9: 差し替え後の `dist/extension.js` に **core のコードが実際にバンドルされている**ことを確認する。`@as400/dds-core` はこれまで依存宣言だけで未使用だったため、**D1 の前方配線が初めて実地で検証される**（依存: T8）
      対象: `vscode-extension/esbuild.mjs` の出力 `vscode-extension/dist/extension.js` / 根拠: 01-workspace `decisions.md` D1, 本 plan R3
- [x] T10: `ruler.ts` の DBCS 桁ズレを調査し起票する。**ルーラーの文字数（`lineText.length`）と実際の表示桁数（`displayWidth`）の差を計算で示す**決定論的な証拠を作る。修正はしない。**視覚確認が未実施であること**を起票に明記する。起票先は `.aidev/backlog/`（GitHub issue 化はユーザー確認のうえ）（依存: T2）
      対象: `vscode-extension/src/language/ruler.ts:130`（幅算出）・`:216`（`buildTensRow`）/ 起票先: `.aidev/backlog/`（ファイル名は未特定） / 根拠: research F10, 親 plan（ユーザー決定: 実測して起票に留める）
