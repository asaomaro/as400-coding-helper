# 計画: CLコマンド定義JSONの拡充（P1=制御構造バッチ）

## 実装方針

spec の決定（D2）に従い、本 PR では **全85件を backlog に分類追記**したうえで、**優先カテゴリ P1（制御構造・21件）を
全件**原典照合済みで実装する。残りカテゴリ（P2–P10）は backlog `[ ]` で残し、後続 `aidev-util-batch` が消化する。

実装順序:

1. backlog に85件を P1–P10 で分類追記（追跡基盤を先に作る）。
2. 構造検証スクリプトを用意（以降の各定義をパース＆スキーマ適合で機械チェックできる土台）。
3. P1 を 4 サブバッチ（プログラム境界・条件分岐・ループ・サブルーチン/呼び出し）で定義作成。
   各サブバッチは原典 `docs/origin/cl/<CMD>.html` を主エージェントが直読し、マッピング規約で JSON 化。
4. P1 全21件を原典と機械 diff 照合（パラメータ集合・必須・型・長さ・定義済み値）。
5. 構造検証を全 green にし、backlog の実装分を `[x]` 更新。

> 各定義は `vscode-extension/resources/prompter/cl/<CMD>.json`。スキーマは `src/prompter/types.ts`。
> 既存 `cl/CALL.json` のトーン・構造に合わせる。

## 作業順序と依存関係

```mermaid
flowchart TD
  T1[T1 backlog 85件分類追記] --> T8
  T2[T2 構造検証スクリプト] --> T3 & T4 & T5 & T6
  T3[T3 P1: PGM/ENDPGM/RETURN/GOTO] --> T7
  T4[T4 P1: IF/ELSE/SELECT/WHEN/OTHERWISE/ENDSELECT] --> T7
  T5[T5 P1: DO/ENDDO/DOWHILE/DOUNTIL/DOFOR/ITERATE/LEAVE] --> T7
  T6[T6 P1: SUBR/ENDSUBR/CALLSUBR/CALLPRC] --> T7
  T7[T7 P1全21件 原典diff照合] --> T8
  T8[T8 検証green & backlog [x]更新]
```

1. T1 backlog 追記（依存: なし）
2. T2 構造検証スクリプト（依存: なし）
3. T3–T6 P1 定義作成（依存: T2）
4. T7 原典 diff 照合（依存: T3–T6）
5. T8 検証 green ＆ backlog 更新（依存: T1, T7）

## リスク / 留意点

- **原典の取りこぼし**: 要約表だけでなく各パラメータ詳細節も読む。定義済み値の固定/混在判定を誤らないよう
  原典文言（「単一値」「その他の値」「要素リスト」）に忠実に。→ T7 で主エージェントが機械 diff。
- **無パラメータ判定**: 要約表が無い＝`parameters: []`。誤って空表を見落とさないよう本文を確認。
- **languageId 波及（AGENTS.md）**: `contributes`/言語登録/`fileScope.ts` には触れない。データ追加のみ。
- **ローダーの無言スキップ**: 不正 JSON は F4 候補から黙って消える。→ T2 の構造検証を硬いゲートに。
- **スコープ膨張**: P1 を超えて P2 以降に手を広げる場合も、未完カテゴリは backlog `[ ]` を維持し PR を肥大化させない。

## テスト方針（test 工程の入力）

1. 構造検証スクリプトで全 `cl/*.json`（既存＋新規）が JSON パース可能・`PrompterDefinition` 適合。
2. 主エージェントが P1 実装分を原典生テキストと機械 diff（必須/型/長さ/定義済み値）。
3. 既存 `test/unit/prompterModel.test.ts` 等への非回帰（基盤不変のため影響なし想定）。
4. 代表1件（IF など）の手動 F4 スモークは推奨記録（autonomous の必須ゲートは 1–2）。
