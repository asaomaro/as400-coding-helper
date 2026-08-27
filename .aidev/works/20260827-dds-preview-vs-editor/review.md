# レビュー: プレビューとビジュアルエディタの使い分けを案内する

## ラウンド 1（2026-08-27）

### 要件適合
- AC1 ✓ `editor/context` に `openDdsVisualEditor` を足した（`.dspf` / `.mnudds` / `.prtf`）。
- AC2 ✓ `verify-contributes.mjs` が `resolveDdsType` と `customEditors[].selector` の
  **両方**と突き合わせる。**両分岐が鳴ることを確認済み**（`when` から `.prtf` を落とす → 2 件、
  `selector` から落とす → 1 件）。
- AC3 ✓ 3 つの `title` が役割を持つ（「読み取り・横に並べる」/「編集する・テキストと入れ替わる」）。
- AC4 ✓ `docs/dds-editor-and-preview.md` に対比表と「対応していないもの」。

### 価値適合
目的は「**2 つの器が同じ場所に並んで見える**」。文書だけでは達成しないと判断し、
**到達経路（コマンド＋メニュー）を先に作った**のが本質的な変更。実際 `verify-contributes.mjs`
は導線を足す前に落ちており、死蔵が機械的に確認できている。

### 正確性
- `vscode.openWith` の引数順 `(uri, viewType)` を単体テストで固定した（逆だと無言で失敗する）。
- 対象外（`.pf` = DDS-PF）で実行したときに開かず案内を出すことも見ている。
- 拡張子の集合をコマンド側に数え上げず `resolveDdsType` に委ねた（真実源を増やさない）。

### 規約適合
- AGENTS.md「追加したリソースは到達可能になって初めて完了」— まさにその死蔵の解消。
  再発防止を `verify-contributes.mjs` に置いた（issue #41 と同じ形）。
- 表示系は言語登録ではなく拡張子（`resourceExtname`）で判定する方針に沿っている。

### 保守性
既存の `PREVIEW_MENUS` の形をそのまま `EDITOR_MENUS` に広げた。`ddsTypes` を配列に
したのはエディタが DSPF ∪ PRTF を受けるため。

### 指摘
must 0 / should 0 / nit 0。
