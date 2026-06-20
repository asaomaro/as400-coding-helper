---
name: aidev-00-start
description: AI開発ワークフローの入口。作業状況を確認し、どの工程から始めるかをユーザーに確認して案内する。「AI開発を始めたい」「開発ワークフローを開始」「続きから再開」「aidev」などと言われたときに使用する。
allowed-tools: [Bash, Read, AskUserQuestion]
---

AI 開発ワークフローの入口（ルーター）。
ワークフロー全体を説明し、現在の作業状況を確認したうえで、どの工程から開始するかをユーザーに確認して案内する。

共通規約は同梱の `protocol.md`（このディレクトリ内）に従う。実行前に必ず読むこと。
この harness は `.claude/skills/aidev-*` だけで自己完結し、PJ 固有ファイルには依存しない。

## 1. ワークフローの説明

以下を簡潔に提示する。

- 工程は `requirement → spec → plan → coding → test → review` の順（推奨デフォルト）。
- 各工程は **承認ゲート付き**で、自動では次に進まない（承認後に「次へ進むか」を確認する）。
- 番号順は強制ではなく、差し戻し（例: review → coding）も可能。
- 作業は `.aidev/works/<YYYYMMDD-slug>/` 単位で管理され、いつでも中断・再開できる。

## 2. 作業状況の確認

以下を実行して現状を把握する。

- `cat .aidev/current 2>/dev/null` で現在作業中フォルダを確認。
- `ls .aidev/works 2>/dev/null` で全作業フォルダを一覧。
- 各フォルダの `state.yml`（`current` / `approved` / `dependsOn`）と成果物ファイルの有無を読み、進捗を要約する。
- `dependsOn`（`protocol.md`「2.7」）に未充足の依存がある作業は `⛔依存待ち（<未充足の依存>）` と明示する。

要約例: `001 user-login … spec 承認済み（次: plan）` / `002 export-csv … requirement 作成中` /
`003 rpg-skill … ⛔依存待ち（#18 未クローズ）`

`.aidev/` 自体が無い場合は「新規作業の開始」のみ提示する。

## 3. ユーザーへの確認

`AskUserQuestion` ツールで次の選択肢を提示する（`Other` による自由入力も可）。
非対応エージェントでは同じ選択肢をテキストで提示する。

- **続きから**：既存の作業を選択 → `.aidev/current` を更新 → その工程の skill を案内。
- **別工程をやり直す（差し戻し）**：作業と工程を選択 → 当該工程の skill を案内。
- **新規 requirement を起こす**：手順 4 へ。

作業が複数ある場合は、まず対象の works フォルダを選ばせてから上記を提示してよい。

## 4. 新規作業の開始

1. requirement の概要をユーザーに確認し、簡潔な slug を決める（kebab-case、英小文字）。
2. 日付プレフィックスを取得する：`date -u +%Y%m%d`（UTC）。フォルダ名は `<YYYYMMDD>-<slug>`。
   同日・同 slug が既存なら末尾に `-2`,`-3`… を付けて一意化する。
3. `mkdir -p .aidev/works/<YYYYMMDD-slug>` を作成。
4. `state.yml` を初期化（`protocol.md` の「6. state.yml スキーマ」に従う。`current: requirement`、`approved: []`）。GitHub issue 連携時は `issue` を設定。
   - **実行モード**を決める（`protocol.md`「10.」）。既定は `mode: interactive`。
     夜間自律など人手を介さず PR まで回す場合は `mode: autonomous` とし、必要なら
     `humanGates`（人間ゲートを残す工程。例 `[spec]`＝部分自律）を設定する。
   - **前提となる作業/issue があれば** `dependsOn` に記録する（他の works slug / GitHub issue `#N`。`protocol.md`「2.7」）。
5. `.aidev/current` に `<YYYYMMDD-slug>` を書き込む。
6. **作業ブランチの準備（PJ委譲・任意）**：PJ がブランチ運用の場合に行う（`protocol.md`「2.5」に従う）。
   - PJ にブランチ作成を伴う skill（例: issue＋ブランチ作成 skill）があれば、それを優先して使う。
   - 無ければ PJ 規約に沿って作成する（例: `feature/<slug>`）。
   - trunk-based 等ブランチを使わない PJ ではスキップする。
   - 既に作業ブランチ上にいる場合は新規作成しない（重複防止）。
   - 成果物（`.aidev/works/...`）も同じブランチに乗せると、後段の PR がきれいになる。
7. `aidev-10-requirement` 工程の開始を案内する。

## 5. 注意

- この skill は工程を直接実行しない。あくまで現在地の把握と次工程の案内に徹する。
- 工程の実行可否・終了処理は各工程 skill と `protocol.md` に委譲する。
