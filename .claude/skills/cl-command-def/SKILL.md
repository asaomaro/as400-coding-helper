---
name: cl-command-def
description: CLコマンドのプロンプター定義JSONを、IBM Documentation のコマンド仕様を参照して作成・検証する。「<CMD>の定義JSONを作って」「CLコマンド定義を作成」などのとき、または aidev ワークフローの research/coding 工程から委譲されたときに使用する。
allowed-tools: [Bash, Read, Write, WebSearch]
---

CL コマンドの**プロンプター定義 JSON**を、**IBM Documentation のコマンド仕様を正**として作成・検証する
PJ固有 skill。aidev ワークフローの実作業（research での仕様取得、coding での JSON 生成）を担う。

## 出力先・スキーマ

- 出力: `vscode-extension/resources/prompter/cl/<CMD>.json`
- **スキーマの正は型定義 `vscode-extension/src/prompter/types.ts`**（`PrompterDefinition` /
  `ParameterDefinition`）。作成前に必ず読むこと。実例として `cl/CALL.json` も参照（ただし
  CALL.json は一部機能しか使っていないため、使える機能は types.ts で確認する）。
- 構造:
  - トップ: `keyword`, `description`, `help`, `parameters[]`
  - パラメータ: `name`, `description`, `help`, `inputType`(`text` | `dropdown` | `number` | `group`),
    `required`(bool), `attributes`{`characterSet`, `maxLength` 等}, `placeholder`,
    `maxOccurrences`(可変), `options[{label,value}]`(dropdown の選択肢), `children[]`(group の下位)
- **定義済み値（*INFO 等）が固定の選択肢のみのパラメータは `inputType: "dropdown"` ＋ `options[]`
  を使う**（help 列挙で済ませない）。固定値＋自由入力が混在する場合は `text`＋help。

## IBM 仕様の参照（正の取得元）

- 原典: IBM Documentation の CL コマンド説明ページ
  `https://www.ibm.com/docs/ja/ssw_ibm_i_74/cl/<cmd小文字>.htm`（版は適宜）。
- **取得方法（重要）**: IBM Documentation は `WebFetch`（bot）に **HTTP 403**、かつ本文を JavaScript で
  描画する SPA のため `curl` でも本文を取れない。→ **Playwright + headless ブラウザで描画取得**する。
  - 準備: `cd /tmp && npm i playwright && npx playwright install chromium`
    （`msedge` チャネルは OS依存導入に sudo が要るため、bundled chromium を既定とする）
  - 取得スクリプト例（DOM描画を待って本文テキストを抽出）:
    ```js
    // /tmp/fetch-ibm.mjs
    import { chromium } from 'playwright';
    const url = process.argv[2];
    const b = await chromium.launch({ headless: true });
    const p = await b.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => document.body.innerText.length > 3000, { timeout: 45000 }).catch(()=>{});
    await p.waitForTimeout(1500);
    process.stdout.write(await p.evaluate(() => document.body.innerText));
    await b.close();
    ```
    `node /tmp/fetch-ibm.mjs "<URL>" > /tmp/<cmd>.txt` → 出力を Read で読む。
  - `WebSearch` は正式ページURLの特定にのみ補助利用してよい（本文の正は描画取得テキスト）。
- 取得すべき項目: 各パラメータの**キーワード / 定位置 / 必須・条件付き必須 / データ型・長さ / 修飾(LIB等) /
  ELEM(ネスト含む) / 反復回数 / 定義済み値(*INFO 等) / 排他関係 / 説明**。コマンド全体の用途も押さえる。

## IBM 仕様 → JSON マッピング規約

| IBM 仕様 | JSON |
|---|---|
| パラメータのキーワード | `name` |
| 必須 (REQ) | `required: true` |
| 修飾名（例 LIB/OBJ）・ELEM(要素リスト) | `inputType: "group"` ＋ `children[]` |
| 複数指定可（最大 N 値） | `maxOccurrences: N` |
| CHAR/NAME 等の文字型 | `inputType: "text"`, `attributes.characterSet`(英大文字なら `upper`), `attributes.maxLength` |
| 定義済み値（*INFO/*DIAG 等） | 現スキーマに列挙(enum)欄が無いため `help` に列挙し、代表値を `placeholder` に置く |
| パラメータ説明 | `description`(短) ＋ `help`(詳細・日本語) |

> 注意: 現スキーマには「選択肢(enum)」を表す欄が無い。定義済み値が多いコマンドでは help に明記する。
> もし enum 表現が頻繁に必要と判明したら、スキーマ拡張の提案として記録する（review/retro へ）。

## 手順

1. 対象コマンド `<CMD>` を確認する。
2. IBM Documentation から仕様を取得し、上記項目を抽出する（出典URLを控える）。
3. `CALL.json` をテンプレに、マッピング規約へ従って JSON を組み立てる。
4. 検証:
   - JSON としてパース可能（`node -e "require('./<path>')"` 等）。
   - 既存 `cl/*.json` と同じ構造・キー名になっている。
   - 各パラメータが IBM 仕様（必須/型/長さ/修飾/反復/定義済み値）と一致している。
   - **正誤の確定は IBM原典の生テキストを直読して行う**（要約・知識・grep の取りこぼしに頼らない）。
     パラメータ集合・required・定義済み値は**原典の生テキストと機械diff**で突き合わせる。
     **この照合はサブエージェントに委譲せず主エージェントが実施する**（委譲先の権限劣化で原典照合が
     できないと幻覚的な指摘になるため。protocol §2.6）。
5. `vscode-extension/resources/prompter/cl/<CMD>.json` に書き出す。

## aidev ワークフローとの関係

- **research 工程**から委譲された場合: 手順1–2（IBM仕様の取得・抽出）を行い、結果を research.md 用に返す。
- **coding 工程**から委譲された場合: 手順3–5（JSON 生成・検証）を行う。
- 単独起動の場合: 手順1–5を通して実施する。
