# 逸脱・判断記録

## metrics 記録漏れ（CLI 呼び出しスキップ）

本 work の進行中、主エージェントが `aidev` の一部 event/approve 呼び出しをスキップした。
全工程の**ゲート承認はユーザーが実施済み**だが、CLI 記録が欠落している。

- 欠落イベント（`metrics.yml`）: `plan approved` / `test approved` / `coding start` / `review start`。
- 影響: 本 work の **phase 別所要時間・rework 検出が一部欠落**（lead time と deliver は記録あり）。

### 対応方針（protocol「8. メトリクス記録」に従う）
- protocol は「過去分の timestamp を**捏造して埋めない**。欠落は『記録漏れ』という事実として残す」と規定。
  → **metrics.yml の過去イベントは後追い捏造しない**（このファイルに事実として記録）。
- `state.yml` の `approved` は timestamp でなく**状態（ゲート承認の集合）**であり、plan/test も実際に
  ユーザー承認済みのため、正確性のため pipeline 順に補正した（`[requirement, spec, plan, coding, test, review, deliver]`）。

### 再発防止
- 各工程開始時 `aidev event <工程> start`、承認時 `aidev approve <工程>` を**漏れなく**呼ぶ。
  特に gate 承認後に次工程へ進む前に当該工程の approve を確実に記録する。
