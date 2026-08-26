---
backlog: dds
kind: standing        # standing（定常ドメインキュー）| split（タスク分割由来・短命）
priority: 1           # DDS の視覚的確認と編集（charter の第 4 の柱）
---
# DDS（DSPF/PRTF）バックログ

画面・帳票の視覚的な確認と編集に関するキュー。対象は `src/core/dds/`・`src/dds/`・
`src/language/{dspf,prtf}Preview*.ts`。

`aidev-util-batch` が消化する対象リスト。各未チェック行 = 1件のタスク。

## 項目

- [ ] **プレビューとエディタの使い分けを案内する** — `showDspfPreview`（読む器）と
  DDS ビジュアルエディタ（編集する器）が並存している。どちらをいつ使うのかが
  どこにも書かれていないので、利用者は片方しか見つけられない。README か
  コマンドの説明文に導線を足す。出所: `20260826-dds-editor-port` の `review.md`。

- [ ] **実機ゴールデンとの突き合わせを入れる** — 描画（`dspfRenderModel` / プレビュー）が
  実機の見え方と一致するかは、いま**目視でしか確かめていない**。ts5250 で
  `CRTDSPF` → 表示 → 採取し、`render` の出力と機械比較する仕組みを入れる。
  DBCS を含む様式を必ず含めること（SO/SI が桁を消費するため、ここが最もずれる）。
  参考実装: `feature/dds-visual-editor` ブランチ（PR #108・draft）の
  `packages/dds-core/test/golden/` と `docs/dds-golden/README.md`。

- [ ] **CLI に DDS の操作を足す（`parse` / `render` / `validate` / `patch`）** — 現在の CLI は
  lint のみ。AI エージェントが DDS を読み・描き・検証し・編集するには CLI 表面が要る。
  編集エンジン（`core/dds/ddsEdit.ts`）は既にあるので、**薄く載せるだけ**で済む。
  参考実装: PR #108 の `packages/dds-cli`（`init` を含む・AC7 の記録つき）。

- [ ] **エディタの GUI e2e を CI に載せる** — `dev/e2e.mjs`（単独起動を実操作する 15 件）は
  手元でしか走っていない。`playwright-core` とブラウザのキャッシュを CI に用意すれば載る。
  **不安定なまま載せると赤を無視する習慣がつく**ので、再現率を測ってから
  （例: 10 回連続で緑）判断する。出所: `20260826-dds-editor-port` の `decisions.md` D9。

- [ ] **表示トグルを足す（SO/SI の `{ }` 表示・属性バイト・グリッド・スナップ・ズーム）** —
  確定デザイン C1 のツールバーにある。**ズームは VSCode のエディタズームと二重に効く**
  （`docs/design/dds-designer/README.md` の未解決 5）ので、そこの決着が要る。
  桁勘定の表示（`'社員マスタ保守' = SO 1 + 全角 7 字 × 2 + SI 1 = 16 桁`）も同じ段で。

- [ ] **条件標識の編集（C1 の左ペイン下段）** — core に**条件の解決が無い**のが前提条件。
  「どの標識が立っているとどう見えるか」を `dspfLayout` が返せるようにしてから UI を足す。

- [ ] **キーワード欄の編集（L3）** — `DSPATR` / `COLOR` / `EDTCDE` 等。
  **原典（`docs/origin/dds/`）との突き合わせが前提**。いまは読み取り専用で見せている。
  併せて**名前変更の参照追随**（`SFLCTL(NAME)` 等）もここで扱う——
  現状は「追随しません」とプロパティに断っている。

- [ ] **行長の数え方を表示桁に揃えるか決める** — 編集の上限（100 桁）は lint と同じ
  **JS の文字数**で数えている。DBCS を含む行は実バイトではもっと長い。
  変えるなら `src/lint/rules/lineLength.ts` と**同時に**変える必要がある。
  出所: `20260826-dds-attribute-editing` の `decisions.md` D7。

- [ ] **PRTF（帳票）の編集に広げる** — 編集エンジンは DSPF 前提ではない
  （`ddsEdit` は位置欄と長さ欄しか触らず、論理単位も PRTF と共有）。
  描画モデルを PRTF 用に足せば同じ UI が使える見込み。`prtfLayout` は既にある。

- [ ] **キーワードと条件標識の編集（L2 / L3）** — いまの編集は位置と長さだけ。
  `DSPATR` / `COLOR` / `EDTCDE` などのキーワードと、条件標識の付け外しは未対応。
  **原典（`docs/origin/dds/`）を正として**進めること。`editCode.ts` が先例。

- [ ] **単独起動を製品にするか決める** — `dev/` のハーネスは検証用で、ファイル操作も undo も
  最小限。独立したアプリとして出すのか、継ぎ目の検証手段に留めるのかを決める。
  出すなら保存経路・undo・エラー処理を作り込む必要がある。
