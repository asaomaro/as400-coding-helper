---
backlog: prompter
kind: standing        # standing（定常ドメインキュー）| split（タスク分割由来・短命）
priority: 1           # 既存機能の構造改善。DDS(1) と同格
---
# F4 プロンプター バックログ

`vscode-extension/src/prompter/` と `src/extension/commands/showPrompter.ts` に関するキュー。

`aidev-util-batch` が消化する対象リスト。各未チェック行 = 1件のタスク。

## 項目

  **結果**: `restricted === false` かつ選択肢を持つ欄を `<select>` から
  **`<input list>` ＋ `<datalist>`** に変えた。**該当 108 欄**（`cl` / `cmd` の ja・en）。
  `ADDPFM` の `SRCTYPE` に `RPGLE` を打って確定し、書き戻し行に乗ることを画面で確認。

  - **新しい仕組みは足していない。** `<datalist>` はオブジェクト名の候補で
    既に動いている手段をそのまま使った。
  - **範囲そのものを検査した。** 後退を戻す検査 3 件のうち 1 件は**逆方向**——
    「制限のある欄まで自由入力にする」と落ちる。
  - 実測: 単体 1118 → **1121**、プロンプター e2e 57 → **62**、verify 19 検査は緑。

  **数えて分かったこと**: 108 欄のうち **57 欄は選択肢が 1 つしかない**。
  選択肢 1 つの `<select>` は選択ではなく**錠前**で、その欄は実質入力できなかった。
  件数は単体テストで固定してある（動いたら前提が変わっている）。

  **残した制限**: `<datalist>` が VSCode の WebView でどう見えるかは確かめていない
  （候補が並ぶことは DOM で確認済み。同じ仕組みが既に出荷されているので新しい risk ではない）。

- [x] **F4 プロンプターを VSCode 非依存（standalone 基準）に作り替え、Playwright で自律テストできるようにする** — 済（`20260828-prompter-standalone`）

  **狙い**: DDS ビジュアルエディタ（`20260826-dds-editor-port` / PR #109）で確立した構造
  ——判断はコア / UI は描くだけ / `acquireVsCodeApi` は bridge の 1 か所 / ホスト能力を宣言——
  をプロンプターにも適用し、**VSCode の外で動かして自動でテストできる**状態にする。

  **現状（2026-08-27 実測・現 main）**:
  - `src/prompter/` は **4,718 行 / 17 ファイル、うち 9 ファイルが `vscode` を import**。
  - UI は `binding.ts`（**1,401 行**）が HTML + CSS + インラインスクリプトを**文字列で組み立てる**。
    状態は WebView 内に持ち、確定時にまとめて受け取る作り。
  - 次に大きいのは `applyChanges.ts`(498) / `cdmlRules.ts`(394) / `clCommandParser.ts`(392) /
    `model.ts`(382) / `types.ts`(307)。**桁の書き戻しと検証はコア側に寄っており、再利用できる**。

  **参考にする実装**（PR #109 で動いているもの）:
  - `src/dds/webview/protocol.ts` — メッセージ契約 ＋ ホストが何を肩代わりするかの宣言
  - `src/dds/webview/bridge.ts` — `acquireVsCodeApi` の唯一の呼び出し箇所
  - `src/dds/webview/ui.ts` / `geometry.ts` — 素の web の UI と、純関数の座標計算
  - `dev/standalone.ts` / `dev/e2e.mjs` — 単独起動ハーネスと実操作 e2e（15 件）
  - `tsconfig.webview.json` — `types: []` で **WebView から `vscode` を型ごと締め出す**
  - `esbuild.webview.mjs` — WebView だけを束ねる（拡張ホストは tsc のまま）

  **規模の見立て**: DDS エディタ（新規 12 ファイル・約 4,000 行）と同等かそれ以上。
  **単独の work として起こす**（他の変更に混ぜるとレビュー単位が壊れる）。

  **非後退で守るもの**: F4 の起動経路（キーバインド・`resourceExtname` の条件）、
  定義 JSON の読み込み、可変パラメータ・グルーピング・ヘルプ（F1）、
  `applyChanges` の桁書き戻し、CL 往復検証（`npm run verify` の `verify:roundtrip`）。

  **結果（2026-08-29 実測）**:
  - `binding.ts` **1,401 行を削除**（HTML + CSS + インライン JS 827 行）。
    `src/prompter/` は 4,718 → **4,699 行 / 22 ファイル**、`vscode` を import するのは
    9 → **8 ファイル**で、**新しい 4 ファイル（`webview/`）はいずれも含まない**。
  - **判定の写しがゼロになった。** UI は `model.ts` / `visibilityRules.ts` / `cdmlRules.ts` を
    直接 import する。~~`dependsOn` と `constraints` は写しが手書き~~ という状態は解消。
    描画モデルから `evaluatorSpec` / `constraintFields` / `constraints` も落とした
    （写しを動かすためだけの荷物だった。復活は `test/unit/prompterWebview.test.ts` が検査）。
  - **単独起動 + e2e**: `dev/prompter.html` / `dev/prompter-e2e.mjs`。**57 件 / 1 回 8.6 秒**、
    **12 回連続で緑**。CI の `gui-e2e` に別ステップ（`if: always()`）で載せた。
  - **後退を戻すと落ちることを 7 件で確認**（`.aidev/works/20260828-prompter-standalone/verify/e2e-load-bearing.md`）。
  - 単体テスト 1084 → **1110**。`npm run verify` の 19 検査は緑のまま。

  **非後退で守るもの**（起票時に挙げたもの）はすべて維持:
  F4 の起動経路（`verify-contributes` 緑）／定義 JSON の読み込み（無変更）／
  可変パラメータ・グルーピング・ヘルプ（e2e で 1 件ずつ）／`applyChanges` の桁書き戻し
  （`commandText.ts` へ**中身を変えずに**移動し、往復検証 538 定義が緑）。

  **途中で見つけて直したもの**（起票時には見えていなかった）:
  - **選択肢に無い値が確定で消える**。実機が `Rstd=NO` と言う 86 欄では列挙値以外を書けるが、
    `ADDPFM SRCTYPE(RPGLE)` は旧実装だと先頭の `*NONE` に化けていた。**旧実装から続く欠陥。**
  - **F5 の `preLaunchTask` が `compile` だけ**で、束ねた資産が無く**画面が真っ白**になる
    （DDS ビジュアルエディタも同じ穴だった）。`compile:all` を足した。

  **残した制限**: `retainContextWhenHidden: false` のままで、隠して再表示すると入力が初期値に戻る。
  旧実装でも同じ挙動なので後退ではない。

  出所: ユーザー要望（2026-08-26）。

- [x] **`restricted:false` の選択欄で、列挙外の値を打てるようにする** — 済（`20260828-prompter-open-choices`）

  `attributes.restricted:false` は**検証を緩めるだけ**で、画面は `<select>` のまま。
  `<select>` である以上、**列挙に無い値は打てない**。実機が `Rstd=NO` と言う欄では
  列挙値以外を書けるので、これは「正しい入力を弾く」欠陥にあたる。

  **該当は CL の 86 欄**（`ADDPFM` の `SRCTYPE` は定義済み値が `*NONE` だけで、
  `RPGLE` と打てない）。`20260828-prompter-standalone` で
  **ソースに書かれていた値は選択肢に足す**ようにしたので値が消えることは無くなったが、
  **新しく打つことはできないまま**。

  直し方の見当: `SerializableField` に `restricted` を載せ、`ui.ts` の `buildControl` が
  `dropdown` かつ `restricted === false` なら `<input list=...>` ＋ `<datalist>` を描く。
  DDS/CL 両方に効く。

  出所: `20260828-rpg3-fspec-continuation-options` の review（同じ問題を
  `inputType:"text"` で**回避**したが、回避であって解決ではない）。

- [x] **F4 の統合テストが止まる問題を直す** — 済（`20260828-f4-integration-test`）。
  待つのをやめ、「一定時間 reject しないこと」で**起動できること**だけを見る。
  送信／取消の振る舞いは WebView の e2e が実物で確かめている。
  - **起票より壊れている範囲が広かった。** `await` を直しても走らない状態だった:
    `vscode-test` が**依存に入っておらず**、`test/suite/index.ts` は `bdd` で
    `suite` / `test` を拾えず、対象も 1 つ上（**単体テストまで拡張ホストで走る**）を
    見ており、走らせる npm スクリプトも無かった。器ごと直した。
  - **`mocha` に時間切れ（20 秒）を持たせた。** 次に誰かが `await` を書いても、
    その 1 本が落ちるだけで**スイートごとは死なない**。戻して確かめ済み——
    止まる形は 20 秒で落ち、他の 1 本は通った。
  - `npm run test:integration` で走る（手元で 3 passing / 終了コード 0）。
    CI にも `integration` ジョブとして載せた（Electron を動かすので `xvfb-run`）。
  - **いま確かめているのは「例外なく起動できる」まで**。`WorkspaceEdit` や undo は
    まだ書いていないが、**器が動くようになったので次から足せる**。


- [x] **英語版 DDS 定義に日本語が混ざる（146 箇所）** — 済（`20260829-dds-en-labels`）。
  **146 箇所 → 0 箇所**。日本語版の出力は **1 バイトも変わっていない**。
  - **英語の桁抽出は一度も動いていなかった**。`generate-dds-columns.mjs` は `--lang=en` を
    受けるが、英語原典は `(positions N through M)` と**数字の前**に語を置くため、
    日本語向けの正規表現と構造が合わず **14 欄中 4 欄**しか取れていなかった。
  - **平文ではなくリンクの文言から採る**ようにした。英語は語を空白で区切るので、
    平文だと**ラベルが前の文を巻き込む**（実測で `A K ITMNBR ABSVAL A Sequence number`）。
  - `Positional entries`（表示装置が先頭 3 欄をまとめて書く見出し）を欄として採ると
    補完が働かず **14 → 12 欄**に減る。日本語側と同じく除外した。
  - 生成器に散っていた日本語（種別名・欄の説明・ブランクの接頭辞）を `STRINGS` に集約。
  - **検査を足した**（`verify-dds-prompter.mjs`）: 英語版に日本語が無いこと・桁が日英で
    一致すること。混ぜると**どのキーに何が入っていたか**まで出る。RPG 側と同じ趣旨。
  - **起票時の見立ては外れた**。~~直し方は RPG に前例がある——訳文を 1 ファイルに集める
    （`rpg-spec-en-strings.json` に相当するものを DDS 用に作る）~~ 訳文ファイルは要らなかった。
    欄の名前は**英語原典に見出しとして書かれている**ので、そこから生成すれば済む。
    RPG が訳文を要したのは、原典の文が自由形式の構文説明で欄の説明に使えなかったため
    （AGENTS.md）で、DDS は事情が違った。
  - 実測: 単体 1150 件（+2）・verify rc=0・e2e 71/182。
  出所: `20260829-dds-restricted-expand` の review（should-2）。

<!-- 2026-09-27 実操作調査（本物の VS Code で RPG・CL を書き、実機でコンパイルした）。根拠は docs/research/20260927-f4-prompter-exploration/findings.md -->

- [x] **ソースの 4 行目だけ書き戻さない不具合を直す**（最優先）— 済（`20260926-prompter-line4-guard`）。原因はデバッグの残骸ではなく初期の仕様 FR-031（4 行目の 1〜6 桁目を変えない）で、行全体を置き換えるので丸ごと拒まれていた。先頭 6 桁が同じなら 7 桁目以降だけを書くようにした。`src/language/rpgEditGuards.ts:11` の `if (line === 3)` がデバッグ用の固定値のまま残り、
  `applyChanges`（DDS 以外＝RPG と CL）で 4 行目を必ず拒否する。拒否はログだけで利用者に出ない（docs/research/20260927-f4-prompter-exploration/findings.md の P2）。Tab 移動（`rpgTabNavigation.ts:371,397`）も同じ判定を使う。
- [x] **桁幅を超える値を黙って切り捨てない**（データを壊す・最優先）— 済（`20260927-prompter-column-overflow`）。桁の決まった欄は桁幅を超えるとエラーで確定を止める。`buildRpgLineText` の `slice(-sourceLength)` が左から切り、`EVAL` の式や
  `EXTPROC` が化ける（docs/research/20260927-f4-prompter-exploration/findings.md の P3）。定義側も `maxLength` が桁幅より大きい欄がある（C の演算項目 30＞14、D の KEYWORDS 40＞37、FROM 30＞7）。
  桁幅を超えたら欄にエラーを出して確定を止める。
- [x] **欄を桁の決まりどおりに寄せる（左詰めしない）**— 済（`20260927-prompter-column-layout`）。定義の `columnLayout`（右寄せ・DDS の条件付け・行と桁）で置き、C の結果標識は 3 欄に分けた。実機でコンパイル可。trim の後に左詰めするので、C の条件標識（9-11）・結果標識（71-76）、D の開始・終了位置
  （実機 RNF0263 × 7）、DDS の条件付け・位置・小数が正しい桁に入らない（docs/research/20260927-f4-prompter-exploration/findings.md の P4）。DDS の位置は行・桁を 1 欄にしている定義側も直す。
- [ ] **H 仕様書を書き戻す・読み込む**（docs/research/20260927-f4-prompter-exploration/findings.md の P1）。欄はキーワード形式で桁を持たず、`buildRpgLineText` が桁の無い定義で `return original` する。
  キーワードの組み立てと解析が要る。
- [x] **C 仕様の新旧（C-SPEC / C-NEW）の判定を 26-35 桁の命令で行う** — 済（`20260927-prompter-cnew-by-opcode-column`。P5・P10。P15 は下に分けた）（docs/research/20260927-f4-prompter-exploration/findings.md の P5）。`rpgSpec.ts:299-311` `classifyCSpec` が 7 桁目以降の最初の語を
  命令とみなし、`EVAL(H)` や条件標識つきの行を旧形式で開く（式が P3 で壊れる）。同じ判定の lint も誤検知する。あわせて C-NEW に条件標識（9-11 桁）の欄（P10）と、
  空行・空の `C` から新旧を選んで開く入口（P15）。
- [ ] **空行・空の `C` から C-SPEC / C-NEW を選んで開く入口**（P15。上の新旧判定から分けた）。いまは 26 桁目に命令を手で打ってからでないと C-NEW が開かない。
  選ばせ方（F4 で種類の一覧を出す／プロンプター内で切り替える等）の判断が要る。
- [x] **英大文字だけに縛っている欄を実機に合わせる** — 済（`20260927-prompter-mixed-case`。DDS のキーワード欄と ILE RPG の名前欄）: DDS のキーワード欄（日本語・小文字の定数が書けず、既存の日本語定数の行は無変更でも確定できない）、
  RPG の名前欄（ILE は大小文字を混ぜてよい）（docs/research/20260927-f4-prompter-exploration/findings.md の P6・P12）。`characterSet: "upper"` の付け方を原典で見直す。
- [ ] **RPG 仕様書の定義の不足をまとめて直す**（docs/research/20260927-f4-prompter-exploration/findings.md の P7・P8・P9・P11・P23）: 必須が強すぎる欄（D の LEN・F の継続行・P の E 行・C-NEW の COND）／
  D のデータ・タイプに N・G・C・U・* が無い／表示されない欄（D の小数、F の LIMITS・RECADDR・FILEORG＝`K` が書けない）／F 仕様のラベルの桁番号の誤り
  （`docs/ILE_RPG_Fixed_Format_Reference.md:160-172` の表も誤り）／F のファイル・タイプ `O` とファイル指定の組み合わせの検査（実機 RNF2040）。
  **原典と機械的に突き合わせて直す**（AGENTS.md）。
- [ ] **CL: 空白・日本語を含む値を引用符で囲む、DBCS の SO/SI を桁計算に入れる**（docs/research/20260927-f4-prompter-exploration/findings.md の P13・P14）。いまは `MSG(… で印刷エラー…)` と書いてコンパイルできず、
  SO/SI を数えないので 72 桁の折り返しも RPG の桁（MOVEL の演算項目 2）もずれる。
- [ ] **プロンプターの軽微な項目 7 件**（docs/research/20260927-f4-prompter-exploration/findings.md の P16〜P22）: CL の既定値の出し方の不統一／DCL の LEN が F10 の奥・ヘルプの表抜け／C の F1 ヘルプが命令と無関係・
  命令の候補が無い／F12・F3 で取り消せない／確定後に次の行へ進まない／D の名前の `...` 継続が書けない／誤解を招く placeholder。

