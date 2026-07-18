---
name: rpg-spec-def
description: RPG固定長仕様書(H/F/D/I/C/O/P)のプロンプター定義JSONを、固定長フォーマットリファレンスの原典を正として作成・検証する。「<X>-SPECの定義JSONを作って」「RPG仕様書定義を作成」「F仕様書の定義を作って」などのとき、または aidev ワークフローの research/coding 工程から委譲されたときに使用する。
allowed-tools: [Bash, Read, Write, WebSearch]
---

RPG 固定長仕様書（H/F/D/I/C/O/P）の**プロンプター定義 JSON**を、**固定長フォーマットリファレンスの原典を正**
として作成・検証する PJ固有 skill。CL の `cl-command-def` に対応する RPG 版で、aidev ワークフローの実作業
（research での桁位置取得、coding での JSON 生成）を担う。**固定長フォーマットのみ対応**（free format 非対応）。

## 出力先・スキーマ

- 出力: `vscode-extension/resources/prompter/rpg/<dialect>/<X>-SPEC.json`
  - `<dialect>` = `ile`（RPG IV・既定）／ `rpg3`（RPG III / RPG/400）。**桁位置は方言で異なる**ため別ファイル。
  - `<X>` = 仕様書タイプ（`H`/`F`/`D`/`I`/`C`/`O`/`P`）。C は旧形式 `C-SPEC` と新形式 `C-NEW` を別定義にする
    （古い命令 MOVEL と新しい命令 EVAL で記述位置が異なるケースに対応）。
- **スキーマの正は型定義 `vscode-extension/src/prompter/types.ts`**（`PrompterDefinition` /
  `ParameterDefinition`）。作成前に必ず読むこと。実例として既存 `rpg/ile/{H,C,D}-SPEC.json`・`rpg/rpg3/C-SPEC.json`
  を参照する（positional な例＝D-SPEC、keyword 方式の例＝H-SPEC）。
- 構造:
  - トップ: `keyword`(=`"<X>-SPEC"`), `description`, `help`, `parameters[]`
  - パラメータ: `name`, `description`, `help`, `inputType`(`text`|`dropdown`|`number`|`group`),
    `required`(bool), **`sourceStart`/`sourceLength`（固定長ソース上の1始まり桁位置。初期値取得と書き戻しに使用）**,
    `attributes`{`characterSet`(`alpha`|`alnum`|`upper`|`any`), `numericOnly`, `minLength`, `maxLength`},
    `placeholder`, `maxOccurrences`(可変), `options[{label,value}]`(dropdown の選択肢), `children[]`(group の下位),
    `visibleByDefault`, `defaultValue`
- **固定の定義済み値のみを取る欄（ファイル・タイプ I/O/U/C 等）は `inputType:"dropdown"` ＋ `options[]` を使う**
  （help 列挙で済ませない）。固定値＋自由入力が混在する場合は `text`＋help。

## 原典の参照（正の取得元）— **方言で非対称**

固定長の桁位置・定義済み値は、必ず**原典の生テキストを直読**して確定する。原典はローカルかオンラインかが方言で異なる。

### ile（RPG IV）— ローカル原典を直読
- 一次資料: **`docs/ILE_RPG_Fixed_Format_Reference.md`**。対象仕様書の「<X>仕様書 / 桁位置」節を `Read` で直読する。
- 各仕様書の「桁位置」表が `sourceStart`/`sourceLength` の正。定義済み値の表（17桁目ファイル・タイプ 等）が `options` の正。

### rpg3（RPG III / RPG/400）— **ローカルにフル原典が無い**
- リポジトリにフル RPG III 固定長リファレンス doc は**存在しない**（C 仕様の桁のみ既存 `rpg3/C-SPEC.json` と
  `.aidev/works/20260620-rpg-dialect-split/research.md` F5 に照合根拠がある）。
- それ以外の rpg3 仕様書を作るには**オンライン原典を取得して直読**する:
  - 取得方法は `cl-command-def` と同様（IBM Documentation は WebFetch/curl 不可 → **Playwright + headless ブラウザで
    描画取得**）。原典例: IBM RPG/400 Reference / 固定長フォーマットリファレンス（RPG II/III 演算仕様書フォーム）。
    ```js
    // /tmp/fetch-ibm.mjs（cl-command-def と同じ）
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
    準備: `cd /tmp && npm i playwright && npx playwright install chromium`。
    `node /tmp/fetch-ibm.mjs "<URL>" > /tmp/rpg3-<x>.txt` → 出力を `Read` で読む。
  - `WebSearch` は正式ページURLの特定にのみ補助利用してよい（本文の正は描画取得テキスト）。
- **原典に到達できない場合は生成を中止し「原典未到達のため保留」と報告する。桁位置を推測で補完しない**
  （AGENTS.md「開発時の検証規約」: 原典の生テキスト照合で確定する）。

## RPG仕様 → JSON マッピング規約

| 固定長仕様 | JSON |
|---|---|
| 定位置欄（桁 N-M） | `sourceStart: N`, `sourceLength: M-N+1` |
| キーワード方式の欄（H 全体／F・P・D の 44-80 キーワード欄） | キーワード単位の `parameter`（**`sourceStart` を付けない**。桁固定でないため） |
| 必須欄 | `required: true` |
| 固定の定義済み値の集合（I/O/U/C・E/F・H/D/T/E・B/E 等） | `inputType:"dropdown"` ＋ `options[{label,value}]` |
| 修飾名・要素リスト（LIB/OBJ・ELEM 相当） | `inputType:"group"` ＋ `children[]` |
| 文字型（NAME 等、英大文字のみ） | `inputType:"text"`, `attributes.characterSet:"upper"`, `attributes.maxLength` |
| 数値欄（レコード長・長さ・小数桁 等） | `inputType:"number"`, `attributes.numericOnly:true`, `attributes.maxLength` |
| 複数指定可（最大 N） | `maxOccurrences: N` |
| 欄の説明 | `description`(短) ＋ `help`(詳細・日本語) |
| 末尾コメント欄 | `COMMENT` パラメータ（既存定義の慣行に合わせる） |

> CL の `cl-command-def` は当時スキーマに enum 欄が無く「help 列挙」だったが、本スキーマは `dropdown`+`options` を
> 持つため、RPG では固定値を **dropdown で表現する**（この点は cl-command-def と異なる）。

### I / O 仕様書の行種の扱い

I/O 仕様書は1レコードに複数の行種を持つ（I=レコード識別行／フィールド行、O=見出し/明細/合計行＋フィールド行）。
**本 skill の定義は、桁位置表が示す「レコード行（代表行）」を対象**にする（リファレンスの桁範囲がこれ）。
フィールド明細を1フィールドずつ書く行の専用プロンプトは対象外（必要になれば別仕様種別として後続で追加）。
生成する定義の `help` にこの前提を明記する。

## 手順

1. 対象の仕様書タイプ `<X>` と方言 `<dialect>` を確認する。
2. `types.ts` と既存の `rpg/<dialect>/*.json`（同型の実例）を読む。
3. 原典を取得して桁位置・定義済み値を抽出する（「原典の参照」: ile=ローカル直読／rpg3=オンライン取得＋直読）。
   出典（doc の節・行 or URL）を控える。**rpg3 で原典未到達なら保留して報告**。
4. 既存定義をテンプレに、マッピング規約に従って JSON を組み立てる。
5. 検証:
   - JSON としてパース可能（`node -e "require('./<path>')"` 等）。
   - 既存 `rpg/**/*.json` と同じ構造・キー名になっている。
   - 各欄の `sourceStart`/`sourceLength`・`required`・`options` が**原典の桁位置表と一致**している。
   - **正誤の確定は原典の生テキストを直読して行う**（要約・知識・grep の取りこぼしに頼らない）。
     桁位置・必須・定義済み値は**原典の生テキストと機械的に突き合わせ**る。
     **この照合はサブエージェントに委譲せず主エージェントが実施する**（委譲先の権限劣化で原典照合が
     できないと幻覚的な指摘になるため。protocol §2.6 / AGENTS.md「開発時の検証規約」）。
6. `vscode-extension/resources/prompter/rpg/<dialect>/<X>-SPEC.json` に書き出す。

## languageId への非波及（注意）

本 skill は JSON 生成のみを行い、`package.json` の `contributes.languages`（拡張子↔言語の関連付け）・
`activationEvents`・言語登録には**触れない**。よって languageId 連動の診断/キーバインド/補完への波及は無い
（AGENTS.md「languageId / アクティベーション変更時の下流波及チェック」の対象外）。

## aidev ワークフローとの関係

- **research 工程**から委譲された場合: 手順1–3（原典の取得・桁位置/定義済み値の抽出）を行い、結果を research.md 用に返す。
- **coding 工程**から委譲された場合: 手順4–6（JSON 生成・検証・書き出し）を行う。
- 単独起動の場合: 手順1–6を通して実施する。
- `aidev-util-batch` は `.aidev/backlog/rpg-spec.md`（ile）・`rpg3-spec.md`（rpg3）の各項目を本 skill に委譲して消化する。

> ### 既知のギャップ: 原典スナップショットに桁表が無い
> `docs/origin/ilerpg/*.html` は取得済みだが **`<table>` を1つも含まず、桁位置の
> 一覧表が捕れていない**（JS 描画の待機不足）。そのため RPG 定義の桁位置は
> 原典照合ができていない。桁を確定・修正する作業に着手する前に、まず原典を
> 再取得すること（`<table>` の描画を待つ）。知識や推測で桁を書き換えてはならない。
> 往復検証（`npm run verify:roundtrip`）は「読み書きで同じ桁を使う」ことしか
> 見ないため、桁が誤っていても通る。
