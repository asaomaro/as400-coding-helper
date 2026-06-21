# レビューガイド: CLコマンド定義JSONの拡充（P1=制御構造21件 / issue #43）

## 変更概要 / 目的

PR #42 で収集済みの IBM 原典HTML（`docs/origin/cl/`）を**正のソース**として、未定義 CL コマンドの
プロンプター定義 JSON を作成する作業（issue #43）。本 PR は優先カテゴリ **P1（制御構造）21件**を実装し、
残り64件を含む全85件を backlog に分類追記して後続 `aidev-util-batch` で追跡可能にした。

- 新規定義: `vscode-extension/resources/prompter/cl/*.json`（21件）
- 新規ツール: `vscode-extension/scripts/validate-prompter-defs.mjs`（構造検証）
- backlog: `.aidev/backlog/cl.md`（85件を P1–P10 分類、P1 を `[x]`）

## 重要ポイント（特に見てほしい所）

1. **原典ソースをローカルHTMLに差し替え**（[decisions.md](./decisions.md) D1）。skill `cl-command-def` は本来
   IBM Documentation を Playwright でライブ取得するが、本作業は出典固定済みのローカル原典
   `docs/origin/cl/<CMD>.html` を主エージェントが直読して照合。マッピング規約・検証規約は skill に従う。
2. **マッピングの肝＝定義済み値の扱い**（skill 規約）:
   - 固定選択肢のみ → `dropdown`＋`options`。本 PR では **CALLPRC の受け渡し（*BYREF/*BYVAL）**のみ該当。
   - 固定値＋自由入力の混在 → `text`＋`help`＋`defaultValue`。**ITERATE/LEAVE の `*CURRENT`、
     ENDSUBR の `0`、CALLSUBR/CALLPRC RTNVAL の `*NONE`** が該当。
   - 論理式・コマンド文字列（IF/WHEN/DOWHILE 等の COND/THEN/CMD）は自由入力 → `text`。
3. **無パラメータコマンドは `parameters: []`**（ENDPGM/RETURN/SELECT/ENDSELECT/DO/ENDDO）。原典の
   「このコマンドには，パラメーターはありません」を確認して空配列にしている。
4. **唯一の複合構造 = CALLPRC PARM**（要素リスト）: `group`＋`children:[PARM(値), PASSING(受け渡し)]`、
   `maxOccurrences: 300`。原典「要素1: パラメーター / 要素2: 受け渡し *BYREF/*BYVAL（最大300反復）」に対応。

## 処理フロー（定義1件あたりの作成・検証フロー）

```mermaid
flowchart TD
  A[docs/origin/cl/&lt;CMD&gt;.html] -->|主エージェント直読・タグ除去| B[パラメーター要約表 + 各詳細節]
  B -->|cl-command-def マッピング規約| C[&lt;CMD&gt;.json 作成]
  C --> D{validate-prompter-defs.mjs}
  D -->|PrompterDefinition 適合| E[原典 機械diff<br/>集合/必須/反復/定義済み値]
  E -->|21/21 一致| F[backlog [x] 更新]
  D -.->|不適合| C
  E -.->|差異| C
```

## 主要な変更箇所

- `vscode-extension/scripts/validate-prompter-defs.mjs:1` — 全 `cl/*.json`（＋rpg）をパース＋`PrompterDefinition`
  スキーマ適合で機械検証する独立ツール。ローダー（`jsonDefinitions.ts`）が不正 JSON を無言スキップする
  ため、壊れた定義を deliver させない硬いゲートとして追加。
- `vscode-extension/resources/prompter/cl/CALLPRC.json:1` — 本 PR で唯一の group＋dropdown を含む複合定義。
  受け渡し要素の `name` は既存の group 子要素慣例（英大文字識別子）に合わせ `PASSING`（review nit 修正）。
- `vscode-extension/resources/prompter/cl/IF.json:1` / `WHEN.json` — COND（必須・論理式）/THEN（任意・コマンド）。
  制御構造の代表形。
- `.aidev/backlog/cl.md` — 85件を P1–P10 分類追記。P1 を `[x]`、P2–P10 は `[ ]`（後続 batch 対象）。

## リスク / 確認してほしい点

- **F4 の実動作は headless 未検証**（[decisions.md](./decisions.md) D3）。受け入れ①は「JSON が
  `PrompterDefinition` 適合・キーワード照合でロード可能」を代理指標として担保。VSCode 統合テスト
  （`test/integration/f4Prompter.test.ts`）は `@vscode/test-electron` ダウンロードが必要で本環境では未実行。
  → マージ後に IF / CALLPRC など代表数件を実機 F4 でスモーク確認いただけると安心。
- **スコープは P1 のみ**（[decisions.md](./decisions.md) D2）。残り64件は backlog `[ ]` で追跡。本 PR を
  85件で肥大化させない判断。
- **論理式系パラメータに長さ制約を置いていない**（COND/THEN/FROM/TO 等）。式・変数・定数を許容するため
  意図的に `attributes.maxLength` 未設定。原典に固定長の定めがないことを確認済み。
