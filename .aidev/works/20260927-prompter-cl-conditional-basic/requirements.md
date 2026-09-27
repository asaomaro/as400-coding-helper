# 要件: CL の条件表示の欄を基本の画面に出す・説明の箇条書きを落とさない（P17）

## 背景 / 課題
2026-09-27 の実操作調査（`docs/research/20260927-f4-prompter-exploration/findings.md` の P17）で、DCL の LEN / VALUE が F10（追加パラメーター）の奥にあり、
LEN のヘルプは「最大長は次の通りです。」の後の一覧が抜けていた。
- `basic`（基本の画面の欄）は実機の F4 の実測（`cl-prompt-groups.json`）だが、実測は TYPE が空の状態で取ったため、条件表示（PMTCTL）で隠れていた LEN / VALUE が抜けていた。
  CDML では F10 の欄は `PmtCtl="PMTRQS"`、条件表示の欄は `PmtCtl="PMTCTL"` と区別されている。
- 説明の抽出（`generate-cl-definitions.mjs`）が `<p>` だけを拾い、`<ul>` の一覧を落としていた。

## 完了条件 (受け入れ基準)
- [ ] AC1: CDML で `PmtCtl="PMTCTL"` の欄は、実測のあるコマンドで基本の画面の欄になる（DCL の LEN / VALUE）（単体テスト）。
- [ ] AC2: パラメーターの説明に原典の箇条書きが原典の順で入る（DCL の LEN の最大長の一覧）（単体テスト）。
- [ ] AC3: 生成物の差分は `basic` と `help` だけ。CL の原典照合（日英）・CDML の検査・原典の使用例の往復が通る。
