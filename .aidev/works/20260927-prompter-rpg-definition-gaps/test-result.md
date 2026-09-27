# テスト結果: RPG 仕様書の定義の不足をまとめて直す

- `npm test`: 1459 passing（追加 6 件。lint の「既定で無効な規則を有効にできる」は、偽陽性の 35 件に頼っていたので本当に必須が欠けた行で確かめる形に直した）。
  定義を戻すと追加の 5 件が落ちる（確認済み）。
- `generate-rpg-position-values.mjs --check`・`verify-rpg-definitions.mjs`（見出しの桁を含む）・`verify-rpg-spec-definitions.mjs`（日英の構造）・`verify:defs`・全 538 定義の往復: OK。
  見出しの検査は、F の FILEFMT を「（19 桁）」に戻すと NG になることを確認。

## 受け入れ基準ごとの判定
- AC1: pass — 10 欄の値を原典から生成（D 40 桁は 16 値、F 18 桁は 6 値 など）。英語のラベルも英語の原典から。
- AC2: pass — 4 つの行が確定でき、`EMPMNT01.rpgle` の required-field は 35 → 0 件（35 件とも D の長さ・C-NEW の式の偽陽性）。
- AC3: pass — 4 欄が見える。`     FCUSTMST   IF   E           K DISK` を書ける。
- AC4: pass — 上記の検査。md の F 仕様の桁の表と「29-33 桁目に K」の記述を直した。
- AC5: pass — O ＋ F はエラー、O ＋ ブランク・I ＋ F は通る。
- AC6: pass — 実機（SR-OSAKA、IBM i 7.3）で `verify/GAPS.rpgle`（O のブランク指定・`1N`・`7P 2`・`5U 0`・IF/ELSE/ENDIF・名前の無い P の E 行）が `CRTBNDRPG` 可（#1461）。
