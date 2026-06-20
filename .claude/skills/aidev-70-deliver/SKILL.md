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
4. issue 連携があれば PR に紐付ける（`state.yml` の `issue` を参照し `Closes #<番号>` 等）。
5. protocol.md「3. 工程終了プロトコル」に従って終了する。
   - 最終工程のため、遷移確認は `承認して完了` とする。完了後、着地結果（コミット/PR の URL 等）を報告する。

## 留意点

- コミットメッセージ・PR 本文の体裁は PJ 規約（AGENTS.md・PJ skill）に従う。
- 破壊的操作（push 等）や外部公開（PR 作成）は、ユーザーの承認を得てから行う。

## 完了の目安

- 変更がコミットされ、PJ 運用に沿って PR 等で着地している。
- `state.yml` の `approved` に `deliver` が記録されている。
