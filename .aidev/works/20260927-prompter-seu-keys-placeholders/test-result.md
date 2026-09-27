# テスト結果: F12・F3 で閉じる／誤解を招く placeholder を消す

- `dev/prompter-e2e.mjs`: 76/76 PASS（追加 2 件）。キー操作を戻すと追加の 2 件が落ちる（確認済み）。
- 本物の VS Code（`docs/research/20260927-f4-prompter-exploration/driver.mjs`、この拡張を開発モードで読み込み）で `CMPLXC.clle` から F4 → F12 / F3 / Esc:
  いずれもプロンプターが閉じ、アクティブなエディタは元のまま、定義のピーク表示も出ない。
- `npm test`: 1460 passing。

## 受け入れ基準ごとの判定
- AC1: pass — 上記。
- AC2: pass — F の RECADDR・FILEORG、D の LEN に placeholder が無い（英語版は生成し直した）。
