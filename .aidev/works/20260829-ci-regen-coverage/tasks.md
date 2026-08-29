# タスク: 生成物の再生成チェックを取りこぼしなくする

- [x] T1: 再生成ステップに `generate-dds-columns.mjs --lang=en` と
      `generate-rpg-io-definitions.mjs` を足す。
      対象: `.github/workflows/prompter-definitions.yml:52`（「再生成しても差分が出ないこと」）
      / 根拠: spec D2
- [x] T2: 差分検査の対象を `vscode-extension/resources` 全体にする（列挙をやめる）。
      対象: 同 `:77`（`git diff --quiet -- …` の 2 か所）/ 根拠: spec D1
- [x] T3: 手元で同じコマンド列を回して差分ゼロ、かつ**手編集で落ちる**ことを確かめる（依存: T1・T2）。
      対象: `vscode-extension/resources/` / 根拠: AC3 AC4
- [x] T4: backlog「CI を整える」を割る（本 PJ 側は済／別リポジトリ側は残件）（依存: T3）。
      対象: `.aidev/backlog/workflow.md:324` / 根拠: AC5
