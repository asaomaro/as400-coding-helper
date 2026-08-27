# 調査: キーワード欄のチップ表示と原典ヘルプ

## 調査の問い

- Q1: 原典のキーワード解説は、どんな形でリポジトリにあるか。信頼できるか。
- Q2: キーワード欄の生テキストは、いまどこまで加工されて UI に届いているか。
- Q3: 解説データを WebView へ渡す経路として何が使えるか（ホストは 2 つある）。
- Q4: 解説の言語はどう決まるか。
- Q5: キーワード欄の構文（引用符・括弧）で、解析が壊れる形はあるか。
- Q6: 既存のチップ / ヘルプ UI の流儀は PJ にあるか。

## 判明した事実

### F1: 原典由来のキーワード表が既にあり、検査もされている

`vscode-extension/resources/completion/dds-keywords.json`（日本語・140,720 バイト）と
`dds-keywords.en.json`（英語・111,284 バイト）。構造は種別ごとの配列:

```
{ "DDS-PF": [...], "DDS-DSPF": [ 174 件 ], "DDS-PRTF": [...] }
```

1 件の形（`src/language/ddsKeywordCompletion.ts:24` `DdsKeyword`）:

```ts
{ name, title, level?: string[], description?, syntax?: string[], hasParameters?: boolean }
```

実例（`ALIAS`）: `title: "別名"` / `level: ["field"]` /
`syntax: ["ALIAS(alternative-name)"]` / `hasParameters: true` / `description: "これはフィールド・レベル…"`。

生成は `docs/origin/generate-dds-keywords.mjs`、検査は `docs/origin/verify-dds-keywords.mjs`
（`npm run verify` に入っている）。**原典の索引リンク数との突き合わせ・名前の重複・空の説明・
日英の件数一致**を見ている。→ **新しく説明を書き起こす必要は無い**。

### F2: キーワード欄は「連結済みの 1 本の文字列」で UI に届いている

`toLogicalUnits`（`src/core/dds/ddsLogicalUnits.ts:186`）は、キーワードだけの行を
直前の単位へ `` `${previous.keywords} ${keywordArea}`.trim() `` で**空白 1 個で連結**する。
その値が `DspfPlacedItem.keywords` → `ItemAttributes.keywords` を通って
プロパティの読み取り専用入力欄に出ている（`src/dds/webview/ui.ts` の `renderProperties`）。

- 継続行のキーワードも**同じ文字列に入っている**ので、分ければ AC3 は満たせる。
- **定数のリテラルも同じ文字列の先頭にある**（`'顧客保守'` の形）。
  既存の `readConstant`（`ddsLogicalUnits.ts`）が先頭のリテラルだけを読む。

### F3: 解説データを渡せるのはホストだけ（UI はファイルを読めない）

`buildDspfRenderModel` を呼ぶのは `src/dds/editorProvider.ts:262` と `dev/standalone.ts:129` の
**ホスト 2 つだけ**で、UI は `postMessage`（構造化複製）で受け取る。
WebView にファイルシステムは無い。したがって選択肢は 2 つ:

- (a) **ホストが `load` に載せて渡す**。VSCode 側は既存の読み込み経路
  （`vscode.workspace.openTextDocument` で `resources/completion/…` を読む。
  `src/language/ddsKeywordCompletion.ts:96`）を使える。単独起動は esbuild が JSON を
  そのまま束ねられる（`tsconfig.webview.json` は `resolveJsonModule: true`、
  `esbuild.webview.mjs` は既に `.dspf` をテキストとして埋め込んでいる）。
- (b) UI がキーワードごとにホストへ問い合わせる（`askKeywordHelp`）。往復が増え、
  ホストごとに実装が要る。

→ **(a)**。表は**文書ごとに変わらない静的なデータ**なので、`load` の 1 回で足りる（Q1 の答え）。
`applied` / `rejected` には載せない（毎回 140KB を送り直す意味が無い）。

### F4: 言語は既存の設定に従える

`resolveDefinitionLanguage()`（`src/prompter/jsonDefinitions.ts:10`）が
`rpgClSupport.language`（`auto` なら `vscode.env.language`）から `ja` / `en` を返す。
キーワード補完も同じ関数を使っている（`ddsKeywordCompletion.ts:89`）。
→ **エディタも同じ関数を通す**（言語の決め方を 2 か所に持たない）。
単独起動は日本語を束ねる（設定を持たないホストなので固定）。

### F5: 解析が壊れる形（原典の実例で確認）

原典のキーワード詳細に出てくる形:

- `EDTWRD('   0. ')` — **引用符の中に空白と `.`**。空白で切ると壊れる。
- `DFT('(A)')` — 引用符の中の括弧。括弧の対応だけで数えると壊れる。
- `CHECK(RZ RB)` — 引数の中の空白は区切りではない。
- `SFLCTL(NAME)` — 引数が名前。
- `CAnn` / `CFnn` — **名前そのものに数字**が入る（`CA03`）。原典は `CAnn`（CA01-CA24 の総称）と書く。
  → **調査の途中で、この 2 件が表から丸ごと落ちていることが判明した**（下記 F7）。
- `ALARM` — 引数なし。

→ 解析は「**引用符の外でだけ**括弧を数える」方式にする。`''` は引用符の中のエスケープ。

### F6: PJ にチップ / ヘルプの既定の流儀はまだ無い

`ui.css` にチップ用の様式は無い（プロパティは表形式の入力欄だけ）。
確定デザインのモック（`docs/design/dds-designer/mock-c1-standalone-first.html:1147`）は
**キーワードをチップで出し、`✕` と `＋ 追加` を添える**形を描いている。
また `<span class="chip none">未設定</span>` のように「無い」も明示している。
→ モックの形に寄せる（`✕` と `＋` は**この work では出さない**——編集は別の work なので、
押せないボタンを置くと壊れて見える）。

ヘルプの出し方は、この PJ のプロンプターが `F1` を使っている（AGENTS.md「各パラメータにも
個別にヘルプを設定でき、フォーカス中に F1 キーをクリックすることでパラメータのヘルプを参照できる」）。
→ **チップにフォーカスして `F1`** を同じ意味に割り当てる。

### F7: `CAnn` / `CFnn` が表から丸ごと落ちていた（別 work で修正済み）

原典の索引（`docs/origin/dds/DSPF-KEYWORDS.html`）から名前を機械的に取り出して表と突き合わせたところ、
**`CAnn` / `CFnn` の 2 件が表に無い**ことが分かった。生成側の正規表現が大文字しか受け付けず、
`nn` で弾かれていた。`CF03` は**このリポジトリのサンプル `docs/src/CUSTMNT.dspf` にも書かれている**。

この work のスコープ（表示）から外れるうえ、再生成データの差分が UI の差分に混ざるので、
**別 work に切り出して先に直した**（`20260827-dds-keyword-cann` / PR #113）。
表は 174 → **176 件**になり、`CAnn` / `CFnn` に構文
（`CAnn[(response-indicator ['text'])]`）とレベル（`file` / `record`）が付いている。

**引き当ては 2 段が必要**（`CA03` → そのまま引く → 見つからなければ `CAnn` に正規化して引く）。
原典の書き方をそのまま持つ判断（24 件に展開しない）は
`20260827-dds-keyword-cann/decisions.md` D3 に記録した。

## 影響範囲

- `src/core/dds/ddsKeywords.ts`（新規）— 解析と、解説の型・引き当て。
- `src/dds/webview/protocol.ts` — `load` に解説表を足す（**任意**。無くても動く）。
- `src/dds/editorProvider.ts` — 解説表を読んで `load` に載せる。
- `dev/standalone.ts` — 束ねた JSON を `load` に載せる。
- `src/dds/webview/ui.ts` / `ui.css` — チップと解説の表示。
- `src/core/dds/dspfRenderModel.ts` / `dspfOutline.ts` — **変更しない**
  （キーワードの生テキストはそのまま残す。解析は UI 側で表示のために行う）。

## 実現性 / リスク

- **リスク: 送るデータが大きい**（日本語 140KB）。`load` は文書を開いたとき 1 回なので許容範囲。
  毎回の `applied` に載せると往復のたびに 140KB になるので、**載せない**。
- **リスク: `CAnn` / `CFnn` の引き当て**。`CA03` は表に無いが**原典にあるキーワード**。
  「原典に無い」と出すと誤り（AC6 が誤検出を出す）。→ 下記の注意。
- **リスク: `protocol.ts` を変える**。直前 2 つの work では変えずに済ませたが、
  これは**表示の状態ではなくホストが持つ参照データ**なので、モデルと同じ扱いで載せてよい。
  互換のため**任意フィールド**にし、無ければ解説だけが出ない（AC7）。

## 実装アンカー

- A1: 解析の置き場（`vscode-extension/src/core/dds/ddsKeywords.ts` 新規）
  — 既存の `readConstant` / `keywordAreaOf` は `ddsLogicalUnits.ts` にある。
- A2: 解説の型（同上）— 既存の `DdsKeyword`（`src/language/ddsKeywordCompletion.ts:24`）と
  **同じ形**にする。片方を直したらもう片方も直る形にはできない（層が違う）ので、
  **core 側を正とし、補完側がそれを import する**。
- A3: `load` メッセージ（`src/dds/webview/protocol.ts:41`）。
- A4: VSCode 側の読み込み（`src/dds/editorProvider.ts:110` `case "ready"`）。
  読み込みの実装は `src/language/ddsKeywordCompletion.ts:96` `loadKeywords` が先例。
- A5: 単独起動側（`vscode-extension/dev/standalone.ts:13` の `import sample from …` が先例。
  JSON も同じ形で束ねられる）。
- A6: プロパティのキーワード欄（`src/dds/webview/ui.ts` `renderProperties` の
  `const keywords = document.createElement("input")` のあたり）。
- A7: 種別の判定（`src/core/sourceKind.ts` `resolveDdsType`）— 表の鍵（`DDS-DSPF`）に使う。

## 実装時の注意

- **`CAnn` / `CFnn` を「原典に無い」と言わない。** 表には `CAnn` の形で 1 件入っており（F7 で追加）、
  実際のソースには `CA03` と書かれる。引き当ては**そのままの名前で引く → 見つからなければ
  末尾 2 桁を `nn` に置き換えて引く**の 2 段にする。
  表で `nn` を含む名前は **`CAnn` / `CFnn` の 2 件だけ**（機械的に確認済み）。
- **引用符の中で括弧を数えない。** `DFT('(A)')` で壊れる。
- **並べ替えない・消さない。** チップは**ソースに書いてある順**で出す。
  読めない綴りも消さずに出す（消すと「直したのに残っている」の逆——
  「書いたのに無い」が起きて、原因が掴めなくなる）。
- **キーワードの生テキストを失わない**（AC8）。チップだけにすると、
  桁を数えたい人・コピーしたい人の手段が消える。
- `applied` / `rejected` で解説を送り直さない。UI 側が**最初に受け取った表を保持**する。

## spec への申し送り

- 解説表は `load` の**任意フィールド**として渡す（無ければチップだけ出る）。
- 引き当ては 2 段（そのまま → 末尾 2 桁を `nn` に正規化）。表の `nn` 系は `CAnn` / `CFnn` の 2 件だけ。
- `✕` / `＋ 追加` は出さない（編集は別 work）。
