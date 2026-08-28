# 調査: F4 プロンプターの VSCode 非依存化

## 調査の問い

- Q1: いま `vscode` に触っているのはどこか。UI を切り出したら何が残るか。
- Q2: インラインスクリプト（827 行）は何をしているか。何がコアと二重になっているか。
- Q3: 単独起動で「入れ子のプロンプター（F4 in F4）」をどう成立させるか。
- Q4: 単独起動で書き戻し（桁）まで見せられるか。
- Q5: 参考にする DDS の構造は、そのまま持ち込める形か。

## 判明した事実

### F1: `src/prompter/` 17 ファイルのうち、`vscode` を持つのは 8 つだけ

`grep -c vscode src/prompter/*.ts` の結果。**判断はすでにコア側に寄っている。**

| 純粋（UI から直接使える） | `vscode` を持つ（ホスト側に残る） |
|---|---|
| `types.ts` `model.ts` `cdmlRules.ts` `visibilityRules.ts` `occurrences.ts` `commandHelp.ts` `clCommandParser.ts` `binding.ts` | `jsonDefinitions.ts`(27) `workspaceObjects.ts`(6) `positionResolver.ts` `applyChanges.ts` `initialValues.ts`(2) `help.ts`(2) `specClassifier.ts` `dialect.ts` `webview.ts` |

意味するところ: **UI を束ねれば、判定の実物（`model.ts` / `visibilityRules.ts` /
`cdmlRules.ts`）をそのまま import できる。** 写しを持つ理由が無くなる。

### F2: インラインスクリプトの 3 割は「コアの写し」

`src/prompter/binding.ts:457-1284`。内訳を数えると:

| 塊 | 行 | コアに実物があるか |
|---|---|---|
| `applyDependencyRules`（条件表示・必須・許可値の再評価） | 595-705 | **ある** — `visibilityRules.ts:64` `evaluateParameter` |
| `validateConstraints`（相関制約） | 745-795 | **ある** — `model.ts:177` `validateConstraints` |
| `validateForm`（必須・許可値） | 707-743 | **ある** — `model.ts:231` `validate` |
| 繰り返し group の複製・番号振り直し | 875-1058 | **ある** — `occurrences.ts:40` `countOccurrences`（値から件数が決まる） |
| 複数値欄・ヘルプ・キー操作・F4 in F4 | 残り | 無い（UI そのもの） |

`binding.ts:604` には「片方だけ更新するとサーバ/クライアントで挙動が食い違うため注意」と
**注意書きで守っている**状態。`createCdmlEvaluator` だけは
`binding.ts:465` が `String(...)` で実物を埋め込んでおり、この 1 つだけ食い違いようがない
（**この形が正解で、他がそうなっていない**）。

### F3: 写しは既に食い違っている（`visibleByDefault` を見ていない）

コア `visibilityRules.ts:99` は visible 規則が無いとき `definition.visibleByDefault !== false` を返す。
クライアント `binding.ts:679` は同じ場面で **`visibleRules.length === 0` なら無条件に真**。

いまは表面化していない——`dependsOn` も `promptControl` も持たない欄は
`binding.ts:582` の `continue` で飛ばされ、サーバが付けた `style="display:none"` が残るため。
**`visibleByDefault:false` と `dependsOn` を併せ持つ欄が現れた瞬間に食い違う**
（サーバは隠し、クライアントが開いた直後に出す）。定義側にその組み合わせが無いだけで、
規則としては既に壊れている。移植すれば構造的に消える。

### F4: 繰り返し group は「値から件数が決まる」ので、DOM の複製が要らない

`occurrences.ts:40` `countOccurrences` は**値を見て**件数を決める（`名前#2` に値が入っていれば 2 件）。
`model.ts:88` `expandOccurrences` がそれを使って入力欄を並べる。

つまり UI 側は「`名前#2` の空値を足す」だけでよく、
`binding.ts:875-1058`（fieldset の `cloneNode` ・ legend の番号振り直し・
追加/削除ボタンの付け替え・`renumberGroup`）**184 行がまるごと不要になる**。

### F5: 書き戻しの組み立ては純粋関数だが、`vscode` を import するファイルに同居している

`applyChanges.ts:154` `buildClCommandBody` / `:164` `buildClCommandText` / `:365` `buildRpgLineText` は
`vscode` API を使わない（コメントにも「純粋関数のため検証用に公開する」とある）。
しかし**同じファイルの 1 行目が `import * as vscode`** なので、ブラウザ側からは import できない。

依存しているのは `types` / `occurrences` / `clCommandParser` だけ（いずれも純粋）。
`vscode` が要るのは `applyChanges()` 本体（`WorkspaceEdit`）と、
`clContinuation` / `rpgEditGuards` の 2 つの import だけ。**切り出せる。**

→ Q4 の答え: **見せられる。** 純粋部分を別ファイルへ出せば、
単独起動ハーネスが「確定したら、この行が書き戻される」を実際に描ける。

### F5-1: `toSerializableState` は `ResolvedPosition` を桁の 2 つしか使っていない

`binding.ts:122` の引数は `ResolvedPosition`（`vscode.TextDocument` を持つ）だが、
実際に読むのは `resolved.line` と `resolved.column`（`binding.ts:174-175`）だけ。
既存テストも `{ line, column }` の素のオブジェクトを渡している
（`test/unit/cdmlRules.test.ts:396`）。**型を狭めれば `vscode` 依存が消える。**

### F6: DDS の構造はそのまま持ち込める（4 点セット）

| 要素 | DDS の実物 | プロンプターでの相当 |
|---|---|---|
| メッセージ契約 ＋ ホスト能力宣言 | `src/dds/webview/protocol.ts:20` `EditorHost` | `PrompterHost`（`opensNestedPrompter` / `providesHelpWindow` / `providesObjectCandidates`） |
| `acquireVsCodeApi` の唯一の呼び出し | `src/dds/webview/bridge.ts:34` | 同形 |
| HTML の殻（`vscode` 非依存の純関数） | `src/dds/webviewHtml.ts:17` | 同形 |
| 型の締め出し | `tsconfig.webview.json` の `types: []` ＋ `include` | `include` にプロンプターを足す |

束ねは `esbuild.webview.mjs` が既にあり、**エントリを 1 つ足すだけ**（`:32` の第 1 ブロックと同じ形）。
`--production` では単独起動ハーネスを作らない分岐（`:41`）もそのまま使える。

### F7: 単独起動の入れ子（Q3）は「ハーネスが肩代わりする」で成立する

DDS では `askItem`（追加する項目の内容を聞く）を**ホストが肩代わり**している
（`protocol.ts:81` のコメント: 「入力の手段はホストが持つ」）。VSCode 版は `showInputBox`、
単独起動版は自前のダイアログ（`dev/standalone.ts:210` `ask`）。

プロンプターの F4 in F4 も同じ形にできる。**UI は `promptCommand` を投げるだけ**で、
- VSCode 版: 拡張が定義を読んで別パネルを開き、`setValue` で返す（現行 `webview.ts:85-103` のまま）
- 単独起動版: ハーネスが**同じ `startPrompter` を重ねて呼び**、確定値を `setValue` で返す

後者は「UI が入れ子で動く」ことの証明にもなる（VSCode 版では確かめられない）。

### F8: 定義 JSON は 251 件あり、束ねずに `fetch` で読める

`resources/prompter/cl/ja/` に 251 件。単独起動ハーネスは `file://` で開くため
`fetch` が使えない（CORS）。DDS ハーネスは**フィクスチャを esbuild の `loader` で
文字列として埋め込んでいる**（`esbuild.webview.mjs:14`）。
プロンプターは `resolveJsonModule` が有効（`tsconfig.webview.json:16`）なので、
**代表的な定義を `import` で埋め込む**のが同じ作法になる。

### F9: e2e は既存のハーネスに相乗りできる

`dev/e2e.mjs` は `playwright-core` を動的 import し、`~/.cache/ms-playwright` から
Chromium を探し、`check(name, ok, detail)` で数えて最後に終了コードを返す（`:63-67`, 末尾）。
CI の `gui-e2e` ジョブは `npm run compile:webview` のあと `node dev/e2e.mjs` を 1 本走らせるだけ
（`.github/workflows/prompter-definitions.yml`）。**2 本目のページを足す形**にする。

## 影響範囲

- `src/prompter/binding.ts` — 分解（HTML の殻 / UI / 直列化）。
- `src/prompter/webview.ts` — 束ねた資産を配る形に変える。パネルの作り方は変えない。
- `src/prompter/applyChanges.ts` — 純粋部分を切り出す（振る舞いは変えない）。
- `esbuild.webview.mjs` / `tsconfig.webview.json` / `package.json`（`dev:e2e`）。
- `.github/workflows/prompter-definitions.yml` の `gui-e2e`。
- テスト: `test/unit/cdmlRules.test.ts`（`buildHtml` を 3 か所）、
  `test/unit/prompterRegressions.test.ts`（2 か所）。**HTML を見る検査は
  「UI が描く」形に変わるので書き換えが要る。**

## 実現性 / リスク

- **R1: 検査の対象が HTML 文字列から実操作へ移る。** いま `buildHtml` の出力に
  `data-depends-on` が含まれることを見ている検査は、**そのままでは移せない**
  （属性が無くなるため）。同じことを e2e（実際に値を変えて欄が消えるか）で見る。
  **単体テストを消して e2e に移す**ときは、e2e が落ちることを先に確かめる。
- **R2: CSP。** インライン `<script>` が消えるので `script-src 'nonce-…'` は
  外部スクリプト用になる。`style-src` の `'unsafe-inline'` も不要になる
  （DDS 側は既に外している。`webviewHtml.ts:5` に「落ちても例外は出ず桁だけ静かにずれる」）。
- **R3: 一度に全部やると差分が読めない。** 4,718 行のうち 1,401 行を作り替える。
  段階を分け、各段で `npm test` / `npm run verify` が緑であることを保つ。

## 実装アンカー

- A1: 分解する対象 — `src/prompter/binding.ts:241` `buildHtml`（HTML）、`:359-420`（CSS）、
  `:457-1284`（script）、`:1293` `buildFieldRuleAttributes`、`:1327` `buildFieldControlHtml`。
- A2: 残す直列化 — `src/prompter/binding.ts:122` `toSerializableState`（`ResolvedPosition` を
  `{line, column}` に狭める）。
- A3: ホスト側の受け口 — `src/prompter/webview.ts:57-107`（`onDidReceiveMessage` の分岐）。
  `submit` / `cancel` / `help` / `promptCommand` / `ready` の 5 つ。
- A4: 入れ子の実装 — `src/prompter/webview.ts:118` `openNestedPrompter`（そのまま残す）。
- A5: 切り出す純粋部分 — `src/prompter/applyChanges.ts:88-500`
  （`ClCommandContext` / `isAtDefault` / `buildParameterTokens` / `buildClCommandBody` /
  `buildClCommandText` / `buildRpgLineText`）。`:21` `applyChanges` だけが `vscode` を要る。
- A6: 参考にする形 — `src/dds/webview/protocol.ts` / `bridge.ts` / `main.ts`、
  `src/dds/webviewHtml.ts`、`esbuild.webview.mjs`、`tsconfig.webview.json`、
  `dev/standalone.ts` / `dev/e2e.mjs`。

## 実装時の注意

- **`createCdmlEvaluator` の `String(...)` 埋め込みは、束ねたら要らなくなる。**
  ただし `cdmlRules.ts` の「外の識別子を参照しない」制約は**外さない**——
  `binding.ts` を消しても、その制約を頼りにした検査が `test/unit/cdmlRules.test.ts` にある。
- **`model.ts` の「初期表示では必須の空欄をエラーにしない」規則（`model.ts:143`）を消さない。**
  UI が毎回 `buildInitialState` を呼ぶ設計にすると、この分岐が**入力のたび**効く。
  確定時だけは `validate()` を必須込みで通す必要がある（現行の `validateForm` と同じ責務）。
- **`maxlength` は CL 変数の分だけ広げてある**（`binding.ts:1381-1386`。11 = `&` + 名前 10）。
  移植で落とすと `MSGID(7 文字)` の欄に `&MSGIDVAR` が書けなくなる（PR#98 で踏んだ）。
- **`additional`（F10）で隠れている欄は検証しない**（`binding.ts:717`）。
  見えない欄でエラーにすると原因が分からない。
- **フォーカスの巡回を自前で持っている**（`binding.ts:1136-1176` の `Tab` 処理）。
  WebView では既定の巡回が外へ抜けるため。単独起動でも同じ挙動にする。

## spec への申し送り

- UI が持つのは**描画と操作**だけにする。判定は `model.ts` を呼ぶ（F1・F2 より、これは可能）。
- ホスト能力の宣言は「何ができるか」ではなく**「ホストが何を肩代わりするか」**で書く
  （DDS `protocol.ts:16` の言い回しをそのまま踏襲する）。
- 段階を分ける（R3）。各段で緑を保つ。
- **R1 の移し替えは、消す前に e2e が落ちることを確かめる**（AGENTS.md「落ちないテストは
  何も守っていない」）。
