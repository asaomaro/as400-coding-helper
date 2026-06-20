# タスク: ルーラー表示機能

> 各タスク = 1 つの検証可能な変更。実コードは `vscode-extension/` 配下。

- [x] T1: 桁ローダ共通化 — `src/language/keywordColumns.ts` を新設し、`getRpgKeywordColumns` / `getClKeywordColumns`（＋`parseColumnsValue` 系）を `rpgTabNavigation.ts` から移設して export。`rpgTabNavigation.ts` は import に置換（ロジック不変・キャッシュ含め挙動維持）。
- [x] T2: ラベル定義 JSON 追加 — `resources/navigation/rpg-fixed-field-labels.json`（H/F/D/C-SPEC/C-NEW/O/P 各種別の区間ラベル配列、要素数は keyword-columns と一致）と `cl-field-labels.json` を新設。ラベル不要区間は空文字。
- [x] T3: package.json 拡張 — `contributes.commands` に `rpgClSupport.ruler.cycleMode`（title: `RPG/CL: Toggle Ruler Display`）、`contributes.configuration` に `rpgClSupport.ruler.defaultMode`（enum off/ruler/full、既定 full）を追加。
- [x] T4: ruler.ts 骨格 — `src/language/ruler.ts` を新設。`RulerMode`/`CYCLE` 定義、`workspaceState` でのモード読込・保存、`cycleMode` コマンド登録、ステータスバー item 生成（文言反映・in-scope 時のみ show）、`registerRuler(context)` の枠組み。（依存: T3）
- [x] T5: スペック種別判定 — ruler.ts 内に独自判定を実装。6 桁目スペック文字で `H/F/D/O/P/C-SPEC` を返し、C は先頭オペコードを `cNewOpcodes` と照合して `C-NEW` 判定。CL は固定。コメント/空行/行長<6 は種別なし。`cNewOpcodes` ロジックは `positionResolver` と同規約を共有（重複回避の最小変更）。
- [x] T6: 目盛り段＋デコレーション基盤 — `tensDecoration`/`fieldsDecoration`（per-instance `renderOptions.before` ＋ CSS `top` 浮かせ・テーマ連動背景色）を生成。目盛り文字列生成（1始まり: 10桁ごと桁番号下1桁・5桁ごと`+`・他`.`、長さ max(80,行長)）。`setFloating` 適用ヘルパ。（依存: T4）
- [x] T7: 境界段文字列生成 — 種別（T5）→ `keywordColumns`（T1）＋ labels（T2）から境界段を生成（区間先頭に区切り、ラベル左寄せ・区間幅で切詰め、ラベル欠落/不一致は境界線のみ）。種別不明は空文字列。（依存: T1, T2, T5）
- [x] T8: 更新ロジック＋トリガ統合 — `updateForEditor`（in-scope/early-return、mode 別に off=両クリア / ruler=目盛りのみ / full=目盛り＋境界、フォーカス行のみ装飾、非同期世代ガード）を実装し、`onDidChangeActiveTextEditor` / `onDidChangeTextEditorSelection` / `onDidChangeTextDocument`（アクティブのみ）/ `onDidChangeConfiguration` / toggle command を購読。dispose を subscriptions に登録。（依存: T4, T5, T6, T7）
- [x] T9: 登録配線 — `src/language/registration.ts` の `registerLanguageFeatures` に `registerRuler(context)` を 1 行追加。（依存: T4〜T8）
- [x] T10: ビルド検証 — `npm run compile`（tsc）をエラーなく通過（exit 0、`ruler.js`/`keywordColumns.js` 生成確認）。既存機能（SOSI・タブナビ）は import 置換のみで非回帰。（依存: T1〜T9）
