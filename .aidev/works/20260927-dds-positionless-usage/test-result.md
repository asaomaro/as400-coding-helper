# テスト結果: 使用を H / P / M にしたら位置欄を空ける

- `npm test`: 1439 passing（追加 6 件）。判定を無効にすると 5 件落ちる（確認済み）。

## 受け入れ基準ごとの判定
- AC1: pass — H・P・M で 39-44 桁が空く。`*DS4` の上書き行も消え、後続の行は変わらない。O では `  5 20` のまま。
- AC2: pass — 帳票は P で空き、O で残る。
- AC3: pass — 実機（SR-OSAKA、IBM i 7.3）。`verify/make-hidden.mjs` で使用を H にした `HIDEN.dspf` は `CRTDSPF` 可（#1447）。
  対照: 位置つきの H `UHPOS`・P `UPPOS` は CPD7443、M `UMPOS` は CPD7436。位置なしの H `UHNOP` は作成可。
  （`UPNOP` / `UMNOP` は位置と無関係の理由で作成できない。P はキーワードでの参照が要り CPD8049、M は長さ等を空ける CPD7436。）

スプールは消していない（QPRTJOB）。
