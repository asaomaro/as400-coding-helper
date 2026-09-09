# レビュー: DDS を一から作れるようにする（新規作成とレコード様式）

## ラウンド 1（2026-09-08）

差分: 17 ファイル変更 ＋ 3 ファイル新規（+1309 / -66 行）。
点検は主エージェントが実施（原典照合を含むため委譲しない。protocol.md「2.6」）。
併せて組み込みのレビューコマンドを**併用**した（protocol.md「2.5」）。

### 到達可能性 / 配線（この PJ の必須観点）

**消費経路を名指しで辿った。**「追加したリソースは到達可能になって初めて完了」。

| 追加したもの | 経路 | 確認 |
|---|---|---|
| 新規作成コマンド | `package.json contributes.commands` → `language/registration.ts:59 registerDdsVisualEditor` → `editorProvider.ts registerCommand(NEW_DSPF_COMMAND)` → `createDdsFile` → `buildDdsTemplate` → `workspace.fs.writeFile` → `executeCommand("vscode.openWith", uri, DDS_EDITOR_VIEW_TYPE)` → `customEditors[].selector` の `*.dspf` | ✓ 単体 6 件が実際に押して確かめる。`verify-contributes.mjs` が宣言の一致を機械検査 |
| `addRecord` / `removeRecord` | `ui.ts send()` → `bridge.post` → `parseEditorMessage` → `parseEdit` → ホストの `handle("edit")` → `validateDdsEdits` → `applyDdsEdits` → `WorkspaceEdit`（VSCode）/ `splice`（単独起動） | ✓ e2e が両端で確かめる |
| `findDanglingReferences` | `buildDspfRenderModel` / `buildPrtfRenderModel` → `model.diagnostics` → `renderDiagnostics`（検証タブ）＋ `updateDiagnosticsBadge`（件数バッジ） | ✓ e2e「消した様式を指す参照が検証タブに出る」。バッジは `model.diagnostics.length` を数えるので自動で乗る |
| `＋` / `✕` | `template()` の `pane-head` → `must(root, "#dds-add-record")` → `wireAddRecord` ／ `renderOutline` の `li.record` | ✓ e2e が押して確かめる |
| `buildDdsTemplate` | VSCode（`createDdsFile`）と単独起動（`startNew`）の**両方**が同じ関数を通る | ✓ 単体が両ホストの内容一致を固定 |

**列挙の同期漏れ**も見た。`RenderDiagnosticCode` に `DanglingReferenceCode` を足したが、
**lint は `resolveDspfLayout` / `resolvePrtfLayout` を直接呼ぶ**（`src/lint/rules/layout.ts:55`）ので
描画モデルの診断は流れ込まない。`src/lint/types.ts` の規則 ID を増やす必要は無く、
lint の SARIF に未宣言の規則が出ることも無い（実際に出ないことを CLI で確認）。

### 指摘

#### 組み込みレビュー（併用）が出したもの

**鵜呑みにせず 1 件ずつ裏を取った。3 件とも実在した。**

- [must] **保存ダイアログが確かめていないパスに書いている**（既存ファイルが黙って消える）
  — `src/dds/editorProvider.ts`。`showSaveDialog` が衝突を見るのは**利用者が打ったパス**だけ。
  こちらは拡張子が種別と合わないと `target.with({ path: … + ".dspf" })` で
  **別のパス**へ書くので、その先の衝突は誰も確かめていない。
  再現: フォルダを右クリック → 新しい画面ファイル → `CUSTMNT` と打つ（拡張子なし）→
  ダイアログは `CUSTMNT` に衝突が無いので確認せず返す → `CUSTMNT.dspf` を
  **2 行の雛形で上書きする**。開いていないファイルなので `WorkspaceEdit` ですらなく、**undo が無い**。
  → **直した**: 書く先がダイアログの答えと違い、かつ既にあるときだけ、
  ダイアログが出したはずの確認をやり直す（`fileExists` ＋ モーダルの警告）。
  **D4（確認を出さず undo に委ねる）とは矛盾しない**——あれは*取り消せる*操作の話で、
  消えたら戻らないものには当てはまらない。単体 4 件を足し、確認を外すと落ちることを確認。

- [should] **最後の様式を消すと焦点が行き場を失う**
  — `neighbourRecordName` は隣が無いと `undefined` を返し、`removeRecord` がそれを
  `pendingSelectRecord` に入れていたため、`applied` の分岐が**丸ごと飛んで**焦点が
  body に落ちていた。`＋` へ戻すと書いたコメントの経路が**到達不能**だった。
  再現: 新規 DSPF（様式 1 つ）→ その `✕` を押す → キーボードだけの人は
  そこから Tab の起点を失う。e2e の AC12 の節は削除はしていたが焦点を見ていなかった。
  → **直した**: 「選ぶ」と「焦点を移す」を**別のフィールドに分けた**
  （`pendingSelectRecord` / `pendingRecordFocus`）。焦点の行き先は「選べた様式、無ければ `＋`」。
  e2e に「**最後の様式を消したら ＋ へ焦点が移る**」を足し、戻すと落ちることを確認。

- [should] **様式名の突き合わせで大文字小文字が食い違う**
  — `applied` は `record.name.toUpperCase() === target` で比べるのに、
  `neighbourRecordName` と `place()` は名前を**そのまま**控えていた。
  `ddsName`（`ddsLayout.ts:132`）は桁を切って trim するだけで**大文字化しない**ので、
  `R first` と小文字で書かれたソースでは `"FIRST" === "first"` になり引き当てに失敗する。
  デザイナは追加も改名も大文字で書き出すため、**読み込んだソースにしか現れない形**。
  → **直した**: 突き合わせ側で両方を大文字にそろえる（1 か所）。
  小文字の様式名を持つ見本（`lowercase-names.dspf`）を単独起動に足し、
  e2e で「隣へ焦点が移る」ことを確かめた。そろえるのを外すと落ちる。

> **この 3 件は自分の点検では出なかった。** どれも「押すと分かるが読んでも気付きにくい」形で、
> とくに 1 件目は**利用者のソースが消える**もの。併用した値打ちがあった。

#### 自分の点検で出たもの

- [must] `✕` が**キーボードで押せない**（見出しの `keydown` が Enter を横取りする）
  — `src/dds/webview/ui.ts:998` の `isOwn` は「一番内側の `li` が自分か」だけを見ており、
  見出しの中の `button` にフォーカスして `Enter` を押しても `preventDefault()` ＋
  「様式を選ぶ」に化けて、**click イベントが出ない**。クリックは `stopPropagation` で
  止まるがキーは止まらない。自分で書いたコメント「Tab で届き、マウス専用にはならない」が
  成立していなかった。
  → **直した**: `isOwn` から `target.closest("button") !== null` を除く。
  e2e に「**✕ は Enter でも押せる**」を足し、判定を外すと落ちることを確認した。

- [should] `recordAt` の選択優先が**必要以上に広く、既存の配置の振る舞いを変えていた**
  — `src/dds/webview/ui.ts` の追加先の決定で「様式の見出しを選んでいたら常にその様式」に
  していたが、見出しは `OVERLAY` / `CF03` を読むためにも選ぶ。そのままキャンバスを押した人は
  「押した行の様式に入る」と思っている。この作業が必要としていたのは
  **行の見当が原理的に届かない様式（項目 0 件）だけ**を救うことだった。
  → **直した**: `selectedEmptyRecord()` に絞り、項目を持つ様式では従来どおり行の見当に任せる。
  e2e に「**項目を持つ様式を選んでいても、押した行の様式に入る**」を足し、
  絞り込みを外すと落ちることを確認した。

- [nit] `applied` のたびに `＋` の入力欄が閉じる
  — 外部のファイル変更などで `applied` が届くと、入力中の様式名が消える。
  ただし**既存のプロパティ入力欄（`recordNameInput` 等）も `render()` で作り替わり同じ**なので、
  この作業だけ別の作法にしない。実害の出る筋（入力欄を開いたまま外部変更が届く）が細い。
  → 直さない。

- [nit] `verify-contributes.mjs` が `NEW_FILE_EXTENSION` を**正規表現で読んでいる**
  — `"DDS-DSPF":\s*"\.([a-z0-9]+)"` の最初の一致を採るので、同じ鍵を持ち値がドットで始まる別の表を
  `editorProvider.ts` の前方に置くと誤読しうる。いまは `NEW_FILE_NAME`（値がドットで始まらない）
  としか同居しておらず、壊して落ちることも確認済み。
  → 直さない（原典生成スクリプト群と同じ「ソースを読む」流儀に揃えてある）。

- [nit] `explorer/context` の `navigation@3` / `@4`
  — この拡張の他の項目がこのメニューに無いので、番号は順序に意味を持たない。
  VSCode 組み込みの項目との相対順だけが効く。害は無い。

### 検査が本当に守っているかの確認（壊して落とす）

このラウンドで直した 5 件すべてについて、**直す前に戻すと落ちる**ことを確かめた。

| 直したもの | 戻し方 | 結果 |
|---|---|---|
| 上書きの確認 | 条件を `false` に | 単体 **1 件 FAIL** |
| 最後の様式で `＋` へ | 隣が無いとき焦点を動かさない形へ | e2e **1 件 FAIL** |
| 大文字にそろえる | `toUpperCase()` を外す | e2e **1 件 FAIL** |
| `✕` のキーボード | `isOwn` から button の除外を外す | e2e **1 件 FAIL** |
| `recordAt` の絞り込み | 常に選択優先に戻す | e2e **1 件 FAIL** |

> 1 件、**最初に戻したものが間違っていた**（「最後の様式で `＋` へ」で `?? null` を外したが
> テストは通ったまま）。実際に効いていたのは**フィールドの分離**の方で、
> そちらを戻して初めて落ちた。**「戻して落ちた」まで見ないと、どの変更が効いているか分からない。**

### 価値適合（目的の状態に本当に到達するか）

requirement の目的は
**「テキストエディタに一度も戻らずに、DSPF / PRTF を一から作り上げられる状態」**。
journey を最初から辿って、残る行き止まりを探した。

| 段階 | デザイナだけでできるか |
|---|---|
| 新規作成 | ✓（この作業） |
| 様式を足す / 消す / 改名する | ✓（追加・削除はこの作業、改名は既存） |
| 項目を置く / 動かす / 長さ / 属性 / キーワード / 条件 | ✓（既存） |
| **ファイル・レベルのキーワードを足す** | **DSPF は ✓ / PRTF は ✗** |

- [nit] **PRTF の雛形にはファイル・レベルの行が 1 本も無いので、`LPI` / `CPI` のような
  ファイル・レベルのキーワードをデザイナから足せない**（実測: PRTF 雛形の `fileKeywords` は 0 件）。
  一覧は既存の行があるときだけ「ファイル」の見出しを出すので、行が無いと入口が無い。
  DSPF は `DSPSIZ` を書くので入口がある——**この非対称は D8（帳票に画面サイズ相当を書かない）の帰結**。
  - **この作業では直さない。** 受け入れ基準に無く、原典に「帳票の雛形に書くべきキーワード」の
    根拠も無い（無根拠のキーワードを雛形に入れるのは D8 が退けた形そのもの）。
    そもそも**ファイル・レベルの行を「作る」手段はこのデザイナに元から無い**（既存の行を直せるだけ）。
  - → **follow-up に出し、PR の「既知の制約」に書く。**

### 要件適合

`requirement.md` の AC1〜AC12・AC-I1〜AC-I5 の **17 項目すべてに検証がある**
（対応は `test-result.md` の表）。`tasks.md` は 17 タスクすべてチェック済みで、
coding 中に足したタスクは無い（spec の対象範囲とファイル単位で一致）。

`decisions.md` に 4 件（D1 追加先の順序 / D2 参照の範囲 / D3 引数の既定値 / D4 AC-I2 の矛盾）。
**D1 は spec.md 本文にも反映済み**で、spec と実装が食い違ったままになっていない。

### 規約適合（AGENTS.md）

| 条項 | 確認 |
|---|---|
| 桁の規定を写さない | 行の組み立ては `DDS_COLUMNS` ＋ 既存の `buildKeywordLine` / `ddsReplaceField` を通す。`buildRecordLine` に桁の数字は無い |
| 原典から機械的に決まるものは生成・検査 | 雛形の `DSPSIZ(24 80 *DS3)` は `dspfScreenSize.ts` の原典引用に基づき、値は原典の 2 つのうち既定の側 |
| UI に `vscode` を持ち込まない | `ui.ts` の追加分は DOM と `protocol.ts` だけ。`tsconfig.webview.json` の `types: []` で通る |
| 同じ概念集合を複数箇所で列挙しない | 拡張子は `resolveDdsType` に判定させ、集合を数え上げていない（`filters` を付けなかったのはこのため）。診断コードは lint に漏れない |
| 一度出た欠陥はテストに足す | 「黙って壊れる」3 種（空の様式が消える / 上書き行が孤児になる / 参照が浮いても何も出ない）を単体に固定 |
| テストを足したら、直す前に戻して落ちることを確かめる | **9 通り**で確認（test 工程の 4 件 ＋ このラウンドで直した 5 件） |
| 期待値そのものを原典で裏取り | 名前 10 桁は既存の `NAME_WIDTH`、`DSPSIZ` は既存の原典引用を使い、テストに数字を書き写していない |
| 改名・削除の直後は `rm -rf out out-test` | 実施（`test-result.md`） |

### 保守性

- 拒否コードを 1 つも増やしていない（既存の 4 つを再利用）。
- `validateRecordRename` から名前の検査を切り出して**改名と追加で共有**——写していない。
- `recordRemovalRuns` は `removalRuns` と**同じ流儀**（連続する塊ごと・注記行は残す）で、
  片方だけ直すと食い違う形にはなっていない。
- 新規 core モジュールは 2 本とも 100 行以下で、判断を 1 つずつしか持たない。

### このラウンドの判定

**must 2 件 / should 3 件**が出たので coding へ差し戻す。指摘はすべて反映済み。
差し戻しの記録（`sent_back` ＋ `approved` からの `test` / `coding` の取り消し）を
先に打ってから、修正後の再検証をやり直す。

> **`nit` の 4 件は直さない。** それぞれ理由を上に書いた。
> うち PRTF のファイル・レベルは **follow-up ＋ PR の「既知の制約」** に出す。

## ラウンド 2（2026-09-08）

ラウンド 1 の must / should を反映したあとの再点検。

### 指摘

**無し。** 新たな must / should / nit は出ていない。

### 確かめたこと

| | 結果 |
|---|---|
| `npm test` | 1215 passed / 0 failed |
| `node dev/e2e.mjs` | 225 / 225 PASS |
| `npm run verify` | exit 0 |
| `npm run test:integration` | 3 passed / exit 0 |

- ラウンド 1 の 5 件は**すべて、直す前に戻すと落ちるテスト**で固定されている（上表）。
- 2 回目の差し戻しではないので、「前ラウンドの修正に由来する指摘か」の問いは立たない。
- 到達可能性・列挙の同期漏れ・規約適合・価値適合は**ラウンド 1 の結論のまま**
  （直したのは編集の宛先と焦点の扱いで、配線と概念集合には触れていない）。
