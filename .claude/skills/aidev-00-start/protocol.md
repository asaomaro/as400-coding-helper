# 開発ワークフロー共通プロトコル

すべての `aidev-*` 工程 skill が従う共通規約。この harness は `.claude/skills/aidev-*` だけで
自己完結し、PJ 固有ファイル（AGENTS.md / CLAUDE.md / docs 等）には依存しない。

各工程 skill は開始時にこのファイル（`../aidev-00-start/protocol.md`）を読み、ここの規約に従う。

## 0. 構成と運用方針

- harness 本体: `.claude/skills/aidev-00-start/` 〜 `aidev-90-retro/`（任意工程 research/design/walkthrough/retro を含む）
  - `aidev-00-start/protocol.md`: この共通プロトコル（定義のホーム）
  - 各工程の手順は、その工程の `SKILL.md` 内にインラインで定義する
- 実行時状態: `.aidev/`（リポジトリ内に生成）
  - `.aidev/current`: 現在作業中の works フォルダ名（ポインタ）
  - `.aidev/works/<YYYYMMDD-slug>/`: 作業単位ごとのフォルダ。成果物と `state.yml` を格納
    - 命名規約: **`<YYYYMMDD>-<slug>`**。日付プレフィックスは `date -u +%Y%m%d`（UTC）。
      slug は kebab-case・英小文字。同日・同 slug が既存なら末尾に `-2`,`-3`… を付けて一意化する。
      （日付プレフィックスは時系列ソート・可読性・並行作成時の衝突回避を両立する）

### 運用方針（推奨）

- 迷ったとき・再開時は `aidev-00-start` から始めるのを推奨する。
- ただし各工程 skill は単独でも実行できる（このプロトコルを自身で参照し、前提を自己チェックする）。
  慣れた利用者は `/aidev-40-coding` のように直接工程を叩いてもよい。

## 1. 対象作業の特定

- 各工程は開始時に `.aidev/current` を読み、対象の works フォルダを確定する。
- `.aidev/current` が無い、または指す先が存在しない場合は工程を実行せず、`aidev-00-start` を案内する。
- 対象確定後、`metrics.yml` に **start イベント**を追記する（「8. メトリクス記録」参照）。

## 2. 前提チェック

- 工程番号の順序ではなく、必要な成果物ファイルの有無で開始可否を判断する。
- 前提成果物が無ければ実行を中止し、不足している前工程を提示する。
- 各工程の前提成果物は、その工程 skill に記載する。

## 2.5 PJ資産の優先（実作業の委譲）

この harness は開発フローの制御と進捗管理に責任を持ち、実作業の「やり方」は
可能な限りプロジェクト(PJ)固有の資産に委ねる。各工程は実作業に入る前に次を確認する。

- **規約・観点（知識）**：PJ のルール（AGENTS.md 等、エージェントが自動読込する指示）が
  あれば、それを当該工程の判断基準として優先する。
- **実行可能な skill / コマンド**：その工程に関連する PJ固有 skill やコマンドが存在すれば、
  それを優先して実作業に用いる（例: review→PJのレビュー skill、test→PJのテストコマンド、
  完了時のコミット/PR→PJの該当 skill）。
- いずれも無ければ、各工程 skill のジェネリック手順にフォールバックする。
- 採用の有無にかかわらず、ゲート・state 記録・遷移の制御は常に基盤(protocol)が担う。
- PJ 側の事前宣言・設定は不要。存在すれば自動的に優先する。

## 2.6 重い工程の委譲（任意・指示ベース）

重く対話の少ない工程は、サブエージェントに委譲してよい。委譲は特定ツールに依存させず、
「サブエージェントに委譲する」という意図として扱い、各エージェントが自身の機構で実現する。

- **委譲してよい工程**：coding / test / review など、重く対話の少ない工程。
  委譲先は対象 works フォルダ（`.aidev/works/<YYYYMMDD-slug>/`）を読み書きし、結果サマリを返す。
  これにより主エージェントの context を圧迫しない。
- **委譲しない工程**：requirement はユーザーとの対話が必要なため委譲しない。
- **委譲できないもの（不変条件）**：承認ゲート・遷移・state 記録は、委譲の有無にかかわらず
  必ず主エージェントが担う。サブエージェントは自律実行して結果を返すだけで、実行中に
  ユーザーへ対話的承認を求められないため。
- **フォールバック**：委譲機構を持たないエージェントでは、同一セッションでインライン実行する
  （挙動は同一）。委譲は最適化手段であり、必須ではない。

> Claude Code での実現: 各工程 skill の `allowed-tools` に `Agent` を含めることで委譲を可能にしている。
> 他エージェントでは各自の委譲機構を用いる（無ければインライン実行）。

## 3. 工程終了プロトコル

工程の成果物を生成・更新したら、必ず以下の順で終える。

1. **提示**：生成・更新した成果物を要約して提示する。
2. **承認ゲート（選択肢UX）**：`AskUserQuestion` ツールで、承認と遷移を 1 問にまとめた
   単一3択を提示する。選択肢は以下とする（`Other` による自由入力も常に可能）。
   - `承認して次工程 <論理名> へ進む`
   - `承認してここで中断`
   - `差し戻す（指摘を入力）`
   - ※最終工程 deliver では「次工程へ進む」の代わりに `承認して完了` とする。
3. **分岐**：
   - **差し戻す**：指摘を反映し、同工程をやり直す（state は変更しない）。
     `metrics.yml` に **sent_back イベント**を追記する（「8. メトリクス記録」参照）。
   - **承認（いずれか）**：対象フォルダの `state.yml` を更新する。
     - `approved` に当該工程の論理名を追記する（重複は許さない）。
     - `current` を当該工程の論理名に設定する。
     - 差し戻しで前工程に戻る場合は、無効化される後工程を `approved` から除く。
     - `metrics.yml` に **approved イベント**を追記する（「8. メトリクス記録」参照）。
   - **承認して次工程へ進む**：記録後、次工程の skill を実行する。
   - **承認してここで中断**：記録後、停止する（レジューム可能な状態で待つ）。
4. **自動で次工程を開始してはならない。** ユーザーが「進む」を選んだ場合のみ次工程へ移る。

> エージェント互換: 選択肢UXは `AskUserQuestion` に対応するエージェント（Claude Code 等）で有効。
> 非対応エージェントでは、同じ選択肢をテキストで提示し自由入力で受け付ける（挙動は同一）。

## 4. 番号と順序

- 工程番号（10 刻み）は推奨されるデフォルト順を示すもので、強制ゲートではない。
- `review → coding`、`test 失敗 → coding` 等の差し戻しは正当な遷移として許可する。
- **番号末尾の規約**：
  - **末尾 0**＝標準工程（デフォルトパイプライン。例 `aidev-20-spec`, `aidev-70-deliver`）。
  - **末尾 5**＝任意・差し込み工程（必要時のみ。例 `aidev-15-research`）。
    任意工程は description 冒頭に「（任意）」を付ける。

## 4.5 任意工程の起動（ユーザー指定 / AI検知＋推奨）

任意工程（末尾5）は次の2経路で起動する。いずれも自動遷移はせず、ゲートでユーザーが選ぶ。

- **ユーザー指定**：ユーザーが明示的に当該工程を選ぶ。
- **AI検知＋推奨**：直前工程の終了時に、AI が不足を検知して遷移ゲートで推奨する。
  - 例（research）：requirement 終了時に「調査で解消すべき未確定事項が残る」「未検証の既存挙動に
    依存する」「実現性が未確認」「影響が横断的」のいずれかを検知したら、遷移ゲートの選択肢に
    `承認して research(任意) を挟む`（推奨）を加え、推奨理由を添える。
  - 例（design）：spec 終了時に「複数コンポーネントにまたがる」「アーキ判断が必要」「インターフェース/
    データモデルが複雑」「plan で分解するには設計が粗い」のいずれかを検知したら、遷移ゲートの選択肢に
    `承認して design(任意) を挟む`（推奨）を加え、推奨理由を添える。
  - 例（walkthrough）：review 終了時に「差分が大きい」「複数モジュール横断」「処理フローが複雑」の
    いずれかを検知したら、遷移ゲートの選択肢に `承認して walkthrough(任意) を挟む`（推奨）を加え、
    推奨理由を添える。
  - 検知は推奨に留め、強制しない。ユーザーが却下すれば次の標準工程へ進める。

## 5. 参照規約

- skill 間・文書間の参照は番号を含めず論理名（`requirement` / `research` / `spec` / `design` / `plan` / `coding` / `test` / `review` / `walkthrough` / `deliver` / `retro`）で行う。
- これにより将来 renumber しても参照側を変更せずに済む（番号変更の影響を skill 名だけに閉じ込める）。

## 6. state.yml スキーマ

各 works フォルダ内に 1 つ置く。

```yaml
slug: <作業slug>            # 例: user-login
issue: <番号 または 省略>    # 任意。GitHub issue 連携時に使用
current: <直近で作業した工程の論理名>
approved: [<承認済み工程の論理名…>]
```

## 7. 工程一覧（論理名と推奨順）

| 番号 | 論理名 | skill | 種別 | 成果物 | 前提 |
|------|--------|-------|------|--------|------|
| 10 | requirement | aidev-10-requirement | 標準 | `requirement.md` | （新規） |
| 15 | research | aidev-15-research | 任意 | `research.md` | requirement.md |
| 20 | spec | aidev-20-spec | 標準 | `spec.md` | requirement.md |
| 25 | design | aidev-25-design | 任意 | `design.md` | spec.md |
| 30 | plan | aidev-30-plan | 標準 | `plan.md`, `tasks.md` | spec.md（design があればそれも） |
| 40 | coding | aidev-40-coding | 標準 | コード, tasks 更新 | plan.md, tasks.md |
| 50 | test | aidev-50-test | 標準 | テスト結果 | コード |
| 60 | review | aidev-60-review | 標準 | レビュー指摘（→ coding へ差し戻し可） | diff |
| 65 | walkthrough | aidev-65-walkthrough | 任意 | `walkthrough.md`（人間レビュー補助） | review 通過 |
| 70 | deliver | aidev-70-deliver | 標準（最終） | コミット / PR | review 通過 |
| 90 | retro | aidev-90-retro | 任意 | `retro.md`（改善提案） | 作業完了（deliver 済み） |

## 8. メトリクス記録

各 works フォルダに `metrics.yml` を置き、工程の遷移を**追記式のイベントログ**で記録する。
ループ（差し戻し）・中断/再開に耐えるよう、状態ではなくイベントを積む。各指標はここから導出する。

### 記録のタイミング

- **start**：工程開始時（「1. 対象作業の特定」で対象確定後）。
- **approved**：承認時（「3. 工程終了プロトコル」の記録ステップ）。
- **sent_back**：差し戻し時（「3.」の差し戻し分岐）。

### タイムスタンプ（＝実施日時）

- 時刻は実行時に取得する：`date -u +%FT%T%Z`（例 `2026-06-20T10:30:00Z`、UTC・ISO 8601）。
- この `ts` が各工程の**実施日時**を兼ねる（日付・時刻の両方を含む）。
- **複数工程を続けて実行する場合**も、各工程の start/approved は**実際にその工程を行った時刻**で記録する。
  まとめて同一 ts にすると工程別の所要時間が失われるため、工程ごとに `date` を取り直す。

### metrics.yml スキーマ

```yaml
events:
  - { ts: 2026-06-20T10:00:00Z, phase: requirement, event: start }
  - { ts: 2026-06-20T10:30:00Z, phase: requirement, event: approved }
  - { ts: 2026-06-20T10:31:00Z, phase: spec,        event: start }
  - { ts: 2026-06-20T11:10:00Z, phase: spec,        event: sent_back }  # 差し戻し
  - { ts: 2026-06-20T11:11:00Z, phase: spec,        event: start }      # やり直し
  - { ts: 2026-06-20T11:40:00Z, phase: spec,        event: approved }
```

### 導出できる指標（retro 等で算出）

- **各工程の経過時間**：approved − 直近の start（待ち時間・中断を含む壁時計値）。
- **手戻り回数**：同一 phase の start が2回以上（review/test→coding ループ等）。
- **差し戻し回数**：sent_back の件数（工程別）。
- **リードタイム**：最初の start 〜 deliver の approved。
- **任意工程の使用**：research / design の start 有無。

> 注意: 経過時間は承認待ち・セッション中断を含む壁時計値であり、純粋な作業時間ではない。
> 品質傾向としては**手戻り回数**の方が示唆に富む（上流工程の弱さを示すため）。

### 工程別の付加メトリクス

該当工程の `approved` イベントに `metrics` を付与する（任意キー。値が出せる工程のみ）。

```yaml
  - { ts: ..., phase: plan,   event: approved, metrics: { tasks_planned: 4 } }
  - { ts: ..., phase: coding, event: approved, metrics: { tasks_done: 4 } }
  - { ts: ..., phase: test,   event: approved, metrics: { passed: 12, failed: 0 } }
  - { ts: ..., phase: review, event: approved, metrics: { must: 0, should: 1, nit: 2 } }
```

- **plan**: `tasks_planned`（tasks.md のタスク総数）
- **coding**: `tasks_done`（チェック済みタスク数）
- **test**: `passed` / `failed`（検証結果の件数）
- **review**: `must` / `should` / `nit`（重大度別の指摘件数）

### レビュー指摘の内容（review.md）

件数だけでなく**指摘の内容**を `review.md` に残す（再発パターン分析・改善に活用）。
review 工程はラウンドごとに追記する（差し戻し後の再レビューも履歴として残す）。

```markdown
# レビュー記録

## ラウンド <n>（<ts>）
- [must] <ファイル:行> <指摘内容> / 対応: <差し戻し or 修正済 or 許容>
- [should] <…>
- [nit] <…>
（指摘なしの場合はその旨）
```

## 9. 図示（mermaid）規約

成果物では、**テキストより図のほうが明確な場合に `mermaid` で図示する**（任意・全工程共通）。

- 対象: 構造 / フロー / 関係 / 状態遷移 / 依存 など。
- 図種は内容に合わせる: `flowchart` / `sequenceDiagram` / `stateDiagram` / `erDiagram` / `classDiagram` / `gantt` 等。
- **装飾目的では使わない**。図が理解・レビューを助ける時だけ使う（walkthrough の品質原則と同じ）。
- 工程別の目安（該当すれば）:
  - research: 既存構造・呼び出し関係・影響範囲
  - spec: シーケンス・状態遷移・データモデル
  - design: アーキテクチャ/コンポーネント・class・sequence・state
  - plan: タスク依存（順序が複雑な場合）
  - walkthrough: 処理フロー（review 補助）
