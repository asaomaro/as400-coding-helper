# 要件: aidev 状況の機械抽出（status コマンド）とルーター手読みの置換

関連 issue: #24

## 背景 / 課題

`aidev-00-start`（ルーター）は現状、`.aidev/works/*/state.yml` を **AI が個別に読み込んで** 進捗
（`current` / `approved` / `dependsOn` / `ticket` 等）を要約している。works が増えるほど読み込み・
判断コストが線形に増え、トークン・レイテンシともに無駄が大きい。判断ロジック（次工程の導出・完了判定・
依存充足）も毎回 AI が再現するため、ぶれ・取りこぼしのリスクがある。

既に `.aidev/bin/aidev`（POSIX sh）/ `aidev.ps1`（PowerShell）という機械抽出 CLI が存在し、
state/metrics 更新を「単一の検証済み経路」に集約する設計になっている。状況サマリも同様に CLI へ
機械化して集約すべき。

## 目的 / ゴール

- AI による全 `state.yml` 手読みを排し、**機械抽出**に置き換える。
- `aidev` CLI に **works 横断＋backlog 未着手の状況サマリを出すコマンド**（`status`）を追加する。
- `aidev-00-start` ルーターは、その CLI 出力を使うだけにする（手読み手順を置換）。
- 併せて harness 内で AI が手作業で機械抽出・集計している**他の箇所**を調査し、機械化できるものを
  整理する（明白・低リスクなものは本作業で実装、規模が大きいものは follow-up issue 化）。

## スコープ

### 対象

- **`aidev status` コマンドの新設**（`aidev` sh ＋ `aidev.ps1` の両実装）。
  - works 走査: `.aidev/works/*/state.yml` から slug / current / **次工程（導出）** / approved /
    mode / **完了判定** / dependsOn 充足 / ticket を抽出。
  - backlog 走査: `.aidev/backlog/*.md`（`archive/` 除く）の未チェック `[ ]` 件数（`(needs: …)` 付きの
    依存待ちが分かる形）を抽出。
  - 出力は **人間可読表（既定）** と **機械向け形式（`--format` 等でパース容易な形式）** の両対応。
- **ルーター skill の置換**: `aidev-00-start/SKILL.md`「2. 作業状況の確認」の各 state.yml 手読み手順を
  `aidev status` 呼び出しに書き換える。
- **横展開の調査と一部実装**: research で harness 内の機械化候補（例: insights の集計、doctor との重複、
  依存充足判定の共通化など）を洗い出し、明白・低リスクなものは本作業で実装する。

### 対象外

- 外部トラッカー（`gh issue list` 等）の open 統合は**本作業のコア対象外**（将来拡張。advisory に留める）。
- 規模が大きい機械化候補の実装（follow-up issue 化して別 work で扱う）。
- ルーター以外の skill の大規模書き換え（必要なら個別に判断）。

## 機能要件

- `aidev status` が works を横断し、各 work について以下を機械抽出して出力する。
  - slug / ticket / mode / current / approved 一覧 / **次工程（次に行うべき論理名）** / **完了フラグ**
    （`approved` に `deliver` を含むか）/ dependsOn 充足状況（未充足は明示）。
- `aidev status` が backlog 各ファイルの未チェック件数（＋依存待ち `(needs:…)` の有無）を出力する。
- 人間可読表に加え、`--format`（または相当のフラグ）で機械パース向け（例: TSV など列区切り）を出力できる。
- ルーターは `aidev status` の出力をそのまま提示に使える（AI が個別 state.yml を読まない）。

## 非機能要件 / 制約

- **sh / ps1 両対応必須**：`aidev`（POSIX sh）と `aidev.ps1`（PowerShell）で
  **挙動・出力・終了コードを一致**させる（既存規約。`.aidev/bin/README.md`）。
- **Node 非依存**：sh は `sed`/`awk`/`grep`/`date` のみ。既存方針を踏襲。
- **legacy 耐性**：`schema` 未記載の旧 work でも壊れず一覧に出る（`verify`/`doctor` の legacy 方針と整合）。
- **YAML 読みは最小**：既存 CLI と同じくフロー形式前提の最小読み取り（`key: value` / `key: [a, b]`）。
- 出力は **UTF-8（BOM なし）・LF**（git 差分の OS 間安定）。
- 既存コマンド（new/event/approve/guard/verify/doctor）の挙動を壊さない。

## 完了条件 (受け入れ基準)

- [ ] `aidev status` が works 横断＋backlog 未着手を機械抽出して人間可読表で出力する。
- [ ] `aidev status` が機械向け形式（`--format` 等）でも出力でき、列がパース可能である。
- [ ] `aidev.ps1` の `status` が `aidev` の `status` と**出力・終了コード一致**（同一リポジトリ状態で）。
- [ ] legacy work（schema 未記載）を含めても正しく一覧化される。
- [ ] `aidev-00-start/SKILL.md` が `aidev status` を使う手順に更新され、各 state.yml 手読みが消えている。
- [ ] `.aidev/bin/README.md` のコマンド表に `status` が追記されている。
- [ ] harness 内の他の機械化候補が調査され、実装したもの／起票したものが整理されている。

## 未確定事項 / 確認したいこと

- 機械向け形式の具体（TSV / 区切り文字 / 列順）は spec で確定する。
- 横展開で実装する候補の確定は research の結果を見て spec/plan で線引きする。
