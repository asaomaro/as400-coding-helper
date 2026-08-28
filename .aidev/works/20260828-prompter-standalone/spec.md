# 仕様: F4 プロンプターを VSCode 非依存（standalone 基準）に作り替える

## 概要

`binding.ts`（HTML+CSS+インライン JS 1,401 行）を解体し、DDS ビジュアルエディタと同じ
4 点セット——**契約 / bridge / 素の web の UI / ホスト能力の宣言**——に載せ替える。
UI は束ねられるので、**判定はコア（`model.ts` / `visibilityRules.ts` / `cdmlRules.ts`）を
直接呼ぶ**。写しは書かない（research F2・F3）。

## 設計方針

### 1. UI は描くだけ。状態は「値」だけを持つ

UI が保持するのは 3 つだけ。

```ts
interface FormState {
  values: Record<string, string>;          // 入力欄名 → 値（複数値は \n 区切り）
  occurrences: Record<string, number>;     // 繰り返し group 名 → 表示している組数
  additionalShown: boolean;                // F10 の展開状態
}
```

描くたびに**コアへ渡して作り直す**。

```
values ─▶ buildInitialState(definition, values, {occurrences})   … model.ts（既存）
       ─▶ toSerializableState(definition, state, candidates)     … formModel.ts（既存を移設）
       ─▶ render(model)                                          … ui.ts（新規）
```

入力のたびに全体を作り直すのは**プロンプター 1 枚が高々 1,542 欄**（実測の最大）で、
条件表示の再評価はいまも入力のたびに全欄を舐めている（`binding.ts:595`）ので同等。
差分描画は入れない——**取り違えの余地を作らないことの方が価値が高い**。

### 2. 繰り返しの組数は「値から」では足りない。コアに引数で渡す

`countOccurrences`（`occurrences.ts:40`）は**値が入っている組しか数えない**。
「追加」を押した直後の組は空なので、値からは復元できない。

そこで `buildInitialState` に任意引数を足す。

```ts
export interface InitialStateOptions {
  /** 繰り返し group ごとに、値から数えた件数より多く表示したい組数。 */
  readonly occurrences?: Record<string, number>;
  /** 必須なのに空、をエラーにするか。**初期表示は false、確定時は true**。 */
  readonly reportEmptyRequired?: boolean;
}
export function buildInitialState(definition, values, options?): PrompterState
```

`expandOccurrences` は `Math.min(maxOccurrences, Math.max(値から数えた件数, 指定件数))` を使う。
**既定（引数なし）の振る舞いは変えない**ので既存の呼び出しはそのまま。

`reportEmptyRequired` は、いまクライアント側の `validateForm`（`binding.ts:707`）が
持っている「確定時だけ必須の空欄を咎める」責務をコアへ移すもの。
初期表示で赤字を並べない規則（`model.ts:143`）はそのまま残る。

### 3. ホストが何を肩代わりするか

```ts
export interface PrompterHost {
  readonly name: "standalone" | "vscode";
  /** 入れ子のプロンプター（F4 in F4）をホストが開く。false なら F4 の印を出さない。 */
  readonly opensNestedPrompter: boolean;
  /** オブジェクト名の候補をホストが集める。false なら候補一覧を出さない。 */
  readonly providesObjectCandidates: boolean;
  /** 確定・取消で窓を閉じるのはホスト。false なら UI は閉じずに結果を残す。 */
  readonly closesWindow: boolean;
}
```

`VSCODE_HOST` は 3 つとも `true`。`STANDALONE_HOST` は
`opensNestedPrompter: true`（ハーネスが**同じ UI を重ねて**開く）/
`providesObjectCandidates: true`（作った候補を渡す）/ **`closesWindow: false`**。

### 4. 契約（メッセージ）

```ts
/** ホスト → UI */
export type HostMessage =
  | { type: "load"; definition: PrompterDefinition; values: Record<string, string>;
      objectCandidates: ObjectCandidates; host: PrompterHost }
  /** 入れ子のプロンプターで確定した値を欄に戻す。 */
  | { type: "setValue"; name: string; value: string };

/** UI → ホスト */
export type EditorMessage =
  | { type: "ready" }
  | { type: "submit"; values: Record<string, string | string[]> }
  | { type: "cancel" }
  | { type: "promptCommand"; name: string; value: string };

/** 不正なら undefined（例外にしない。1 通で窓を殺さない）。 */
export function parsePrompterMessage(value: unknown): EditorMessage | undefined;
```

### 5. 消す（現状の死蔵）

- **`help` メッセージ**。`webview.ts:78-84` が受けているが、**送る側がどこにも無い**
  （F1 もアイコンも WebView 内の overlay で完結している）。`help.ts` ごと消す。
- **`positionLine` / `positionColumn`**。`toSerializableState` が詰めているが
  **誰も読んでいない**（`grep` で参照ゼロ）。落とす。これで `toSerializableState` の
  `ResolvedPosition` 依存も消える（research F5-1）。

## 対象範囲

### 追加

| ファイル | 役割 |
|---|---|
| `src/prompter/webview/protocol.ts` | 契約 ＋ `PrompterHost` ＋ `parsePrompterMessage`。**`vscode` 非依存** |
| `src/prompter/webview/bridge.ts` | `acquireVsCodeApi` の唯一の呼び出し |
| `src/prompter/webview/ui.ts` | 画面と操作。DOM API で組み立てる（文字列連結をやめる） |
| `src/prompter/webview/ui.css` | `binding.ts:359-420` の CSS |
| `src/prompter/webview/main.ts` | VSCode 版のエントリ |
| `src/prompter/webviewHtml.ts` | HTML の殻（純関数）。DDS の同名ファイルと同形 |
| `src/prompter/formModel.ts` | `binding.ts` の `toSerializableState` と `Serializable*` 型を移設 |
| `src/prompter/commandText.ts` | `applyChanges.ts` の純粋部分（research A5） |
| `dev/prompter.html` / `dev/prompter.css` / `dev/prompter-standalone.ts` | 単独起動ハーネス |
| `dev/prompter-e2e.mjs` | 実操作の e2e |

### 変更

- `src/prompter/binding.ts` — **削除**（中身は上の 4 つへ散る）。
- `src/prompter/webview.ts` — 束ねた資産を配る形へ。`openNestedPrompter` は残す。
- `src/prompter/applyChanges.ts` — 純粋部分を `commandText.ts` から再輸出。
- `src/prompter/model.ts` — `InitialStateOptions` を足す（既定の振る舞いは不変）。
- `src/prompter/types.ts` — `ObjectKind` / `ObjectCandidates` をここへ（`workspaceObjects.ts`
  は `vscode` を持つので UI から型を引けない）。`workspaceObjects.ts` は再輸出。
- `src/prompter/help.ts` — 削除。
- `tsconfig.json` / `tsconfig.test.json` — `webview/{ui,bridge,main}.ts` を `exclude`。
- `tsconfig.webview.json` — `include` に `src/prompter/webview` を足す。
- `esbuild.webview.mjs` — エントリを 2 つ足す（WebView 用・ハーネス用）。
- `package.json` — `dev:e2e` を 2 本走らせる。
- `.github/workflows/prompter-definitions.yml` — `gui-e2e` に 2 本目を足す。

## 振る舞いの詳細

### 描画

定義の順に並べる（`binding.ts:245` の規則を維持）。`groupName` を持つ欄は `fieldset` に束ね、
最初に現れた位置に置く。欄の種類は現行どおり:

| `inputType` / 条件 | 部品 |
|---|---|
| `dropdown` かつ `options` あり | `<select>` |
| `maxOccurrences > 1`（group ではない） | 複数値欄（`+` / `-` で増減） |
| それ以外 | `<input type="text">` |

`size` は `min(maxLength, 40)`、`maxlength` は `max(maxLength, 11)`
——**CL 変数の余地を残す**（`binding.ts:1381`。落とすと PR#98 の後退が戻る）。

### 再評価

`input` / `change` のたびに `values` を集め直し、1. の経路で作り直して描き直す。
フォーカスは**入力欄名と選択位置で復元する**（作り直しで飛ぶため）。

### 確定

1. `buildInitialState(..., { reportEmptyRequired: true })` で作り直す。
2. **見えない欄は咎めない**——`visible === false` の欄と、
   `additional` かつ `additionalShown === false` の欄は飛ばす（`binding.ts:711-719` と同じ）。
3. 残ったエラーがあれば、その欄に赤字を出して**閉じない**。
4. 無ければ `submit` を送る。複数値欄は空を捨てて `string[]` に。

### キー操作（現行を保つ）

| キー | 動き |
|---|---|
| `F1` | フォーカス中の欄のヘルプを開く / 開いていたら閉じる |
| `F4` | 値がコマンドの欄なら `promptCommand` を送る |
| `F10` | 追加パラメーターの表示を切り替える |
| `Esc` | ヘルプが開いていれば閉じる。無ければ `cancel` |
| `Tab` / `Shift+Tab` | フォーム内を巡回（既定の巡回は WebView の外へ抜けるため自前で持つ） |

### 単独起動ハーネス

- 定義は**同梱の JSON を `import`** で埋め込む（`file://` では `fetch` できない。research F8）。
  代表として `CRTPF`（修飾名・多数の欄）/ `SBMJOB`（値がコマンド ＝ F4 in F4）/
  `SNDPGMMSG`（`dependsOn` の条件必須）/ `ALCOBJ`（繰り返し group）/ `CHGPRTF`（要素リスト）を載せる。
- 帯（ホストの肩代わり分）: 定義の切り替え、**確定した値から組み立てた書き戻し行**の表示
  （`buildClCommandText` を呼ぶ。research F5）、入れ子のプロンプターの重ね表示。

## インターフェース / データ構造

`SerializablePrompterState` は `positionLine` / `positionColumn` を落とす以外**変えない**
（既存の単体テストが読む形を保つ）。`ObjectCandidates` は `types.ts` へ移すのみで形は不変。

## ドメイン固有の考慮

- **CSP を緩めない。** インライン `<script>` が無くなるので
  `script-src 'nonce-…'` は外部スクリプト用、`style-src` から `'unsafe-inline'` を外す。
  DDS 側の注意書き（`webviewHtml.ts:5`「落ちても例外は出ず桁だけ静かにずれる」）と同じ理由で、
  **`style="…"` 属性を使わない**。表示/非表示は class で切り替える。
- **`cdmlRules.ts` の「外の識別子を参照しない」制約は外さない。** 束ねれば
  `String(...)` 埋め込みは要らなくなるが、その制約を検査している単体テストがある。
- **固定長の桁は触らない。** 書き戻しは `commandText.ts` へ移すだけで、中身は 1 行も変えない
  （`verify:roundtrip` が全 538 定義で往復を見ている）。

## エラー処理 / 異常系

- UI → ホストのメッセージは `parsePrompterMessage` で検証し、不正なら**捨てる**（例外にしない）。
- `load` が来る前の操作は無視する（`root` は空のまま）。
- 定義に欄が 1 つも無い場合も、確定・取消のボタンは出す。

## 受け入れ基準との対応

- **AC1**: `src/prompter/webview/` は `protocol.ts` 以外もすべて `vscode` を import しない。
  `tsconfig.webview.json`（`types: []`）の `include` に足すので、
  **`vscode` を書いた時点で型検査が落ちる**。
- **AC2**: `dev/prompter.html` ＋ 同梱定義の `import`（F8）。
- **AC3**: `dev/prompter-e2e.mjs` を `npm run dev:e2e` と CI の `gui-e2e` に足す。
- **AC4**: UI が `model.ts` / `visibilityRules.ts` / `cdmlRules.ts` を直接 import する。
  写しは 1 行も残さない（`binding.ts` ごと消える）。
- **AC5**: 既存テストは `buildHtml` を見ている 5 か所だけ書き換える（research R1）。
- **AC6**: `applyChanges` の中身を変えない。`positionResolver` / キーバインドに触らない。
- **AC7**: e2e の項目として 1 件ずつ立てる（下表）。
- **AC-I1〜I5**: 同じく e2e。

| AC | e2e で見ること |
|---|---|
| AC7 / 可変パラメータ | 「追加」で組が増え、入力欄名が `#2` になる。「削除」で戻る |
| AC7 / グルーピング | 修飾名が 1 つの囲みに入り、見出しが階層で出る |
| AC7 / F1 | ヘルプが開き、`Esc` で閉じ、フォーカスが元の欄へ戻る |
| AC7 / F10 | 追加パラメーターが現れ、隠れている間は必須違反にならない |
| AC7 / F4 in F4 | `SBMJOB` の `CMD` 欄で F4 → 入れ子が開き、確定すると欄に値が入る |
| AC7 / 候補 | `objectKind` を持つ欄に `datalist` が付く |
| AC-I2 | 必須未入力で `OK` を押しても確定せず、その欄に赤字が出る |
| AC-I3 | `Tab` だけで最後まで回り、先頭へ戻る |
| AC-I5 | ヘルプ表示中の `Tab` はヘルプを閉じてから巡回する |
| 条件表示 | `dependsOn` の相手を変えると欄が現れる／消える（**いま一度も自動で見ていない**） |
| 書き戻し | 確定した値から組み立てた行が、桁どおりに出る |
