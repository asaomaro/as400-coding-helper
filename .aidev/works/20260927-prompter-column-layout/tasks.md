# タスク: 欄を桁の決まりどおりに寄せる

## タスク
- [x] T1: `columnLayout` を足し、書き戻し（`layOutColumns`）と検査（`columnLayoutError`）を実装する。単体テスト。
      対象: `vscode-extension/src/prompter/{types,commandText,model}.ts` / `test/unit/prompterRegressions.test.ts`
      依存: なし
      AC: AC1, AC2
- [x] T2: 定義に付ける（RPG は JSON、DDS は生成スクリプト）。C の結果標識を 3 欄に分け、原典照合と英語版を合わせる。
      対象: `resources/prompter/rpg/ile/*/{C,D,F}-SPEC.json` / `docs/origin/generate-dds-prompter.mjs` / `docs/origin/verify-rpg-definitions.mjs` / `docs/origin/rpg-spec-en-strings.json`
      依存: T1
      AC: AC1, AC4
- [x] T3: 実機で確かめる（プロンプターで書いた行をコンパイル、左詰めの対照）。
      対象: `verify/`
      依存: T2
      AC: AC3
