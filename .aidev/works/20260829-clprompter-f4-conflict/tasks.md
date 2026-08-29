# タスク: clPrompter との F4 衝突を確かめる

- [x] T1: 競合のマニフェストから `contributes.keybindings` と `contributes.languages` を取る。
      対象: `bobcozzi/clPrompter` の `package.json`（取得済み）/ 根拠: spec D1
- [x] T2: 本 PJ の `when` と `contributes.languages` を突き合わせ、拡張子ごとの重なりを出す。
      対象: `vscode-extension/package.json` の `contributes.keybindings` / `languages` / 根拠: spec D2
- [x] T3: 調査文書の「未確認」を事実に置き換え、回避手段を足す（依存: T2）。
      対象: `docs/research/code-for-ibmi.md`（「F4 の衝突」の行）/ 根拠: AC3 AC4
