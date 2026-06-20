---
name: aidev-30-plan
description: AI開発ワークフローの plan（計画/作業分解）工程。spec.md から plan.md と tasks.md を作る。「計画を立てたい」「作業分解」「plan工程」などと言われたとき、または前工程から案内されたときに使用する。
allowed-tools: [Bash, Read, Write, Edit, AskUserQuestion]
---

AI 開発ワークフローの **plan（計画 / 作業分解）工程**を実行する。
spec を実装可能な作業単位に分解し、`plan.md`（方針・順序）と `tasks.md`（チェックリスト）を作る。
`tasks.md` のチェックボックスが、以降の進捗の単一の真実となる。

**開始前に共通プロトコル `../aidev-00-start/protocol.md` を読み、その規約に従うこと。**

## 前提

- `spec.md` が存在すること。無ければ実行を中止し、spec 工程を促す。

## 入力

- 対象フォルダの `spec.md`（必要に応じて `requirement.md`）。

## 出力

対象フォルダに `plan.md` と `tasks.md` を生成する。

## 手順

1. protocol.md「1. 対象作業の特定」に従い対象フォルダを確定。「2. 前提チェック」に従い `spec.md` を確認。
2. `spec.md` を読み、実装手順・依存関係・リスクを整理して `plan.md` を書く。
3. spec を独立して検証可能な小さなタスクに分解し、`tasks.md` をチェックリストで作る。
   - 各タスクは coding 工程で 1 つずつ消化できる粒度にする。
   - 依存があるタスクは順序が分かるように並べる。依存が複雑なら mermaid で図示する（protocol.md「9.」）。
4. protocol.md「3. 工程終了プロトコル」に従って終了する（次工程: `coding`）。
   承認時、`metrics.yml` の plan approved イベントに `metrics: { tasks_planned: <tasks.md のタスク総数> }` を付与する（protocol.md「8.」参照）。

## plan.md テンプレート

```markdown
# 計画: <タイトル>

## 実装方針
<spec をどの順序で・どう組み立てるか>

## 作業順序と依存関係
1. <ステップ>（依存: なし）
2. <ステップ>（依存: 1）

## リスク / 留意点
- <想定リスクと対応>

## テスト方針
- <test 工程で何をどう確認するか>
```

## tasks.md テンプレート

```markdown
# タスク: <タイトル>

- [ ] T1: <タスク内容>
- [ ] T2: <タスク内容>（依存: T1）
- [ ] T3: <タスク内容>
```

## 完了の目安

- spec の全範囲が tasks に漏れなく落ちている。
- 各タスクが「1 タスク = 1 つの検証可能な変更」になっている。
