# 判断記録: 20260926-rpgunit-ifs-deploy

## D1: full・autonomous、マージまで自律（2026-09-26）

- ユーザーの回答（aidev-00-start の確認）: 規模は full、進め方は「自律で PR・マージまで」。
- ハーネスの autonomous は「PR で停止・auto-merge しない」が既定だが、**ユーザーがマージまでを明示した**ので、
  CI 緑・実機 E2E 合格を条件にマージまで進める。仕様の判断が要る点はユーザーに確認する。

## D2: requirements の前に実機で `SRCSTMF` の可否を確かめた（2026-09-26）

- backlog の起票時点の未確定事項「IBM i 7.3 の `RUCRTRPG` で `SRCSTMF` が使えるか」は、方式が成り立つか
  そのものなので、要件を書く前に確かめた（`verify/probe-srcstmf.mjs`・`verify/probe-stmf-ccsid.mjs`）。
- 結果: `SRCSTMF` は受け付けるが、ストリームのタグ 1208 は `CPE3490` で開けない。819 / 1252 は動く。943 は重大度 40。
  対照: `CHGJOB CCSID(5035)` を明示しても変わらない。
- **帰結**: 文字コードの扱いが未確定のまま design に進むと方式を選べない。protocol「4.5」の
  「技術的実現性が未確認」に当たるので **research を実施する**（autonomous は条件に当たれば実施）。

## D3: 道具（`tools/run-rpgunit.mjs`）も対象に含める（2026-09-26）

- 前の work（#181）で VS Code と道具を同じ共通部品に揃えた。IFS 方式を VS Code だけに入れると、同じ
  `*.test.rpgle` が道具では回らない——揃えた目的（どちらで回しても同じ判定）が IFS 方式で崩れる。
- 採らなかった案: VS Code だけ対応し、道具は後続 work。→ 共通部品の形（メンバーと IFS の 2 方式）を
  この work で決めるので、後から道具を載せると形の決め直しになりうる。

## D4: VS Code 側の展開は Code for IBM i のデプロイに乗る（2026-09-26・ユーザー判断）

- ユーザーの回答（design 中の確認）: 「Code for IBM i のデプロイに乗る」。
- 理由: コピー句を含むワークスペースが確実に届く（`/COPY` の解決を拡張側で真似しない）。IBM i Testing と同じ
  （research F11）。charter の「Code for IBM i が持つ機能は再実装しない」。
- 採らなかった案: テストとコピー句だけ自前で送る（`/COPY` の解決を拡張側で真似る。読み切れない書き方で届かない）／
  両方持つ（経路 2 つ・検証 2 倍）。
- デプロイ先が未設定なら errored にして設定方法を出す（勝手に既定の場所へ置かない。`launchDeploy` は未設定だと
  エラーダイアログを出す——`codefori/vscode-ibmi` 3.0.13 `deployTools.ts` 146-150 行——ので、呼ぶ前に `getRemoteDeployDirectory` で確かめる）。

## D5: デプロイの方法（2026-09-26）

- 利用者が Code for IBM i に既定のデプロイ方法を設定していて、**それがこの環境で使えるなら**任せる（`launchDeploy` に方法を渡さない）。
  使えない既定（`compare` なのに `md5sum` が無い・`staged`/`unstaged` なのに Git 拡張が無い・候補に無い値）を渡すと Code for IBM i が
  選択の UI を開いて実行が止まる（3.0.13 `deployTools.ts` 98-127 行）ので、そのときは既定を無視して下の方法を渡す（T4 の点検の指摘）。
- 未設定なら `compare`（MD5 比較。`remoteFeatures.md5sum` があるとき）、無ければ `all` を渡す。
  **`changed` は使わない**——拡張を起動してから変わったファイルしか送らないので、初回に要るファイルが届かないことがある
  （`deployTools.ts` の `getDeployChangedFiles`）。方法を渡すと選択の UI は出ない（research F14）。
- 1 回のテスト実行で、ワークスペース・フォルダーごとに 1 回だけデプロイする（ファイルごとには送らない）。

## D6: 主ソースだけを `CPY TOCCSID(*JOBCCSID) DTAFMT(*TEXT)` で一時ファイルへ写してコンパイルする（2026-09-26）

- 実機: タグ 1208 の主ソースは `CPE3490`。5035 / 1399 に変換した写しは日本語の注記・リテラルとも通る（research F2）。
  コピー句は 1208 のままで読める（F5・`verify/probe-stmf-details.mjs` D2 で日本語リテラルも確認）。
  `*JOBCCSID` はジョブの CCSID（5035）に変換される（同 D1）。
- 写しは元と別の場所に置くので、`INCDIR` に **元のテストのディレクトリ → デプロイ先の最上位** の順で渡す
  （コンパイラーは主ソースのディレクトリも探すが、写しのディレクトリになるため。F6・I6 の対照）。
- 採らなかった案:
  - ツリーごと変換（F7）: 毎回ワークスペース全体を写すのは重く、写しの場所に古いファイルが残る。
  - 接続のジョブの CCSID を変える: 他の処理を巻き込む（F3）。
  - 固定の CCSID（5035）: 英語環境で意味を持たない。ジョブに合わせる方が自然。
- **コピー句は変換しない**。requirements FR6 は当初「テストと同じ文字コードの扱いを受ける」と書いていたが、実機ではコピー句は 1208 のまま
  日本語の注記・リテラルとも正しく読める（research F5・`probe-stmf-details.mjs` D2）。要るのは「正しく読める」ことで、同じ手段は要らない。
  FR6 の文言をそう直した（design の doccheck の指摘）。

## D7: テスト・プログラムの名前とライブラリーは IBM i Testing に揃える（2026-09-26）

- 名前: `getSystemNameFromPath` と同じ規則（Source Orbit 由来。`.test` を外し `T` を前置、10 文字に詰める。research F9）。
  同じ `*.test.rpgle` が IBM i Testing と同じ名前になる（差し替えの目的。requirements 背景）。
- ライブラリー: VS Code は Code for IBM i の接続設定の現行ライブラリー（F10・F20）。IBM i Testing はその前に
  `libraryList.currentLibrary`（ワークスペースの `.env` など Code for IBM i のアクションの設定から作るライブラリー・リスト）を見るが、
  それは Code for IBM i の `getLibraryList` の実装に依るもので公開の型に無い。この work では接続設定だけを見る（ワークスペースごとの
  現行ライブラリーは後続で要望があれば足す）。道具は Code for IBM i を持たないので
  これまでどおり `--lib` / `AS400_LIB`。
- 規則で作った名前が IBM i の名前として不正（`.` を含むなど）なら、Test Explorer には出したうえで実行時に errored にし理由を出す
  （黙って消さない）。

## D8: 道具は git の最上位にある RPG のソースを IFS へ送る（2026-09-26）

- 道具には Code for IBM i のデプロイが無い。`git ls-files --cached --others --exclude-standard`（追跡済みと、無視されていない未追跡）の RPG ソース
  （`.rpgle` `.sqlrpgle` `.rpgleinc` `.rpginc` `.inc` `.cpy`、大文字小文字を問わない）を `<AS400_IFS_DIR>/rpgunit/<最上位のディレクトリ名>/` へ
  同じ相対パスで送る（タグ 1208）。未追跡も含めるのは、書いたばかりのコピー句が届かない失敗を避けるため。
  git でなければソースのディレクトリだけ。このリポジトリの追跡済みでは 7 本（2026-09-26）。
- 実行後は送ったものを消す（`--keep` なら残す）。これまでの IFS の作業ファイルと同じ扱い。
- コンパイル以降（変換・`INCDIR`・`RUCRTRPG`）は VS Code と同じ共通部品（D6）。

## D9: architecture は挟まない（2026-09-26）

- protocol「4.5」の 4 条件: 共通部品と接続（adapter）の分け方は #181 で決めたものをそのまま使い、新しい依存の向きは作らない。
  新しい共通部品（`streamTarget.ts`）は同じ層に 1 つ足すだけ。データ構造は判別共用体 1 つ。→ 当たらない。

## D10: VS Code 側の使い方は `docs/workflow/rpgunit-test-explorer.md` に書く（2026-09-26）

- requirements は「拡張機能の README」に書くとしていたが、`vscode-extension/README.md` は存在しない。Test Explorer 統合（#178〜#180）の
  使い方もどこにも書かれていない（`docs/` と `README` を `Test Explorer` / `testing.json` で grep して 0 件）。
- 既存の手順書の置き場（`docs/workflow/rpgunit-install.md`・`ibmi-dev-workflow.md`）に並べて新規に作り、メンバー方式・IFS 方式・
  `testing.json` をまとめて書く。requirements の AC12 と非機能要件の該当箇所をこの名前に直した。

## D11: 変換した写しは結果 XML と同じ一時ディレクトリに置く（2026-09-26）

- 候補は 2 つ: デプロイ先の配下（`<deployRoot>/.rpgunit/`）／接続の一時ディレクトリ（結果 XML の置き場。`SuiteConnection.tempDirectory`）。
- 一時ディレクトリを採る。デプロイ先は利用者のワークスペースの写しで、そこに拡張が自分のファイルを書くと、利用者の `compare` デプロイ
  （ローカルに無いものを消す）や IFS の閲覧に拡張の都合が混ざる。一時ディレクトリはメンバー方式から結果 XML を置いている場所で、使い終えたら消す。
- requirements の非機能要件「IFS に書くのは展開先の配下だけ」を、「展開先の配下と、これまでどおりの一時ディレクトリ」に直した
  （design の doccheck の must 指摘。書き直す前は既存の結果 XML とも食い違っていた）。

## D12: 道具の「IFS へ送れない」は単体テストの対象にしない（2026-09-26）

- requirements AC10 は「IFS に書けない」も単体テストで確かめるとしている。VS Code 側（デプロイの失敗）は `codeForIbmi.test.ts` で確かめるが、
  道具の IFS への送信は hostserver の接続そのもので、道具には接続部分の単体テストの仕組みが無い（self-test は純粋な部分だけ）。
  実機で書き込みを失敗させる（権限を奪う）操作もしない。
- 代わりに、送信の失敗を終了コード 2 とメッセージにする分岐を review でコードを読んで確かめる。道具の他の接続の失敗（SQL ジョブが張れない等）も
  単体テストしていない現状と揃う。

## D13: T11（回帰と CI）は test 工程と deliver で消化する（2026-09-26）

- T11 は実装ではなく実行結果の確認（`npm test`・実機 E2E・PR の CI）。coding の承認時点では未チェックで残り、test 工程で E2E と
  `npm test`、deliver で CI を確かめてチェックする（aidev-30-tasks 手順 6 の「coding ではなく test / deliver で消化する」）。

## D14: `*.test.rpgle` は置き場所を問わず IFS 方式を先に判定する（2026-09-26・coding 中の判断）

- T5 の点検で分かった: `resolveMemberTarget` は拡張子を外した後、最初の `-` でメンバー名とテキストに分ける。そのため
  `src/L/F/calc-add.test.rpgle` はメンバー方式の規則で「メンバー CALC・テキスト add.test」になり、design が前提にした
  「`.` を含むのでメンバー方式にならない」（research 申し送り）は `-` を含む名前では成り立たなかった。IFS 方式のつもりのファイルが
  既存メンバー `L/F(CALC)` を上書きしうる。
- 規則を「**ファイル名が `.test.rpgle` / `.test.sqlrpgle` で終わるものは IFS 方式、それ以外で `src/<LIB>/<SRCFILE>/` に置いたものはメンバー方式**」にした。
  利用者から見て名前だけで決まる（AC14 の「見て分かる規則」）。
- requirements FR2（メンバー方式で検出されるものはこれまでどおり）との関係: `.test` を名前に含むメンバー方式のテストは、
  テキストに `.test` を持つ形（`CALC-add.test.rpgle`）でしかありえず、実例は想定しにくい。そうしたファイルだけが IFS 方式に変わる。文書に書く（AC12）。
