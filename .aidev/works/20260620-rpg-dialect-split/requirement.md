# 要件: RPG方言(ILE / RPG III)対応の基盤整備

関連 issue: #18 / 後続の前提: #19（RPG仕様書定義の支援skill）

## 背景 / 課題

現状、RPG 固定長サポートは**方言(dialect)の次元を持たない**。

- `.rpgle` と `.rpg` がともに同一言語ID `rpg-fixed`（`vscode-extension/package.json`）。
- 仕様書JSON（プロンプター定義）は `vscode-extension/resources/prompter/rpg/` に
  **フラット配置**（D-SPEC / C-SPEC / C-NEW / H-SPEC）され、`keyword` で読み込まれる
  （`src/prompter/jsonDefinitions.ts` の `loadForLanguage`）。
- `src/prompter/positionResolver.ts` が桁位置から `{language, keyword}` を解決する（方言非対応）。
- 固定長リファレンス doc は ILE 版（`docs/ILE_RPG_Fixed_Format_Reference.md`）のみで RPG III の記述がない。

RPG III(RPG/400) は ILE RPG と**仕様書の種類も桁レイアウトも異なる**（ILE の D-spec に対し RPG III は
I/E-spec でデータ定義、C-spec の桁位置も別、等）。同一定義では両立できないため、**方言で分離する基盤**が要る。
本作業は RPG III 対応の土台であり、RPG仕様書定義の支援skill（#19）の前提でもある。

## 目的 / ゴール

RPG 固定長の定義・桁解決を**方言(ILE / RPG III)で分離**し、拡張子から方言を判定できる基盤を整える。
既存 ILE の挙動は不変（後方互換）に保ちつつ、**RPG III の最小1定義（代表として C-spec）が拡張子 `.rpg` から
end-to-end で選択・表示される**ところまでを動く形で示す。

## スコープ

### 対象

- **定義の方言別分離**: `resources/prompter/rpg/` を `rpg/ile/` と `rpg/rpg3/` に分割し、
  既存4定義（D-SPEC / C-SPEC / C-NEW / H-SPEC）を `ile/` へ移設する。
- **方言判定**: 拡張子で決定（`.rpgle`→ile / `.rpg`→rpg3）。曖昧な `.rpg` 運用向けに**設定で上書き可能**にする。
- **loader の方言対応**: `loadForLanguage` 相当が dialect を受け取り、方言別ディレクトリ（および
  ワークスペース上書きパス）から定義を読む。
- **positionResolver の方言対応**: 方言別の桁マップ（spec letter 位置・opcode 桁・コメントmarker 等）で
  `{language, keyword}`（必要なら dialect も）を解決する。
- **RPG III 最小1定義**: RPG III の代表的な1仕様書（C-spec を想定）の定義JSONを、**IBM原典の生テキストと
  照合**して作成し、`rpg/rpg3/` に置く（AGENTS.md「開発時の検証規約」準拠）。
- **バックログの方言明記**: 既存 RPG バックログ（`.aidev/backlog/rpg-spec.md`）を **ILE スコープと明記**し、
  RPG III 用のバックログ枠を別途用意する（当面空でも可）。

### 対象外

- **RPG III の全仕様書定義**（I/E/O 等の網羅）。最小1定義を除き #19 以降で扱う。
- **RPG III フル固定長リファレンス doc**（`docs/RPG3_Fixed_Format_Reference.md`）の作成。
  → 別 issue に送る（本作業では最小1定義に必要な桁の確認に留め、フル doc は作らない）。
- 構文ハイライト / 診断 / 編集キーバインドの方言対応（表示・プロンプター以外）。
- `.rpg` の言語登録自体の変更（既に `rpg-fixed` 同居済み。本作業は dialect 次元の追加のみ）。

## 機能要件

- `.rpgle` を開くと **ile 定義**、`.rpg` を開くと **rpg3 定義**が選択される。
- 設定により方言を上書きできる（`.rpg` を ile 扱いする等）。
- RPG III の最小1定義（C-spec）が `.rpg` から F4 プロンプター/桁解決で正しく機能する。
- 既存4定義は `ile/` 配下で従来どおり読み込まれ、ILE の桁解決・プロンプターが回帰しない。

## 非機能要件 / 制約

- **後方互換**: 既存 ILE 挙動（`.rpgle` のプロンプター・桁解決・既存4定義）を変えない。
- **原典照合**: RPG III 定義・桁マップは IBM 原典（または固定長フォーマットリファレンス）の生テキストと
  機械的に突き合わせて確定する（AGENTS.md「開発時の検証規約」。主エージェントが直読、委譲しない）。
- **方言定義の一元化**: 拡張子↔方言の対応・方言別ディレクトリ規約は単一箇所で定義し二重化しない。
- 変更は `package.json` / `resources/prompter/rpg/` / `jsonDefinitions.ts` / `positionResolver.ts` /
  呼出側（`showPrompter.ts` 等）に**横断**する見込み。

## 完了条件 (受け入れ基準)

- [ ] `.rpgle` で ile 定義、`.rpg` で rpg3 定義が選択される。
- [ ] 既存 ILE 挙動は不変（既存4定義が `ile/` で従来どおり動く＝回帰なし）。
- [ ] 設定で方言を上書きできる。
- [ ] RPG III の最小1定義（C-spec）が `.rpg` から end-to-end（桁解決＋プロンプター表示）で機能する。
- [ ] RPG III 最小1定義は IBM 原典と照合済みである（照合根拠を残す）。
- [ ] 既存 RPG バックログが ILE スコープと明記され、RPG III 用バックログ枠が用意されている。

## 未確定事項 / 確認したいこと（spec / research で解消）

- RPG III の C-spec の正確な桁レイアウト（spec letter 位置・opcode/factor/result 桁・コメントmarker）。
  → **research で IBM 原典を直読**して確定する（フル doc は作らないが、使う桁は根拠を残す）。
- 方言判定の上書き**設定キー名・粒度**（ワークスペース/言語/ファイル単位か）。→ spec で決定。
- loader のワークスペース上書きパス規約（`.rpg-cl/rpg/{dialect}/` 等）と既存パスとの整合。→ spec で決定。
- `ResolvedPosition` に dialect を持たせるか、呼出側で受け渡すか。→ spec で決定。
