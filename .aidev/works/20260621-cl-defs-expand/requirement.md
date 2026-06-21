# 要件: CLコマンド定義JSONの拡充（原典HTML→JSON定義化）

## 背景 / 課題

- 本PJは VSCode 上で AS400 のコーディング（RPG/RPGLE/CLP/DDS/PRTF/CMD）を支援する拡張機能であり、
  SEU の F4 プロンプター相当の入力補助を、コマンド/仕様書ごとの JSON 定義で提供する。
- CL コマンドのプロンプター定義は現状 **10件のみ** 整備済み（`vscode-extension/resources/prompter/cl/*.json`）。
- 一方、PR #42 で IBM Documentation の CL コマンド原典 HTML を `docs/origin/cl/` に **95件** 収集済み
  （既定義10＋新規85、`docs/origin/manifest.yml` に出典URL/取得日を記録、gaps 0）。
- この原典を grounded ソースとして、**未定義の CL コマンド（差分85件）** の定義 JSON を作成し、
  CLP 編集時の F4 プロンプターで利用できるコマンドを増やすことが本作業の狙い。

## 目的 / ゴール

- `docs/origin/cl/<CMD>.html` を正とした、原典準拠で正確な CL コマンドのプロンプター定義 JSON を整備し、
  `.clp` ソース上の F4 プロンプターから利用できる CL コマンドを拡充する。
- backlog（`.aidev/backlog/cl.md`）に対象コマンドを反映し、`aidev-util-batch` で順次・追跡可能に消化できる状態にする。

## スコープ

### 対象

- `docs/origin/cl/` に原典 HTML があり、`vscode-extension/resources/prompter/cl/` に定義が**未整備の CL コマンド（85件）**。
  - 制御構造補完・メッセージ・ファイル/DB・ジョブ・スプール・作成・権限などの頻出群。
- PJ skill `cl-command-def` と `vscode-extension/src/prompter/types.ts` 準拠でのマッピング・検証。
- backlog `.aidev/backlog/cl.md` への対象コマンド追記（batch 消化の状態追跡）。

### 対象外

- ile（ILE RPG 系）／rpg3 の定義（別 issue）。
- 原典 HTML の追加収集（PR #42 で完了済み。本作業は既収集分を消費する）。
- プロンプター実行基盤（`src/prompter/` のレンダリング/バリデーション実装）自体の機能拡張。
  既存スキーマ（`types.ts`）の範囲で定義データを作る。
- free format（自由記述）対応など、CL 以外の仕様変更。

## 機能要件

- 各 CL コマンドについて、原典に基づき以下を定義 JSON に正しく反映する:
  - パラメータ集合（過不足なし）、必須/任意（required）、属性（文字/数値）、長さ/桁、定義済み値（候補値）。
  - グルーピング（例 `FILE(LIBL/FILE)` のライブラリ＋ファイル）やコマンド/パラメータのヘルプが原典にあれば反映。
  - 可変パラメータ（入力項目の増減）が原典にあれば定義で表現。
- 定義は `vscode-extension/src/prompter/types.ts` のスキーマに適合する。
- `.aidev/backlog/cl.md` に未定義85件を追記し、各コマンドの消化状態（`[ ]`/`[x]`）を追跡できる。

## 非機能要件 / 制約

- **原典照合は主エージェントが実施**：`docs/origin/cl/<CMD>.html` の生テキストを直読し、必須/型/長さ/桁/
  定義済み値を機械的に突き合わせて確定する（AGENTS.md「開発時の検証規約」準拠。サブエージェントに委譲しない）。
- 既存10件の定義フォーマット・命名規約と一貫させる。
- `languageId`/アクティベーション/`contributes` には手を入れない想定（定義データの追加のみ。波及リスクを避ける）。
- autonomous モードで batch 消化し、最終的に PR を作成して停止（auto-merge しない）。

## 完了条件 (受け入れ基準)

- [ ] 優先度の高い CL コマンドから定義 JSON を作成し、`.clp` から F4 プロンプターで機能することを確認できる。
- [ ] 各定義が原典（`docs/origin/cl/<CMD>.html`）と必須/型/長さ/桁/定義済み値で一致している。
- [ ] `.aidev/backlog/cl.md` に新規対象（未定義85件）が反映され、batch 消化の状態が追跡できる。

## 未確定事項 / 確認したいこと

- 未定義85件の**正確なコマンド一覧**（`docs/origin/cl/` と既存定義の差分）を spec/research で機械的に確定する。
- 「優先度の高い」順序の基準（頻出度・制御構造優先など）を spec/plan で定める。
- 85件すべてを本作業（1 PR）で消化するか、優先度上位のバッチに区切るかの線引きを plan で決める。
- 既存10件と原典の対応（定義済み分が原典と一致しているか）の扱い：本作業の対象外（差分の新規85件のみ）でよいか。
