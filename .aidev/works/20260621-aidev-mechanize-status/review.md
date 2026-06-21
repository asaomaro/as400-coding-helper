# レビュー記録

## ラウンド 1（2026-06-21）

対象差分: `.aidev/bin/aidev`（sh）/ `.aidev/bin/aidev.ps1`（ps1）/ `.aidev/bin/README.md` /
`.aidev/bin/test/run.sh`（新規）/ `.claude/skills/aidev-00-start/SKILL.md` /
`.claude/skills/aidev-util-insights/SKILL.md`。

### 要件適合
- requirement の完了条件（status の works＋backlog 機械抽出 / 機械形式 / legacy 耐性 / ルーター手読み消去 /
  README 追記 / 横展開の調査整理 / insights 置換）はいずれも満たす（test.md AC 対応表）。**指摘なし**。

### 正確性
- status の `next`/`done`/`deps`、metrics の `lead_sec`/`reworks`/`sent_backs`/`elapsed_sec` をテストで検証済
  （境界: legacy / 未deliver / 依存(works+#N) / 手戻り / metrics 空）。**指摘なし**。
- 既存コマンド（new/event/approve/guard/verify/doctor）の回帰: 実works・フィクスチャとも exit/出力不変。**指摘なし**。
- 読み取り専用: status/metrics 実行後に state/metrics が不変であることを実ファイルで確認。**指摘なし**。

### 規約適合 / 保守性
- sh/ps1 パリティ規約・Node 非依存・UTF-8(BOM なし)・LF を踏襲。共有 `eval_depends` で guard と status の
  依存判定を一元化（重複排除）。

### 指摘一覧

- [should→許容] **ps1 パリティが当環境で未検証**（pwsh 不在）。コードは sh と1対1で対応させ、関数定義・
  dispatch・括弧（文字列リテラル除く）を静的確認済。対応: **許容（差し戻さない）**。理由: 環境制約であり
  コード欠陥ではない。CI / pwsh のある環境で `sh .aidev/bin/test/run.sh` のパリティ節（自動 skip 解除）で
  最終確認すること（[[decisions]] D1）。deliver の PR 本文・walkthrough に明記する。
- [nit] `yget`/`YGet` の inline コメント除去を廃止（[[decisions]] D3）。全 scalar 読みに影響するが、実ファイルは
  機械生成でコメントを含まず、回帰テストで既存出力不変を確認済。対応: 修正済（むしろ既存 `#N` 依存バグを解消）。
- [nit] status の `deps` が長い（複数未充足）場合、table が横に広がる。対応: 許容（tsv で機械処理可能）。

### 判定
- **must=0 / should=0（1件は許容） / nit=2**。must/should の差し戻し対象なし。
- 差分が複数ファイル横断（sh/ps1/skill×2/test）かつ parity・epoch 算術を含むため、**walkthrough（任意）を推奨**。
