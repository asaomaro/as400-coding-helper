# タスク: RPG III の残りの数値欄

- [x] T1: F / F(索引) / O / E / L の通る土台を作る
      対象: `verify/probe-base.mjs`（新規）/ 根拠: research F1
- [x] T2: 欄ごとに 対照・英字・左詰めを流す
      対象: `verify/probe-numeric.mjs`（新規）/ 根拠: research F2
- [x] T3: 食い違いの理由をコンパイル・リストで読む（依存: T2）
      対象: `verify/probe-followup.mjs` `probe-rest.mjs` `probe-rest2.mjs` `probe-lspec.mjs` `probe-line2.mjs`
      根拠: research F3〜F6
- [x] T4: 定義に反映（依存: T3）
      対象: `resources/prompter/rpg/rpg3/ja/{F,O,E,L}-SPEC.json`
- [x] T5: E / L の分類を足す（依存: T4）
      対象: `src/core/rpgSpec.ts` `classifySpec` の switch / 根拠: research F7
- [x] T6: テストを足し、戻して落ちることを確かめる（依存: T5）
      対象: `test/unit/rpg3NumericColumns.test.ts`
- [x] T7: `RPG3SAMP.rpg` の桁を直す（依存: T6）
      対象: `docs/src/RPG3SAMP.rpg` / 根拠: research F8
