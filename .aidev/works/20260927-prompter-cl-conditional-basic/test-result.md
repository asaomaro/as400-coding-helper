# テスト結果: CL の条件表示の欄を基本の画面に出す・説明の箇条書きを落とさない（P17）

- `npm test`: 1498 passing（追加 2 件）。`verify-cl-definitions.mjs`（日英）差分なし、`verify-cdml-rules.mjs` OK、`verify-cl-roundtrip.mjs` OK、`verify:defs` OK。

## 受け入れ基準ごとの判定
- AC1: pass — `basic` を 120 欄（×日英）に足した。DCL は LEN / VALUE / BASPTR / DEFVAR / ADDRESS が基本の画面の欄（条件が成り立てば出る）。
- AC2: pass — LEN の説明に「・10進数-- 15桁（小数点以下の桁数は9桁）」から始まる最大長・省略時の長さの一覧が入った。
- AC3: pass — 生成物の差分の種類は `"help"`（337 行ずつ）と `"basic": true`（240 行）だけ（`generate-cl-definitions.mjs` → `generate-cdml-rules.mjs` の順で作り直した）。
