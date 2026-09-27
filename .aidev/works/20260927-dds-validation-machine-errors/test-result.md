# テスト結果: 検証を実機の誤りに揃える

- `npm test`: 1445 passing（追加 6 件、lint の規則一覧の期待を 4 規則ぶん更新）。`ddsSourceDiagnostics` を呼ばないようにすると 4 件落ちる（確認済み）。
- `node docs/origin/verify-dds-conditioning.mjs`: OK（条件が必須の 3 件が実機と一致）。
- GUI e2e（`dev/e2e.mjs`）: 234 PASS / 0 FAIL（追加 3 件。手元だけで止まる無関係の段は ±1 を許す写しで流した）。

## 受け入れ基準ごとの判定
- AC1: pass — 原典から採った集合が DSPF の SFLCLR / SFLDLT / SFLEND。実機（SR-OSAKA、IBM i 7.3）で 3 つとも条件なしは CPD7490（`NCLR` / `NDLT` / `NEND`）、
  条件ありの `NCOND` は作成可。
- AC2: pass — H・P・M に位置で指摘、位置なし・B では指摘なし。実機の対照は同じバッチの `20260927-dds-positionless-usage/verify/`（CPD7443 / CPD7436）。
- AC3: pass — 帳票の B で指摘、O・空白は指摘なし。実機は `20260927-dds-prtf-spacing-usage/verify/USEB`（CPD7410）。
- AC4: pass — 1 行に書いた 62 文字のリテラルを指摘。`-` 継続・継続記号なし・81 桁目以降の注記は指摘なし。
- AC5: pass — 検証タブに CPD7490 / CPD7443 / CPD7508 の 3 件が出る。lint 規則 4 つを既定 ON・`package.json` に載せた。
- AC6: pass — リポジトリ内の `.dspf` / `.prtf` 33 件に当てて、新しい指摘は実機で作成できなかった見本だけ（UHPOS / UMPOS / UPPOS / USEB / NCLR / NDLT / NEND /
  調査 v1 の CMPLXD。v1 は CPD7443 × 2・CPD7490・CPD7508 の行をそのまま指す）。実機で通った docs/src・調査 v3・FOLDD・CONTTST などは 0 件。
  CONTTST（継続記号なしの継続）は最初の実装で誤って指摘したため、続く先の行を見る形に直した。
