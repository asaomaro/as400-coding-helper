# 調査

本作業の材料は本セッションで確認済み（skill `rpgunit-test` 4 節・原典 `QINCLUDE,TESTCASE` の
`setLowMessageKey` / `assertJobLogContains` のコメント）。新たな調査は不要と判断した。

- `ORDER` は `*API` / `*REVERSE`（`RPGUNIT/QCMD,RUCALLTST` で確認済み）
- `RCLRSC` は `*NO` / `*ALWAYS` / `*ONCE`
- `setLowMessageKey` は**各テストの前に枠組みが自動で呼ぶ**（原典のコメントに明記）
