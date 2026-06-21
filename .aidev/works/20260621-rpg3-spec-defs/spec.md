# 仕様: RPG III(RPG/400) 仕様書プロンプター定義（H/F/I/O）

## 概要

research.md の grounded 桁レイアウト（rpg002 直読）に基づき、RPG III 方言の **H/F/I/O 仕様書**の
プロンプター定義 JSON を `resources/prompter/rpg/rpg3/<X>-SPEC.json` に新設する。E/L は rpg010 直読が
必要なため本PRでは backlog 追跡に留める（原典未確定を推測補完しない方針）。

## 設計方針

- **既存 ile の同型仕様（`rpg/ile/{H,F,I,O}-SPEC.json`）と同じ構造パターン**を踏襲しつつ、**桁位置は rpg3 原典の値**を使う
  （ILE と桁が異なるため流用不可。research.md の表が正）。
- ile I-SPEC/O-SPEC のように **1仕様=1定義**でレコード/フィールド両エントリの欄を統合し、上級・低頻度欄は
  `visibleByDefault:false`。固定の定義済み値のみの欄は `inputType:"dropdown"`＋`options`、混在は `text`＋help。
- `sourceStart`/`sourceLength` は **1始まり**。`sourceLength` = (終了桁 − 開始桁 + 1)。
- 既存 `rpg/rpg3/C-SPEC.json` をスキーマ実例とする。

## 対象範囲

- 追加: `resources/prompter/rpg/rpg3/H-SPEC.json` / `F-SPEC.json` / `I-SPEC.json` / `O-SPEC.json`。
- 追加/更新: `.aidev/backlog/rpg3-spec.md`（H/F/I/O を追記し本PR分を `[x]`、E/L は `[ ]`）。
- 変更しない: `src/prompter/*`、`package.json` contributes/言語登録、`fileScope.ts`。
- **検証**: `scripts/validate-prompter-defs.mjs`（rpg も走査対象）で構造適合、桁は research.md（=原典）と機械照合。

## インターフェース / データ構造（桁マッピング）

research.md の表を `ParameterDefinition` に落とす。`sourceLength`=終了−開始+1。主な dropdown:

- **F-SPEC**: File Type(15: I/O/U)・File Designation(16: P/S/C/R/T)・Sequence(18: A/D)・File format(19: F/V)・
  Mode(28: blank/L/R) は dropdown。File Name(7-14)・Block/Record Length(20-23/24-27) は text/number。
- **I-SPEC**: File Name(7-14)・Record Indicator(19-20)・Field Begins(44-47)・Field Ends(48-51)・
  Decimal(52)・Field Name(53-58)・Control Level(59-60) 等。Packed(43: P) は単一値。
- **O-SPEC**: File name(7-14)・Type(15: H/D/T dropdown)・Space/Skip(17-22)・Indicator(24-31)・
  Field Name(32-37)・Edit Code(38)・End Position(40-43)・Constant/Edit Word(45-70)。
- **H-SPEC**: Program Name(75-80) のみ確実（最小定義）。

> 桁が原典で断片的な箇所（F-SPEC の 33-72 周辺）は実装時に rpg002 を再精読して確定する。確定できない桁は
> その欄を定義に含めず保留する（**推測補完しない**。skill / AGENTS.md 規約）。

## 振る舞い / エッジケース

- 仕様書コード（6桁目）でローダーが仕様種別を判定（既存 `specClassifier` / `positionResolver` の仕組み）。
  rpg3 方言は拡張子→dialect 導出で `rpg/rpg3/` を読む（#18 の基盤、既存どおり・変更不要）。
- I/O はレコード行とフィールド行で使う欄が異なるが、桁が重ならないため ile 同様 1定義に統合して表現する。

## エラー処理 / 異常系

- ローダーは不正 JSON を console ログでスキップ → 構造検証スクリプトを硬ゲートに（壊れた定義を deliver させない）。
- 原典に桁の無い欄は定義しない（保留）。research.md に保留理由を残す。

## 受け入れ基準との対応

| 完了条件 | 充足 |
|---|---|
| ① 未定義仕様の定義作成・F4 機能 | H/F/I/O を作成。F4 機能性はロード可能性（構造検証＋スキーマ適合）で代理担保（headless 実機不可） |
| ② 桁・項目が RPG III 原典と一致 | 主エージェントが research.md（=rpg002 直読）と各定義を機械照合 |
| ③ backlog 反映・追跡 | rpg3-spec.md に H/F/I/O/E/L を追記、本PR分 `[x]`、E/L `[ ]` |

## design 推奨判定（autonomous 自律採否）

- 新規アーキ判断なし。既存 ile 定義パターン＋確立スキーマに乗るデータ整備。→ design 不要、plan へ。
