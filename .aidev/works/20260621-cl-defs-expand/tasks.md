# タスク: CLコマンド定義JSONの拡充（P1=制御構造バッチ）

- [x] T1: `.aidev/backlog/cl.md` に未定義85件を P1–P10 カテゴリで分類追記（消化状態 `[ ]` で追跡可能に）
- [x] T2: 構造検証スクリプトを追加（全 `vscode-extension/resources/prompter/cl/*.json` をパース＋`PrompterDefinition` スキーマ適合チェック）
- [x] T3: P1 プログラム境界/分岐 — PGM, ENDPGM, RETURN, GOTO の定義JSONを原典照合で作成（依存: T2）
- [x] T4: P1 条件分岐 — IF, ELSE, SELECT, WHEN, OTHERWISE, ENDSELECT の定義JSONを原典照合で作成（依存: T2）
- [x] T5: P1 ループ — DO, ENDDO, DOWHILE, DOUNTIL, DOFOR, ITERATE, LEAVE の定義JSONを原典照合で作成（依存: T2）
- [x] T6: P1 サブルーチン/呼び出し — SUBR, ENDSUBR, CALLSUBR, CALLPRC の定義JSONを原典照合で作成（依存: T2）
- [x] T7: P1 全21件を原典 `docs/origin/cl/<CMD>.html` と機械 diff 照合（パラメータ集合/必須/型/長さ/定義済み値）。主エージェント直読（依存: T3,T4,T5,T6）
- [x] T8: 構造検証を全 green にし、`.aidev/backlog/cl.md` の P1 実装分を `[x]` 更新（依存: T1,T7）
