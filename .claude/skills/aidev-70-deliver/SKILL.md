---
name: aidev-70-deliver
description: AI開発ワークフローの deliver（着地）工程。レビュー済みの変更をコミット・PR作成で着地させる最終工程。「コミットして」「PRを出して」「deliver工程」などと言われたとき、または review 通過後に使用する。
allowed-tools: [Bash, Read, AskUserQuestion]
---

AI 開発ワークフローの **deliver（着地）工程**。ワークフローの最終工程。
review を通過した変更を、コミット・PR 作成によって実際に着地させ、作業を完了する。

**開始前に共通プロトコル `../aidev-00-start/protocol.md` を読み、その規約に従うこと。**

## 前提

- review 工程を通過していること（must/should の指摘が解消済み）。

## 入力

- 着地対象の変更（diff）。
- 対象フォルダの `requirement.md`（issue 番号等）/ `state.yml`。

## 出力

- コミット（必要に応じて複数）。
- プルリクエスト（PJ 運用に応じて）。

## 手順

1. protocol.md「1. 対象作業の特定」に従い対象フォルダを確定する。
2. **PJ資産の優先**（protocol.md「2.5」）: コミット/PR 用の PJ固有 skill・コマンドがあれば優先する。
   - 例: コミット → PJ のコミット skill、PR → PJ の PR 作成 skill。
   - 無ければ汎用手段（`git commit` / `gh pr create` 等）にフォールバックする。
3. コミット範囲をユーザーと確認する（実装コードと工程成果物を分けるか等、PJ 方針に従う）。
4. チケット連携があれば PR に紐付ける（`state.yml` の `ticket`（旧 `issue`）を参照）。
   `.aidev/config.yml` の `tracker.type` に応じる（github: `Closes #<番号>` ／ jira・redmine: チケットURL/IDを本文に記載）。
   - PR 本文は PJ の PR 作成 skill があればその体裁に従う。無ければ下記「PR 本文テンプレート」を既定とする。
   - 対象フォルダに `walkthrough.md`（レビューガイド）があれば、その**重要ポイントとリスクを3〜5行に要約**して
     PR 本文の `## レビューガイド` 節に載せ、`walkthrough.md` 自体へのリンクを添える（全文転記はしない）。
5. protocol.md「3. 工程終了プロトコル」に従って終了する。
   - 最終工程のため、遷移確認は `承認して完了` とする。完了後、着地結果（コミット/PR の URL 等）を報告する。
   - **autonomous モード時**（protocol.md「10.」）: コミット→**PR を作成して停止**し、結果を報告する。
     **auto-merge はしない**（マージは人間）。test が未通過なら **draft PR** とし要点を明記する。
   - **記録順序の注意**: deliver は工程記録（works フォルダ）自体をコミット対象に含めるため、
     `state.yml` / `metrics.yml` の deliver 記録は**コミットの直前に行い、同じコミットに含める**。
     コミット後に記録すると、その記録が未コミットで取り残される（後追いコミットが必要になる）。

## PR 本文テンプレート（PJ の PR skill が無い場合の既定）

```markdown
## 概要
<何を・なぜ。requirement/spec の要約>

## 変更点
- <主な変更を箇条書き>

## レビューガイド
<walkthrough.md があれば重要ポイント・リスクを3〜5行で要約。詳細は walkthrough.md を参照（リンク）>

## テスト
<test 工程の結果（passed/failed）。draft の場合は未解決点>

<チケット連携（あれば）: github は `Closes #<番号>` / その他は チケットURL・ID>
```

## 留意点

- コミットメッセージ・PR 本文の体裁は PJ 規約（AGENTS.md・PJ skill）に従う。
  - **フォールバック既定**: PJ にコミット/PR skill が無ければ、コミットは **Conventional Commits**
    （`feat:` / `fix:` / `docs:` 等）、PR 本文は上記テンプレートを用いる。
- **ブランチ対応**: 原則 **1 works（`.aidev/works/<YYYYMMDD-slug>`） = 1 作業ブランチ = 1 PR**。
  既存の作業ブランチがあればそれを使い、無ければ手順どおり切る。
- 破壊的操作（push 等）や外部公開（PR 作成）は、ユーザーの承認を得てから行う。
- **ブランチ前提（PR 運用時）**：PR は作業ブランチからデフォルトブランチへ作成する。
  作業開始時（`aidev-00-start` 手順6）にブランチを用意していない場合、コミット前に
  PJ 規約に沿って作業ブランチを切る（デフォルトブランチへの直接コミットを避ける）。
  trunk-based 等ブランチを使わない PJ ではこの限りでない。

## 完了の目安

- 変更がコミットされ、PJ 運用に沿って PR 等で着地している。
- `state.yml` の `approved` に `deliver` が記録されている。
