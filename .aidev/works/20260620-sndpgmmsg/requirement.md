# 要件: SNDPGMMSG プロンプター定義JSONの作成

## 背景 / 課題
CLコマンドのプロンプター定義は `vscode-extension/resources/prompter/cl/` 配下に JSON で持つが、
現状 `CALL.json` のみ。`SNDPGMMSG`（プログラムメッセージ送信）の定義が無く、プロンプターで扱えない。

## 目的 / ゴール
IBM Documentation の SNDPGMMSG コマンド仕様を正として、既存スキーマ準拠の
`cl/SNDPGMMSG.json` を作成する。

## スコープ
### 対象
- `SNDPGMMSG` コマンド1件の定義JSON作成
- パラメータの name / 必須 / 型・長さ / グループ(修飾・ELEM) / 反復 / ヘルプ

### 対象外
- 他コマンドの定義
- スキーマ自体の変更（必要が判明した場合は提案に留める）

## 機能要件
- `keyword: "SNDPGMMSG"`、説明・ヘルプを持つ
- 主要パラメータを網羅し、必須/型/反復/定義済み値が IBM 仕様と一致
- 既存 `cl/*.json` と同一スキーマ（inputType/attributes/children/maxOccurrences）
- ヘルプは日本語

## 非機能要件 / 制約
- IBM Documentation を唯一の正とする（出典を控える）
- 既存 `cl/CALL.json` の構造・キー名に揃える

## 完了条件 (受け入れ基準)
- [ ] `cl/SNDPGMMSG.json` が JSON として妥当
- [ ] 主要パラメータが IBM 仕様（必須/型/長さ/修飾/反復/定義済み値）と一致
- [ ] 既存スキーマに準拠（CALL.json と同一キー構造）
- [ ] 各パラメータに日本語ヘルプがある

## 未確定事項 / 確認したいこと
- SNDPGMMSG の正確なパラメータ一覧・型・必須・定義済み値（→ IBM 仕様の調査が必要）
- 定義済み値（*INFO/*DIAG 等）を現スキーマでどう表現するか（enum欄が無い）
