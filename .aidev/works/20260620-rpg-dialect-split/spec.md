# 仕様: RPG方言(ILE / RPG III)対応の基盤整備

関連: requirement.md / research.md / issue #18

## 概要

RPG 固定長サポートに **方言(dialect)** という新しい次元を導入する。`.rpgle`→`ile`、`.rpg`→`rpg3`
を拡張子から判定し（設定で上書き可）、プロンプター定義の読込（`loadForLanguage`）と桁解決
（`resolvePosition`）を方言別に分岐させる。既存4定義（D/C/C-NEW/H-SPEC）は `resources/prompter/rpg/ile/`
へ移設し、RPG III の代表1定義 `C-SPEC.json` を `rpg/rpg3/` に新規追加（原典照合済み・research F5）。
languageId（`rpg-fixed`）は両方言で共通のまま変えない（方言は languageId と直交する別次元）。

## 設計方針

### 方言は「拡張子から導出する独立次元」（languageId 非依存）

research F4 より、`.rpgle` と `.rpg` はともに languageId `rpg-fixed`。よって方言は languageId からは
導出できず、**ファイルパスの拡張子**から導出する。導出は単一のヘルパ（新規 `prompter/dialect.ts`）に集約し
（非機能要件「方言定義の一元化」）、二重化しない。

- 既定マップ: `{ ".rpgle": "ile", ".rpg": "rpg3" }`。
- 拡張子が既定マップに無い／languageId だけ `rpg-fixed`（拡張子で判定不可）の場合は **`ile` にフォールバック**
  （現行は全 rpg-fixed を ILE 扱いのため、後方互換のデフォルト）。

### 方言を `ResolvedPosition` に載せる（呼出側受け渡しではなく）

research 申し送り #4 の二択は **「`ResolvedPosition.dialect` を追加」を採用**する。理由:

- `resolvePosition` は既に document を受け取り languageId/keyword を導出している。dialect も同じ場所で
  document から導出すれば、**導出ロジックが1箇所に閉じる**。
- 消費側が2つある（`showPrompter` と `rpgTabNavigation`）。`ResolvedPosition` に載せれば両方が自然に受け取れ、
  呼出側ごとに dialect 導出を書く重複が出ない。
- cl の場合は `dialect` を持たない（`undefined`）。型は `dialect?: Dialect`（rpg-fixed のときのみ設定）。

### loader は方言別サブディレクトリを読む（旧パスは ile にフォールバック）

`resources/prompter/rpg/{dialect}/` を既定、`.rpg-cl/rpg/{dialect}/` をワークスペース上書きとする。
既存4定義を `rpg/ile/` へ移設するのに伴い、**既存のワークスペース上書き `.rpg-cl/rpg/`（dialect 無し）が
読まれなくなる回帰**を防ぐため、`ile` 方言に限り旧 `.rpg-cl/rpg/`（dialect 無し）も低優先のフォールバック
上書き層として読む（research リスク／申し送り #3 の決定）。バンドル既定（拡張機能同梱）は当方が移設するため
互換問題なし。

### rpg3 は `C`→`C-SPEC` 固定（C-NEW 判定を波及させない）

research F6 より、EVAL/IF 等の自由形演算（C-NEW）は ILE(RPG IV) 固有で RPG III に存在しない。
`resolvePosition` は `dialect === "rpg3"` のとき、6桁目が `C` なら **常に `C-SPEC`**（`cNewOpcodes` 判定を
スキップ）。ILE(`ile`) は従来どおり C-NEW 判定を行う。

## 対象範囲

| ファイル | 変更内容 |
|---|---|
| `src/prompter/types.ts` | `export type Dialect = "ile" \| "rpg3"` を追加（`LanguageId` と直交） |
| `src/prompter/dialect.ts`（新規） | 方言導出の単一真実源。既定マップ・設定キー・純関数 `resolveDialectFromPath` とvscode薄ラッパ `resolveDialect(document)` |
| `src/prompter/positionResolver.ts` | `ResolvedPosition.dialect?` 追加。rpg-fixed のとき `resolveDialect` で設定。rpg3 は `C`→`C-SPEC` 固定 |
| `src/prompter/jsonDefinitions.ts` | `loadForLanguage(language, dialect, workspaceFolder, context)`。rpg は `rpg/{dialect}/`＋`.rpg-cl/rpg/{dialect}/`、ile は旧 `.rpg-cl/rpg/` もフォールバック |
| `src/extension/commands/showPrompter.ts` | `loadForLanguage` に `resolved.dialect` を受け渡し |
| `resources/prompter/rpg/ile/`（移設） | 既存 `D-SPEC/C-SPEC/C-NEW/H-SPEC.json` を移動 |
| `resources/prompter/rpg/rpg3/C-SPEC.json`（新規） | RPG III C仕様書定義（原典照合・research F5） |
| `package.json` | `rpgClSupport.rpgDialectByExtension` 設定プロパティを追加 |
| `.aidev/backlog/rpg-spec.md` | ILE スコープと明記 |
| `.aidev/backlog/rpg3-spec.md`（新規） | RPG III 用バックログ枠（当面空） |

**`rpgTabNavigation.ts` は変更しない**（`resolvePosition` の戻り値型に optional フィールドが増えるのみで
コンパイル・既存挙動に影響なし）。タブナビ／ルーラーの**桁マップの方言対応は対象外**（requirement 対象外
「編集キーバインドの方言対応」）。詳細は「ドメイン固有の考慮」参照。

## インターフェース / データ構造

### `Dialect` 型と導出（dialect.ts）

```ts
export type Dialect = "ile" | "rpg3";

// 既定の拡張子→方言マップ（単一真実源）
const DEFAULT_DIALECT_BY_EXTENSION: Record<string, Dialect> = {
  ".rpgle": "ile",
  ".rpg": "rpg3",
};

// 純関数（unit テスト可能・vscode 非依存）
export function resolveDialectFromPath(
  fsPath: string,
  overrides?: Record<string, string>
): Dialect;
//  - map = { ...DEFAULT, ...正規化した overrides }
//  - 拡張子は長い順に照合（".rpgle" を ".rpg" より先に）
//  - いずれにも一致しなければ "ile"

// vscode 薄ラッパ：設定 rpgClSupport.rpgDialectByExtension を読み document.uri.fsPath で判定
export function resolveDialect(document: vscode.TextDocument): Dialect;
```

### 設定キー（package.json）

```jsonc
"rpgClSupport.rpgDialectByExtension": {
  "type": "object",
  "default": { ".rpgle": "ile", ".rpg": "rpg3" },
  "additionalProperties": { "type": "string", "enum": ["ile", "rpg3"] },
  "markdownDescription": "RPG 固定長ソースの拡張子→方言(ile/rpg3)対応。`.rpg` を ILE として扱う等の上書きに使う。"
}
```

- 粒度: **拡張子単位**（VSCode 標準のスコープ機構によりワークスペース／フォルダ別 `settings.json` で上書き可能）。
  ファイル単位の上書きは過剰なため設けない（申し送り #2 の決定）。
- 値の正規化: キーは小文字化し先頭に `.` が無ければ補う。値が `ile`/`rpg3` 以外なら無視（既定にフォールバック）。

### `ResolvedPosition`（positionResolver.ts）

```ts
export interface ResolvedPosition {
  readonly language: LanguageId;
  readonly dialect?: Dialect;   // 追加。language === "rpg-fixed" のときのみ設定
  readonly document: vscode.TextDocument;
  readonly position: vscode.Position;
  readonly line: number;
  readonly column: number;
  readonly keyword: string;
}
```

### `loadForLanguage`（jsonDefinitions.ts）

```ts
async loadForLanguage(
  language: LanguageId,
  dialect: Dialect | undefined,     // 追加（cl では undefined）
  workspaceFolder: vscode.WorkspaceFolder | undefined,
  context: vscode.ExtensionContext
): Promise<PrompterDefinition[]>
```

- `language === "rpg-fixed"`: `subPath = ["rpg", dialect ?? "ile"]`。
  - 既定: `resources/prompter/rpg/{dialect}/`
  - 上書き: `.rpg-cl/rpg/{dialect}/`（keyword 単位マージ・既存仕様）
  - **ile のみ**: 旧 `.rpg-cl/rpg/`（dialect 無し）も読み、`{dialect}/` 上書きより低優先で keyword マージ
    （既存ユーザー上書きの後方互換）。
- `language === "cl"`: 従来どおり `cl`（dialect 無視）。

### rpg3 `C-SPEC.json`（原典照合・research F5、桁は1始まり sourceStart/sourceLength）

| パラメータ | sourceStart | sourceLength | 桁範囲(1始まり) | required | 属性 |
|---|---|---|---|---|---|
| FACTOR1 | 18 | 10 | 18–27 | false | maxLength 10 |
| OPCODE | 28 | 5 | 28–32 | true | upper, maxLength 5 |
| FACTOR2 | 33 | 10 | 33–42 | false | maxLength 10 |
| RESULT | 43 | 6 | 43–48 | false | maxLength 6 |
| COMMENT | 60 | 15 | 60–74 | false | maxLength 15, visibleByDefault |

- 桁は research F5（rpg006/rpg007 の独立2ページで相互裏付け）に一致。ILE C-SPEC（FACTOR1 12-25/OPCODE 26-35/
  FACTOR2 36-49/RESULT 50-63）とは別物（research F6）であり、方言分離の根拠。
- `keyword: "C-SPEC"`、`description`/`help` は RPG III(RPG/400) 演算仕様書である旨を記す。

## 振る舞いの詳細

```mermaid
flowchart TD
  doc[".rpgle / .rpg ドキュメント"] --> rp[resolvePosition]
  rp -->|resolveDialect: 拡張子+設定| dia{{dialect}}
  dia -->|rpg3 かつ C行| cspec["keyword = C-SPEC 固定"]
  dia -->|ile かつ C行| cnew["C-NEW 判定（従来）"]
  rp -->|ResolvedPosition{language,dialect,keyword}| sp[showPrompter]
  sp -->|loadForLanguage(language, dialect, …)| ld[jsonDefinitions]
  ld -->|rpg/&#123;dialect&#125;/ ＋ .rpg-cl/rpg/&#123;dialect&#125;/| defs[definitions]
  defs -->|keyword 一致| def[選択された定義]
```

- `.rpgle`（ile）: 既存4定義を `rpg/ile/` から読込。C-NEW 判定・桁解決・プロンプターは**完全に従来どおり**。
- `.rpg`（rpg3）: `rpg/rpg3/` から `C-SPEC` を読込。C 行は常に `C-SPEC`。F4 で FACTOR1/OPCODE/FACTOR2/RESULT/
  COMMENT が RPG III 桁（18-27/28-32/33-42/43-48/60-74）で初期値抽出・書き戻しされる。
- 設定 `rpgDialectByExtension` で `.rpg`→`ile` に上書きすると、`.rpg` でも ILE 定義・桁になる。

### エッジケース
- `.rpg` で 6桁目が `D`（RPG III に D-spec は無い）→ keyword `D-SPEC` だが rpg3 に定義が無く、showPrompter は
  「No prompter definition found for D-SPEC.」を表示（最小スコープの想定内挙動）。
- 設定値が不正（`ile`/`rpg3` 以外）→ 無視して既定マップにフォールバック。
- COMMENT の初期値抽出は既存仕様で「COMMENT は行末まで slice」。rpg3 では 60桁目以降を取得するため、稀に
  75-80（プログラム識別欄）が混入し得るが、編集対象ソースで同欄は通常空のため許容（既存ロジック流用、最小変更）。

## ドメイン固有の考慮（languageId / アクティベーション波及チェック）

AGENTS.md「languageId / アクティベーション変更時の下流波及チェック」に従い点検する。

- **本作業は languageId を変更しない**（`.rpgle`/`.rpg` は既に `rpg-fixed` 同居・#4 済み）。方言は languageId と
  別次元のため、診断・キーバインド・スニペット・補完など languageId 連動機能への新たな波及は**生じない**。
- `package.json` の `contributes.languages[].extensions` は変更しない（拡張子↔言語の関連付けは現状維持）。
- F4 キーバインドの `when`（`resourceExtname == .rpgle` 等）も変更不要（`.rpg` は editorLangId == rpg-fixed で発火）。
- **タブナビ／ルーラーの桁は方言非対応のまま**（requirement 対象外）。`rpgTabNavigation`・ルーラーは
  `resources/navigation/rpg-fixed-keyword-columns.json`（ILE 桁）を単一マップとして使う。`.rpg`(rpg3) でも
  この ILE 桁が使われるが、これは既存挙動からの**機能拡張対象外**。ただし `.rpg` の C 行 keyword が従来の
  C-NEW 判定→`C-SPEC` 固定に変わる副作用があり、RPG III に C-NEW は無いため**より正しくなる方向**で回帰では
  ない（spec で明示・review で確認）。**ILE `.rpgle` のタブナビ／ルーラー挙動は不変**。

## エラー処理 / 異常系

- 設定読込失敗・型不正 → 既定マップにフォールバック（例外を投げない）。
- `rpg/{dialect}/` ディレクトリ不在 → `loadFromDirectory` は既存仕様で `[]` を返す（ログのみ）。移設漏れの
  早期検知として、ile 定義0件時の既存 warning ログを活用。
- 後方互換フォールバック（旧 `.rpg-cl/rpg/`）も `loadFromDirectory` の try/catch で安全に空配列化。

## テスト方針（test 工程の受け入れに使用）

- **unit（vscode 非依存）**: `resolveDialectFromPath` の純関数テスト（`.rpgle`→ile / `.rpg`→rpg3 /
  上書き `.rpg`→ile / 未知拡張子→ile / 拡張子の長い順照合）。
- **定義整合**: `resources/prompter/rpg/rpg3/C-SPEC.json` を読み、桁（F5）・required・keyword を検証する
  軽量テスト（JSON 直読）。
- **回帰**: 既存 `rpg/ile/` 定義が従来の桁（ILE C-SPEC 等）で読めることを確認（移設の健全性）。
- 既存 `f4Prompter.test.ts`（integration）の `loadForLanguage` 呼出は新シグネチャに追従。

## 受け入れ基準との対応（requirement 完了条件）

1. `.rpgle`→ile / `.rpg`→rpg3 が選択される → `resolveDialect`＋`loadForLanguage(dialect)` で実現。
2. 既存 ILE 挙動は不変（回帰なし）→ 既存4定義を `ile/` 移設＋既定 `ile` フォールバック、C-NEW 判定は ile 維持。
   旧 `.rpg-cl/rpg/` 上書きも ile フォールバックで継続。
3. 設定で方言を上書きできる → `rpgClSupport.rpgDialectByExtension`。
4. RPG III 最小1定義(C-spec)が `.rpg` から end-to-end → `rpg3/C-SPEC.json`＋rpg3 の `C`→`C-SPEC` 固定＋
   桁解決(既存 `extractByColumns`/`buildRpgLineText` が sourceStart/Length を使用)。
5. 原典照合済み → research F5 に rpg006/rpg007 直読の照合根拠を保持（C-SPEC.json の桁はこれに一致）。
6. バックログ整備 → `rpg-spec.md` を ILE スコープ明記、`rpg3-spec.md` を新規追加。
