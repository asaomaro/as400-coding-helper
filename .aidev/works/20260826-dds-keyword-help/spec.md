# 仕様: キーワード欄のチップ表示と原典ヘルプ

## 概要

キーワード欄（45-80 桁）の生テキストを**名前と引数に分けて**チップで出し、
選ぶと**原典の解説**（和名・使用レベル・構文・説明）が同じペインに出るようにする。

解析は core、解説の**データはホストが渡す**（UI はファイルを読めない）。
**この work では書き換えない**（読むだけ）。

## 設計方針

### 1. 解析は core、データはホスト、表示は UI

- **解析**（どこで切れるか）は規則なので core に置く。UI に文字を数えさせない。
- **解説の表**は 140KB の静的データで、UI からは読めない。`load` に載せてホストが渡す。
  **任意フィールド**にして、渡せないホストでもチップだけは出るようにする（AC7）。
- 表は**文書ごとに変わらない**ので `load` の 1 回だけ。`applied` / `rejected` には載せない
  （編集のたびに 140KB を送り直すことになる）。

### 2. 引き当ては 2 段

原典は `CAnn`（`CA01`-`CA24` の総称）と書き、ソースには `CA03` と書かれる。
**そのままの名前で引く → 見つからなければ末尾 2 桁を `nn` に替えて引く**。
表で `nn` を含むのは `CAnn` / `CFnn` の 2 件だけ（research F7）。

### 3. 並べ替えない・消さない

チップは**ソースに書いてある順**で出す。原典に無い綴りも**印を付けて出す**。
消すと「書いたのに無い」が起き、原因が掴めなくなる。

### 4. 生テキストを失わない

チップの下に読み取り専用の生テキストを残す（AC8）。桁を数えたい人・コピーしたい人の手段。

## 対象範囲

| ファイル | 変更 |
|---|---|
| `src/core/dds/ddsKeywords.ts` | **新規**。解析・解説の型・引き当て |
| `src/dds/webview/protocol.ts` | `load` に `keywords?` を足す（任意） |
| `src/dds/editorProvider.ts` | 表を読んで `load` に載せる |
| `dev/standalone.ts` | 束ねた表を `load` に載せる |
| `src/dds/webview/ui.ts` / `ui.css` | チップと解説 |
| `src/language/ddsKeywordCompletion.ts` | `DdsKeyword` を core の型に寄せる（**振る舞いは変えない**） |
| `src/core/dds/dspfRenderModel.ts` / `dspfOutline.ts` | **変更しない** |

## インターフェース / データ構造

```ts
/** キーワード欄の 1 区切り。 */
export interface KeywordEntry {
  /** 大文字化した名前。リテラルなら空。 */
  readonly name: string;
  /** 括弧の中（生テキスト。括弧自体は含まない）。引数が無ければ undefined。 */
  readonly parameters?: string;
  /** 元のテキストそのまま（チップに出すのはこれ）。 */
  readonly raw: string;
  /** 定数（固定情報）のリテラルはキーワードではない。 */
  readonly kind: "keyword" | "literal";
}

/** 原典から生成したキーワードの解説（`resources/completion/dds-keywords*.json` の 1 件）。 */
export interface DdsKeywordHelp {
  readonly name: string;
  readonly title: string;
  readonly level?: readonly string[];
  readonly description?: string;
  readonly syntax?: readonly string[];
  readonly hasParameters?: boolean;
}

export function parseKeywordEntries(text: string): readonly KeywordEntry[];

/** 名前で引く。**2 段**（そのまま → 末尾 2 桁を `nn` に正規化）。 */
export function findKeywordHelp(
  name: string,
  table: readonly DdsKeywordHelp[]
): DdsKeywordHelp | undefined;
```

プロトコル:

```ts
| { readonly type: "load"; readonly model: RenderModel; readonly host: EditorHost;
    /** 原典のキーワード解説。**無くてもよい**（チップだけ出る）。 */
    readonly keywords?: readonly DdsKeywordHelp[] }
```

## 振る舞いの詳細

### 解析（`parseKeywordEntries`）

走査は 1 文字ずつ。状態は「引用符の中か」と「括弧の深さ」の 2 つだけ。

| 入力 | 結果 |
|---|---|
| `DSPATR(RI) COLOR(RED)` | `DSPATR(RI)` / `COLOR(RED)` |
| `ALARM` | `ALARM`（引数なし） |
| `EDTWRD('   0. ')` | 1 つ。**引用符の中の空白で切らない** |
| `DFT('(A)')` | 1 つ。**引用符の中の括弧を数えない** |
| `CHECK(RZ RB)` | 1 つ。引数の中の空白は区切りではない |
| `'顧客保守'` | `kind: "literal"` |
| `'顧客保守' DSPATR(HI)` | リテラル ＋ キーワード |
| `DSPATR(RI` （閉じない） | 1 つ。**行末までを引数として扱う**（捨てない） |
| `''` を含むリテラル | 引用符の中のエスケープとして扱い、そこで閉じない |

名前は**大文字化して**返す（`dspatr` と書かれていても引ける）。`raw` は元のまま。

### 引き当て（`findKeywordHelp`）

1. そのままの名前で引く。
2. 見つからず `/^[A-Z]+\d{2}$/` に当たるなら、数字 2 桁を `nn` に替えて引く。
3. それでも無ければ `undefined`（＝「原典に無い」印を付ける）。

### UI

- プロパティの `キーワード` 行を**チップの並び**に替える。
  - チップ = `<button>`。表示は `raw`。原典に無いものは `unknown` の印（`?`）と色。
  - リテラルのチップは種別が分かる形（`定数` の印）にし、押しても解説は出ない
    （キーワードではないので原典に無くて当然——「原典に無い」と出すのは誤り）。
  - 1 つも無ければ `未設定`（モックの流儀）。
- チップを押す / `Enter` / `Space` / `F1` で**解説をチップの下に開く**。
  もう一度押すと閉じる。他の項目を選ぶと閉じる。
- 解説の中身: 和名 ＋ 使用レベル ＋ 構文（複数行あり）＋ 説明。
- **キーは伝播させない**（AC-I5）。
- 再描画でフォーカスを失わないよう、開いたチップを覚えて戻す（AC-I4）。
- チップの下に読み取り専用の生テキストを残す（AC8）。

### ホスト

- **VSCode**: `resolveDefinitionLanguage()` で言語を決め、
  `resources/completion/dds-keywords{,.en}.json` を読み、`resolveDdsType` の種別で引いて渡す。
  読めなければ**渡さない**（エディタは開く）。
- **単独起動**: 日本語の表を esbuild で束ねて渡す（設定を持たないホストなので固定）。

## ドメイン固有の考慮

- **リテラルはキーワードではない**。定数の先頭のリテラルを「原典に無いキーワード」と出さない。
- **`CAnn` / `CFnn`**。2 段の引き当てが要る（research F7）。
- 使用レベルの検査（そのキーワードがその位置で使えるか）は**この work では出さない**。
  レベルの解決は行の文脈が要り（`resolveDdsLevel`）、
  **判定を間違えると正しい記述に印が付く**。名前の存在だけを見る。

## エラー処理 / 異常系

- 解説の表が渡らない → チップだけ出る（AC7）。「原典に無い」の印は**出さない**
  （表が無いのだから、無いのは当然。誤解を招く）。
- 閉じない括弧・閉じない引用符 → 行末までを 1 区切りにする（捨てない）。
- 表に無い名前 → `unknown` の印。**消さない・並べ替えない**。

## 受け入れ基準との対応

| AC | 満たし方 |
|---|---|
| AC1 | `parseKeywordEntries`（引用符の外でだけ括弧を数える） |
| AC2 | `KeywordEntry.kind === "literal"` |
| AC3 | `unit.keywords` は継続行を連結済み（research F2）。分ければそのまま並ぶ |
| AC4 | チップを選ぶと和名・レベル・構文・説明が出る |
| AC5 | VSCode は `resolveDefinitionLanguage()`（補完と同じ関数） |
| AC6 | `findKeywordHelp` が `undefined` を返したら `unknown` の印 |
| AC7 | `load.keywords` は任意。無ければチップだけ・印も出さない |
| AC8 | チップの下に読み取り専用の生テキストを残す |
| AC-I1 | 解説は同じペインの下。もう一度押す / 他の項目で閉じる |
| AC-I2 | 読むだけ。`edit` を送らない |
| AC-I3 | `Tab` で到達、`Enter` / `Space` / `F1` で開く |
| AC-I4 | 開いたチップを覚えて再描画後に戻す |
| AC-I5 | チップ上のキーは `stopPropagation` |
