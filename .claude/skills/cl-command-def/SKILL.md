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
  - トップ: `keyword`, `description`, `help`, `parameters[]`,
    `threadSafe`, `environment`, `examples[{code,note}]`, `errorMessages[{id,text}]`,
    `source{url,version,updated}`
  - パラメータ: `name`, `description`, `help`, `inputType`(`text` | `dropdown` | `number` | `group`),
    `required`(bool), `defaultValue`, `attributes`{`characterSet`, `maxLength` 等}, `placeholder`,
    `maxOccurrences`(可変), `options[{label,value,help}]`(dropdown の選択肢と値ごとの説明),
    `children[]`(group の下位。**入れ子可**), `positional`(定位置N),
    `groupKind`(`qualified` | `elements`), `singleValues[]`, `dependsOn[]`
  - コマンド単位の相関: `restrictions[]`(制約事項), `constraints[{kind,parameters,note}]`
    (`exclusive`=同時指定不可 / `together`=相互必須)
- **定義済み値（*INFO 等）が固定の選択肢のみのパラメータは `inputType: "dropdown"` ＋ `options[]`
  を使う**（help 列挙で済ませない）。固定値＋自由入力が混在する場合は `text`＋help。
- **例・エラーメッセージ・出典・制約事項は help 文字列に埋め込まず、専用欄に構造化して入れる**
  （`examples` / `errorMessages` / `source` / `restrictions`）。help に混ぜると機械検証ができなくなる。

## 原典の取得（済み。再取得は不要）

- 原典は **`docs/origin/cl/<CMD>.html` にローカル取得済み**（95件）。まずこれを使う。
- 未取得のコマンドを追加するときだけ `docs/origin/fetch-origin.mjs` で取得する。
  IBM Documentation は `WebFetch` に HTTP 403、かつ本文を JS 描画する SPA のため
  `curl` では本文が取れない（Playwright + headless chromium が必要）。

## 生成は手作業ではなくスクリプトで行う

> **重要**: 定義 JSON を LLM が読んで書き起こしてはならない。
> 原典の情報は**マークアップにしか存在しないもの**（省略時値の下線、修飾子/要素の別）を含み、
> テキスト化して読むと必ず落ちる。過去の一括生成では 66 コマンド 553 件の `defaultValue` が
> 欠落し、13 件の `required` が原典と食い違い、35 コマンドで入力欄の名前が重複していた。

```sh
node docs/origin/generate-cl-definitions.mjs [CMD ...]   # 省略時は全件。--dry-run で標準出力
node docs/origin/verify-cl-definitions.mjs   [CMD ...]   # 原典と突き合わせ。差分があれば exit 1
```

生成スクリプトが原典から決定的に決めるもの（**手で書かない**）:

| 原典 | JSON |
|---|---|
| パラメータのキーワード | `name` |
| ノーツ欄「必須」 | `required`（**末端の入力欄に落とす**。group に付けても検証されない） |
| ノーツ欄「定位置 N」 | `positional` |
| 選択項目欄の**下線付き値** | `defaultValue` |
| 「修飾子 N:」の並び | `groupKind:"qualified"` ＋ `children`（**出力順に反転**。構文は LIB/OBJ） |
| 「要素 N:」の並び | `groupKind:"elements"` ＋ `children` |
| 要素の中の修飾子 | `children` の入れ子（例: ALCOBJ.OBJ） |
| 「最大 N 回の繰り返し」 | `maxOccurrences`（group なら出力は二重括弧 `OBJ((...))`） |
| 「単一値: A, B」 | `singleValues` |
| 定義済み値(*XXX)とその `<dd>` | `options[{label,value,help}]` |
| 制約事項の節 | `restrictions` |
| 例 / エラーメッセージ / 実行環境 / スレッドセーフ | `examples` / `errorMessages` / `environment` / `threadSafe` |

原典に書かれておらず**スクリプトが決められないもの**（既存 JSON から引き継がれる。ここが人／LLM の仕事）:

- `dependsOn` … 相関規則（表示・必須・入力可否・選択肢の絞り込み）。原典は散文で書いており抽出できない。
- `constraints` … コマンド単位の排他 / 相互必須。
- `placeholder` … 入力例。
- 要素の英名 … 原典は日本語ラベルのみ。合成名 `<PARAM>_E<N>` が入るので、意味のある名前に直す。

## 手順

1. 原典 `docs/origin/cl/<CMD>.html` があることを確認する（無ければ取得）。
2. `node docs/origin/generate-cl-definitions.mjs <CMD>` で生成する。
3. `node docs/origin/verify-cl-definitions.mjs <CMD>` で原典と突き合わせ、**差分ゼロを確認**する。
4. 差分が出たら **JSON を手で直さず、生成スクリプトを直す**。手で直すと次回の再生成で消える。
5. 判断が要る項目（`dependsOn` / `constraints` / `placeholder` / 要素の英名）を原典の散文を読んで補う。
   ここは主エージェントが原典を直読して行う（protocol §2.6。委譲先の権限劣化で幻覚的な指摘になるため）。
6. 拡張のビルドが通ること（`cd vscode-extension && npx tsc -p ./`）を確認する。

## 既知の落とし穴（いずれも実際に踏んでいる）

- **省略時値は下線でしか表現されない**。`<strong class="underlined">*FIRST</strong>`。
  テキスト化すると消える。`defaultValue` は `src/prompter/model.ts` が初期値に使うため、
  欠けると F4 で本来入るべき `*SAME` / `*LIBL` が空欄になる。
- **修飾子は出力順と逆**。原典「修飾子1: ソース・ファイル / 修飾子2: ライブラリー」に対し
  構文は `LIB/FILE`。位置対応で既存名を移すと名前と中身がねじれる（CHGPF.SRCFILE で発生）。
  修飾子名はラベルに「ライブラリー」を含むかで決定的に決める。
- **入力欄の名前はフォームのキー**。コマンド内で重複すると複数の欄が同じ値を共有する
  （CHGJOB の OUTQ/JOBQ/SRTSEQ が全て `LIB` を名乗っていた）。生成時に一意化される。
- **`required` を group に付けても効かない**。`model.ts` は末端の入力欄しか検証しない。
- **`dependsOn` の判定は TypeScript と WebView JS の2箇所にある**
  （`visibilityRules.ts` の `dependencyHolds` と `binding.ts` のクライアント側）。
  片方だけ直すと挙動が食い違う。

## aidev ワークフローとの関係

- **research 工程**から委譲された場合: 手順1–3（生成と原典突き合わせ）を行い、結果を research.md 用に返す。
- **coding 工程**から委譲された場合: 手順4–6（生成スクリプトの修正と判断項目の補完）を行う。
- 単独起動の場合: 手順1–6を通して実施する。
