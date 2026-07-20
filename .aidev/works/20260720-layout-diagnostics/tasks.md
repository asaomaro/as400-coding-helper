# タスク: レイアウト診断を lint / エディタ診断に届ける

- [x] T1: `src/lint/types.ts` に型を足す（依存: なし）。
      `RuleId` に 6 件（`layout-invalid-position` / `layout-column-one-reserved` /
      `layout-invalid-screen-size` / `layout-spacing-with-line-number` /
      `layout-overflow` / `layout-overlap`）。
      `FileRuleContext`（`fsPath` / `lines` / `ddsType`）と `FileRule` を追加。
      **既定 OFF の 2 件は理由を型のコメントに書く**（原典の引用つき。既存 `required-field` と同じ流儀）。
- [x] T2: `src/lint/rules/layout.ts` を新規実装（依存: T1）。
      - `ddsType` で振り分ける（`DDS-DSPF`→`resolveDspfLayout` /
        `DDS-PRTF`→`resolvePrtfLayout` / それ以外→**何もしない**）＝R1
      - 解決は 1 ファイル 1 回（`lines` の同一性でキャッシュ 1 件）＝R3
      - 担当する診断コードだけを `LintFinding` に写す
      - 桁は `DDS_COLUMNS.position` / `DDS_KEYWORD_AREA_START` から**導出**（数値を書かない）＝R6
      - 欄に届かない短い行は行全体に落とす
      - **vscode を import しない**＝R5
- [x] T3: `src/lint/rules/index.ts` を拡張（依存: T2）。
      `RuleSpec` を `kind: "line" | "file"` の判別子つきに変え、
      **既存 5 件には `kind: "line"` を足すだけ**（`rule` 関数には触れない）＝R4。
      レイアウト 6 件を登録し、`enabledByDefault` / `severity` を spec の表どおりにする。
- [x] T4: `src/lint/engine.ts` にファイル単位の規則を回す口を足す（依存: T3）。
      行の走査より前に 1 度だけ回す。並べ替えは既存のまま（出力順は変わらない）。
      **ここで初めて動く**ので、手で `.dspf` に当てて出ることを確かめる。
- [x] T5: `package.json` の `rpgClSupport.lint.rules` に 6 件を追記（依存: T4）。
      `description` に既定 ON/OFF と理由を書く。
      **これが無いと利用者は設定できず死蔵**（AGENTS.md「到達可能になって初めて完了」）。
- [x] T6: 単体テスト `test/unit/lintLayout.test.ts`（依存: T4）。
      - 既定 ON の 4 件が意図した入力で発火する
      - **`.pf` / `.lf` では 1 件も出ない**（R1・research F2 の再発防止）
      - 既定 OFF の 2 件は明示的に有効化したときだけ出る
      - 採らなかった診断（`relative-position-unresolved` / `missing-position` /
        `possible-overprint` / `spacing-with-conflicting-keyword` / `out-of-range`）が**出ない**
      - 桁が位置欄（39-44）を指している
      - `.dds`（種別不定）で 0 件
- [x] T7: 実サンプル結合テスト（依存: T6）。
      `docs/src/` の DDS 全部（`.pf` / `.lf` / `.dspf` / `.prtf`）に**既定の規則**を当てて
      **指摘 0 件**（R2・research F1 の実測を固定）。
      0 件でなければ既定の判断が誤りなので spec に戻る。
- [x] T8: 到達性テスト（依存: T5）。
      `lintFile` の戻り値にレイアウトの指摘が含まれること。
      `package.json` の `lint.rules.properties` に 6 件が載っていること
      （`RuleId` と `package.json` の一致を機械で見る）。
- [x] T9: 退行確認（依存: 全部）。
      `npm test` 全通過、`npm run compile`、`npm run verify:defs`（`verify-lint-core.mjs` を含む）＝R5。
      既存 5 規則のテストが全部通ること＝R4。
      桁の直書きが無いことを grep で確認＝R6。
