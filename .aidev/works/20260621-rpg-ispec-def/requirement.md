# 要件: I-SPEC（入力仕様書）プロンプター定義の新設

> 出典: backlog `.aidev/backlog/rpg-spec.md`「I-SPEC — 入力仕様書のプロンプター定義JSONを作成 (needs: #19)」。
> #19（rpg-spec-def skill）はマージ済み＝依存充足。batch（autonomous）で消化。

## 目的 / ゴール
- ILE I 仕様書のプロンプター定義 `rpg/ile/I-SPEC.json` を、原典（`docs/ILE_RPG_Fixed_Format_Reference.md`
  L503-515）準拠で新設し、F4 プロンプターで実際に開けるようにする。

## スコープ
### 対象
- `I-SPEC.json` 生成（原典の桁位置表を写像、`types.ts` 準拠）。
- **配線**: I 行が F4 プロンプター／タブナビで解決されるよう対応（ユーザー承認のもと実施。下記 decisions D1）。
### 対象外
- I 仕様のフィールド明細行専用プロンプト（代表行＝レコード行を対象）。rpg3 の I-SPEC。

## 完了条件
- [ ] `I-SPEC.json` が原典 L503-515 と桁一致・`types.ts` 準拠・JSON パース可。
- [ ] I 行が ruler 表示と F4 プロンプター双方で解決される（`tsc` クリーン）。
- [ ] backlog の I-SPEC を `[x]` 化。
