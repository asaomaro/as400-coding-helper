# テスト結果: 条件標識の解決と標識パネル

## 実施

| 層 | 結果 |
|---|---|
| 単体（`npm test`） | **569 passing / 0 failing**（この work で +42） |
| 型検査（拡張ホスト `tsc -p ./` / WebView `tsconfig.webview.json`） | 通過 |
| 原典検証（`npm run verify`） | 14 項目すべて ✓ |
| 桁位置 lint（DDS / PRTF / CL / PF / LF / CMD） | 指摘なし |
| GUI e2e（`dev/e2e.mjs`・単独起動を実操作） | **55/55 PASS**（この work で +13） |

## 受け入れ基準ごとの確認

| AC | 確認 |
|---|---|
| AC1 | 単体: 畳み込みの表 9 件（`O` が 1 行目・AND 継続・混在）＋ Kleene 3 値 12 件 |
| AC2 | 単体: 番号順・使用桁数・キーワード行・注記行・画面サイズ条件名の 6 件 / e2e: 一覧が `01,02,30,50` |
| AC3 | e2e: 3 択を押すと描画が変わる・`すべて未設定` で戻る |
| AC4 | 単体: `items` から消え `outline` に `condition-off` / e2e: ツリーに `条件で非表示` |
| AC5 | 実装（プロパティの `条件` 行）＋ 単体で `attributes.condition` を確認。**e2e では未検証**（下記） |
| AC6 | 単体 3 件（出る・片方未設定なら出ない・二重に出さない）/ e2e 2 件 |
| AC7 | 単体: `applyIndicators(model, {})` が**同一参照**を返す（`assert.strictEqual`） |
| AC8 | e2e: 標識を倒してもソース面が 1 行も変わらない（`changed` 行 0） |
| AC-I1 | 実装（一覧が空なら「このソースでは使われていません」）。**見出しは残す**（decisions D6） |
| AC-I2 | e2e: 即時反映・`すべて未設定` が押せる／設定が無ければ押せない |
| AC-I3 | e2e: `ArrowRight` で値が変わる |
| AC-I4 | e2e: 切替の直後もフォーカスがその標識の選択中の値に残る |
| AC-I5 | e2e: 項目を選んだ状態で標識の矢印キーを押しても**ソース行が変わらない** |

## 未検証の穴

- **AC5（プロパティの条件行）は e2e で押していない**。単体で値の組み立てを確かめ、
  画面には出ていることを目視（スクリーンショット）で確認したが、
  「選択 → 条件が読める」の一連の操作は自動化していない。
- **GUI e2e は CI で走らない**（`playwright-core` を devDependency にしていないため。
  backlog `dds.md` に「e2e を CI に載せる」として起票済み）。手元でのみ 55/55。
- **VSCode 統合テスト（`npm run test:integration`）は実行していない**。
  F4 プロンプターのテストが対話プロンプトを待って**ハングする既知の不具合**が main に残っている
  （backlog `prompter.md`）。この work は `src/dds/webview/` と `src/core/dds/` だけを触っており、
  プロンプター経路には掛からない。
- **実機（IBM i）での見え方は未確認**。標識の解決は原典の記述に基づく実装で、
  実機の `CRTDSPF` で表示させた比較は行っていない（backlog の「実機ゴールデン」に含まれる）。

## 参考: この work と無関係の既存指摘

`docs/src/EMPMNT01.rpgle` / `SLSENT01.rpgle` に `numeric-field` の指摘が 30 件出るが、
**この work の前から出ている**（`src/lint/` もサンプルも無変更。`git diff main` が空）。
