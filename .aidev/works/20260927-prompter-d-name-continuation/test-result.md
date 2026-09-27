# テスト結果: D 仕様の名前を継続名前行に分け、字下げを残す（P21）

- `npm test`: 1487 passing（追加 4 件）。字下げの扱いを外すと 2 件落ちる（確認済み）。全定義の往復 OK。

## 受け入れ基準ごとの判定
- AC1: pass — `customerAccountBalance` → `     DcustomerAccountBalance...` ＋ 名前欄の空いた主要定義行。桁幅のエラーなし。
- AC2: pass — `customerAccount...` ＋ `   Balance` を `customerAccountBalance` と読み、`BAL` に直すと 1 行（字下げつき）になる。
- AC3: pass — `D  SUB1` を `SUB9` に変えても 8 桁目から。
- AC4: pass — 本物の VS Code（`docs/research/20260927-f4-prompter-exploration/driver.mjs`）で、長い名前 → 2 行、主要定義行の F4 で `customerAccountBalance` が読め、
  `BAL` に直すと 1 行に戻り、`SUB1` → `SUB9` で字下げが残った。実機（SR-OSAKA、IBM i 7.3）で `verify/LONGNM.rpgle` が `CRTBNDRPG` 可（#1471）。
