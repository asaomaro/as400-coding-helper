# 仕様: RPG固定長仕様書のプロンプター定義生成・検証 支援skill（rpg-spec-def）

## 概要

CL の `cl-command-def` に相当する **RPG 固定長仕様書専用の支援 skill `rpg-spec-def`** を新設する。
RPG 固定長仕様書（H/F/D/I/C/O/P 等）の**プロンプター定義 JSON を、固定長リファレンスの原典を正として
生成・検証**する。出力は方言別（`rpg/{ile,rpg3}/<X>-SPEC.json`）、スキーマの正は `types.ts`。
本作業のスコープは **skill 新設**＋機能実証としての **1 件ドッグフード生成（F-SPEC / ILE）** まで。
残る I/O/P（ILE）と rpg3 多仕様は後続 batch が消化する。

## 設計方針

- **`cl-command-def` と同形にする**（aidev の research/coding から委譲可能・既存運用と一貫）。骨格を流用し、
  RPG 固有の差分（方言・原典の非対称・enum 表現）だけを上書きする。research F1–F5 を根拠とする。
- **原典の正（dialect 非対称）**: 
  - `ile`: ローカル `docs/ILE_RPG_Fixed_Format_Reference.md` を**一次資料**として直読（桁位置は research F3 で確定済）。
  - `rpg3`: **ローカルにフル原典が無い**（research F4）。オンライン原典（IBM RPG/400 Reference 等）を
    `cl-command-def` と同じ Playwright headless 描画取得で取り、**主エージェントが生テキスト直読**で照合する。
    取得不能なら**桁を捏造せず保留**（生成しない）。この非対称を skill 手順に明記する。
- **enum 表現を CL から更新**: `types.ts` は `inputType:"dropdown"`+`options[]` を持つ（research F1）。
  固定値（ファイル・タイプ I/O/U/C、ファイル形式 E/F、出力タイプ H/D/T/E、P の B/E 等）は **dropdown+options**
  で表現する（CL skill の「help 列挙」方針は踏襲しない）。
- **positional / keyword の2系統**を区別する:
  - **positional 仕様**（F/I/O/P の定位置欄・D/C）: 各欄に `sourceStart`/`sourceLength` を**桁位置表どおり**付与。
  - **keyword 方式の欄**（H 全体、F/P/D のキーワード欄 44-80）: 桁固定でないため `sourceStart` を付けず、
    キーワード単位のパラメータにする（既存 H-SPEC.json が実例）。
- **検証はサブ委譲しない**（AGENTS.md／protocol §2.6）。原典生テキストとの機械照合は主エージェントが行う。

## 対象範囲

- 追加: `.claude/skills/rpg-spec-def/SKILL.md`（skill 本体。必要なら補助なし＝単一ファイルで自己完結）。
- ドッグフード生成（実証）: `vscode-extension/resources/prompter/rpg/ile/F-SPEC.json`（research F3 の F 桁を正に生成）。
- backlog 更新: `.aidev/backlog/rpg-spec.md` の `F-SPEC` を `[x]` 化（生成根拠を脚注）。I/O/P は未チェックのまま残す。
- **不変**: 拡張機能 TypeScript（`src/**`）、languageId/拡張子関連付け、`cl-command-def`。

## インターフェース / データ構造

### skill frontmatter（cl-command-def に倣う）

```yaml
name: rpg-spec-def
description: RPG固定長仕様書(H/F/D/I/C/O/P)のプロンプター定義JSONを、固定長リファレンスの原典を正として
  作成・検証する。「<X>-SPECの定義JSONを作って」「RPG仕様書定義を作成」などのとき、または aidev ワークフローの
  research/coding 工程から委譲されたときに使用する。
allowed-tools: [Bash, Read, Write, WebSearch]
```

### 入力（skill 起動時に確定する2引数）

- **仕様種別** `<X>`: `H|F|D|I|C|O|P`（C は旧/新で `C-SPEC`/`C-NEW`）。
- **方言** `dialect`: `ile`（既定）| `rpg3`。

### 出力

- `vscode-extension/resources/prompter/rpg/{dialect}/<X>-SPEC.json`。スキーマは `PrompterDefinition`
  （`keyword`,`description`,`help`,`parameters[]`）。`keyword="<X>-SPEC"`。

### RPG仕様 → JSON マッピング規約（CL からの差分を反映）

| RPG 固定長仕様 | JSON |
|---|---|
| 定位置欄（桁 N-M） | `sourceStart=N`, `sourceLength=M-N+1` |
| キーワード方式の欄（H 全体・44-80 キーワード） | キーワード単位の `parameter`（`sourceStart` 無し） |
| 必須欄 | `required: true` |
| 固定値の集合（I/O/U/C・E/F・H/D/T/E・B/E 等） | `inputType:"dropdown"` + `options[{label,value}]` |
| 修飾名・要素リスト（LIB/OBJ、ELEM 相当） | `inputType:"group"` + `children[]` |
| 文字型（NAME 等、英大文字） | `inputType:"text"`, `attributes.characterSet:"upper"`, `maxLength` |
| 数値欄（長さ・小数桁 等） | `inputType:"number"`, `attributes.numericOnly:true`, `maxLength` |
| 複数指定可 | `maxOccurrences:N` |
| 欄の説明 | `description`(短) + `help`(詳細・日本語) |
| 末尾コメント欄 | `COMMENT` パラメータ（既存定義の慣行） |

## 振る舞いの詳細

### skill 手順（SKILL.md に内在させる）

1. 仕様種別 `<X>` と方言 `dialect` を確定する。
2. 原典取得（dialect 非対称）:
   - `ile` → `docs/ILE_RPG_Fixed_Format_Reference.md` の当該「<X>仕様書 / 桁位置」節を Read で直読。
   - `rpg3` → Playwright headless でオンライン原典を描画取得し主Eが直読。**取得不能なら保留**（捏造禁止）。
3. 桁位置表・定義済み値を抽出する（positional は桁範囲、keyword 方式はキーワード集合）。
4. 既存定義（`rpg/{dialect}/*.json`、特に D-SPEC/H-SPEC）をテンプレに、マッピング規約で JSON を組み立てる。
5. 検証（**主E実施・サブ委譲しない**）:
   - JSON パース可（`node -e "require('./<path>')"`）。
   - 既存 `rpg/**/*.json` と同型・同キー名。
   - 各欄の `sourceStart`/`sourceLength`・`required`・`options` が**原典の桁位置表と機械的に一致**（生テキスト直読 diff）。
6. `rpg/{dialect}/<X>-SPEC.json` に書き出す。

### I/O 仕様の行種の扱い（research の論点を確定）

- I/O 仕様書は1レコードに複数行種を持つ（I=レコード識別行/フィールド行、O=見出し/明細/合計＋フィールド行）。
- **本 skill の定義は桁位置表が示す「レコード行（代表行）」を対象**にする（research F3 の桁範囲がこれ）。
  フィールド明細行（From/To やedit word を1フィールドずつ書く行）の専用プロンプトは**対象外**とし、
  必要になれば別仕様種別として後続で追加する（skill の help にこの前提を明記）。

### ドッグフード（F-SPEC / ILE）

- research F3 の F 仕様桁を正に `rpg/ile/F-SPEC.json` を生成する。最低限の欄:
  - `FILENAME`(7-16, text/upper, 必須) / `FILETYPE`(17, dropdown: I/O/U/C, 必須) /
    `FILEDESG`(18, dropdown: F/空白) / `FILEFMT`(19, dropdown: E/F) / `RECLEN`(20-23, number) /
    `DEVICE`(34-42, dropdown: DISK/PRINTER/WORKSTN/SPECIAL/SEQ) / `KEYWORDS`(44-80, text・キーワード方式) /
    必要に応じ `COMMENT`。
  - 各欄の桁は原典 L159-171 と一致させる（生成後に主Eが直読照合）。

## ドメイン固有の考慮

- **原典照合の主E実施義務**（AGENTS.md「開発時の検証規約」／protocol §2.6）: rpg3 のオンライン原典直読・
  ile のローカル直読いずれもサブ委譲しない。skill 手順にこの制約を明記する。
- **languageId 非波及**: skill は JSON 生成のみで、拡張子関連付け・言語登録・診断/キーバインドに触れない
  （AGENTS.md「languageId 下流波及」の対象外であることを保証）。
- **方言桁差**: 同一仕様種別でも ile/rpg3 で桁が異なる（research F4 / 既存 rpg3 C-SPEC）。dialect ごとに
  別ファイル・別原典で確定し、独自補完しない。

## エラー処理 / 異常系

- 原典が取得・特定できない（特に rpg3）: 生成を中止し「原典未到達のため保留」と報告（桁の推測生成は禁止）。
- 桁位置表とスキーマの不整合（例: enum 欄が原典に無い値を含む）: 原典を正として採用し、差異を報告する。
- 既存ファイルが既にある仕様種別: 上書き前に差分を提示（ドッグフードの F-SPEC は新規なので非該当）。

## 受け入れ基準との対応

- 「skill 単独で F-SPEC 等を生成・検証できる」→ SKILL.md の手順1–6＋**ドッグフードで F-SPEC/ILE を実生成・原典照合**して実証。
- 「生成定義が types.ts 準拠・桁位置が原典一致」→ マッピング規約＋検証手順5（主E機械照合）。F-SPEC は L159-171 と一致。
- 「aidev-util-batch が rpg-spec(方言別) を消化できる」→ skill が research/coding から委譲可能（frontmatter description）。
  ILE 経路はローカル原典で完全消化可能。rpg3 はオンライン原典前提（skill に明記）。
- 「PJ 規約（cl-command-def と同形・委譲トリガ明記）」→ frontmatter・節構成を cl-command-def に揃える。
