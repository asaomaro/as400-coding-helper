# レビュー記録

## ラウンド 1（2026-09-27）

CHECK: ok / FINDINGS: 0
- 要件適合: AC1〜AC4 を単体テストと実機で確認。
- 正確性: 命令の欄は原典で 26-35 桁と決まっている（`C-SPEC-layout.html`）。演算拡張 `(H)`・`(E)` 等は括弧から後ろを落として比べる。
  判定は `rpgSpec.ts` の 1 か所で、ルーラー・プロンプター（`specClassifier`）・lint が共有する。RPG III は従来どおり常に C-SPEC。
- 範囲外: P15（空行から新旧を選ぶ入口）は backlog に分けた。C-NEW の COND が必須すぎる件（ELSE 等）は P7 の項目で扱う。
