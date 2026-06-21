# 要件: RPG III(RPG/400) 固定長仕様書のプロンプター定義拡充（issue #46）

## 背景 / 課題

- RPG 固定長仕様書のプロンプター定義は方言別に管理（#18 で分離）。`resources/prompter/rpg/{ile,rpg3}/`。
- **ILE(RPG IV)** は H/F/D/I/C/O/P ＋ C-NEW を全件定義済み（スコープ外）。
- **RPG III(RPG/400)** は **C-SPEC のみ**定義済み。H/F/I/O、および RPG III 固有の E(拡張)/L(行カウンター)が未定義。
- RPG III は固定長の**桁位置が ILE と異なる**ため流用不可。原典に基づく独立定義が必要。

## 目的 / ゴール

- RPG III 原典（`docs/origin/rpg3/`）を正として、未定義の RPG III 仕様書のプロンプター定義 JSON を作成し、
  `.rpg`（rpg3 方言）の F4 プロンプターで使えるようにする。
- backlog `.aidev/backlog/rpg3-spec.md` に対象を反映し、`aidev-util-batch` で追跡・消化可能にする。

## スコープ

### 対象（`resources/prompter/rpg/rpg3/<X>-SPEC.json` を新設）

- H-SPEC（制御仕様書）/ F-SPEC（ファイル仕様書）/ I-SPEC（入力仕様書）/ O-SPEC（出力仕様書）/
  E-SPEC（拡張仕様書）/ L-SPEC（行カウンター仕様書）。
- ※各仕様の要否・粒度は spec/research で原典の桁データ有無を見て確定する。C-SPEC は #18 で完了済み。

### 対象外

- ILE(RPG IV) 定義（全件完了済み）。free format（固定長のみ）。プロンプター実行基盤（`src/prompter/`）の機能変更。

## 機能要件

- 各仕様書について、原典に基づき固定長の**桁位置（`sourceStart`/`sourceLength`、1始まり）**・定義済み値・
  必須/型を正しく `PrompterDefinition`（`types.ts`）に反映する。
- 固定の定義済み値のみの欄は dropdown＋options、混在は text＋help。
- 既存 `rpg/rpg3/C-SPEC.json`・`rpg/ile/*`（H=keyword 例、D=positional 例）と一貫させる。

## 非機能要件 / 制約

- **桁位置の確定は主エージェントが原典を直読して機械照合**する（ILE と桁が異なり流用不可・委譲不可。
  AGENTS.md「開発時の検証規約」／`rpg-spec-def` skill の rpg3 節）。
- **原典に桁位置が無い／到達できない仕様は推測で補完せず「原典未到達のため保留」**とする（skill 規約）。
- 原典: `docs/origin/rpg3/`（jaymoseley RPG tutorial、PR #42 収集）。rpg002=H/F/I/O、rpg006/007=C、
  rpg010=E/L、rpg011=O編集語。桁位置は散文中の範囲表記（例「positions 7-14」）として存在。
- `languageId`/`contributes`/言語登録には触れない（定義データ追加のみ）。

## 完了条件 (受け入れ基準)

- [ ] RPG III の未定義仕様書（原典に桁データがあるもの）の定義 JSON を作成し、rpg3 方言の `.rpg` で F4 から機能。
- [ ] 各定義の桁位置・項目が RPG III 原典（`docs/origin/rpg3/`）と機械照合で一致。
- [ ] `.aidev/backlog/rpg3-spec.md` に対象が反映され、batch 消化の状態が追跡できる。

## 未確定事項 / 確認したいこと（spec/research で解消）

- jaymoseley 原典が **各仕様（H/F/I/O/E/L）の桁位置を十分な精度で含むか**を spec/research で個別確認する。
  含まないものは「原典未到達のため保留」とし本作業の対象から外す（推測しない）。
- E/L 仕様の RPG III での実用頻度・粒度（最小定義でよいか）。
- 本 PR で何件まで実装するか（原典が揃うものから。残りは backlog 追跡）。
