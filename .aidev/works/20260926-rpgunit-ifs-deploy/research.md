# 調査: RPGUnit のテストを IFS に展開してコンパイル・実行する

実機はすべて SR-OSAKA（IBM i 7.3・RPGUnit v6.0.2.r・hostserver の SQL ジョブ。ジョブ CCSID 5035）、2026-09-26。
一次資料は次の 2 つを直読した（取得版を明記）。
- IBM i Testing: `IBM/vscode-ibmi-testing` main `259485a888`（`api/runner.ts` `api/apiUtils.ts` `src/runner.ts` `src/manager.ts`）
- Code for IBM i: `codefori/vscode-ibmi` タグ `3.0.13`（`src/filesystems/local/deployTools.ts` `deployment.ts` `src/api/IBMiContent.ts` `src/typings.ts`）
  ——E2E で使っている版（`vscode-extension/.vscode-test/rpgunit-e2e/ext/halcyontechltd.code-for-ibmi-3.0.13`）と同じ。

## 調査の問い

- Q1: 7.3 で `RUCRTRPG SRCSTMF` は使えるか。UTF-8（日本語入り）のソースを通すには何が要るか。
- Q2: IFS の相対パスの `/COPY` はどう解決されるか。コピー句の文字コードは問題になるか。
- Q3: IBM i Testing は IFS 方式をどう組み立てているか（検出・名前・ライブラリー・展開・コンパイル）。
- Q4: Code for IBM i の公開 API で、IFS への展開に使えるものは何か。展開したファイルに付くタグは。
- Q5: いまの実装で、IFS 方式を足すときに触る箇所はどこか。

## 判明した事実

### Q1: `SRCSTMF` と文字コード

- F1: **`RUCRTRPG` は `SRCSTMF` と `INCDIR` を受け付ける**（パラメーターの誤りにならない。`verify/probe-srcstmf.mjs`）。
  **メンバー形式の `/COPY RPGUNIT/QINCLUDE,TESTCASE` はストリームのソースからも解決される**（`probe-stmf-ccsid.mjs` の 819 / 1252 で合格）。
- F2: **主ソース（`SRCSTMF` に渡すファイル）のタグで結果が決まる**。同じ中身で（`probe-stmf-ccsid.mjs`・`probe-stmf-convert.mjs`）:

  | 主ソースのタグ | 中身 | 結果 |
  |---|---|---|
  | 1208（UTF-8） | ASCII だけ | **`CPE3490` 変換エラー → `RNS9339` 開けない** |
  | 1208 | 日本語の注記・文字リテラル入り | 同上 |
  | 819 / 1252 | ASCII だけ | 作成でき、2 件中 1 件失敗（正） |
  | 943（Shift-JIS） | ASCII だけ / 日本語入り（`CPY TOCCSID(943)`） | `CPF427D` ・重大度 40 で作成できない |
  | **5035**（`CPY … TOCCSID(5035) DTAFMT(*TEXT)` で変換） | 日本語入り | **作成でき、2 件中 1 件失敗（正）。日本語リテラルの比較も合格** |
  | **1399**（同 `TOCCSID(1399)`） | 日本語入り | **同上** |

- F3: ジョブの CCSID は原因ではない。`CHGJOB CCSID(5035)` を明示しても 1208 の結果は変わらない（`probe-srcstmf.mjs` の 2 回目）。
  `CHGJOB CCSID(1399)` にする手は、直後の SQL の結果を ts5250 の hostserver が復号できず（`unsupported CCSID 5123`）判定まで届かなかった。
  **接続のジョブの CCSID を変えると、結果の読み取りなど他の処理を巻き込む**（`probe-stmf-convert.mjs` 冒頭の注記）。
- F4: 1208 がなぜ開けないか（7.3 の `CRTRPGMOD` の制約か PTF か）は**確かめていない**。原典（IBM Documentation）は未照合。
  実機の事実として「このマシンでは主ソースを EBCDIC に変換すれば通る」だけを採る。

### Q2: コピー句の解決

`verify/probe-stmf-include.mjs`。元のファイルは Code for IBM i のデプロイと同じく **UTF-8・タグ 1208** で `src/qcopy/`・`src/test/` に置いた。
コピー句にも日本語の注記を入れた。

- F5: **コピー句はタグ 1208 のままで読める**。主ソースだけを別の場所へ 5035 に変換し、`INCDIR` に元のディレクトリを渡すと
  `/COPY qcopy/probe_h.rpgleinc` が解決され合格（I1）。同じディレクトリのコピー句も `INCDIR` に元のテストのディレクトリを渡せば合格（I5）。
  ——**変換が要るのは主ソースだけ**。コピー句の**日本語の文字リテラル**も正しく比較される（F22）。
- F6: **相対パスは「主ソースのディレクトリ」と `INCDIR` から探される**。ツリーごと変換した場合、同じディレクトリのコピー句は
  `INCDIR` 無しで解決（I4）、別ディレクトリ（`qcopy/…`）は `INCDIR`（最上位）を渡せば解決（I2）、渡さなければ見つからず
  重大度 40（I3・対照）。主ソースだけ別の場所へ変換すると、同じディレクトリのコピー句も `INCDIR` 無しでは見つからない（I6・対照）。
- F7: **ツリーごとの変換もできる**: `CPY OBJ('<元>') TODIR('<先>') SUBTREE(*ALL) TOCCSID(5035) DTAFMT(*TEXT)`。
  **`TODIR` は先に作っておく**（無いと `CPFA0A9`・0 件コピー）。変換後のタグはすべて 5035。

### Q3: IBM i Testing の IFS 方式

- F8: **検出**: 接尾辞 `.TEST.RPGLE` / `.TEST.SQLRPGLE`（COBOL も）を大文字小文字両方でワークスペース全体から探す
  （`api/apiUtils.ts` `getTestSuffixes` 13-38 行、`src/manager.ts` 152-166 行 `**/*{…}`）。メンバー方式のテスト（Code for IBM i の
  メンバーを開いたもの）は URI スキーム `member` で別扱い（`src/manager.ts` 320 行・`api/runner.ts` 280-297 行）。
- F9: **名前**: `getSystemNameFromPath(path.parse(fsPath).name)`（`api/apiUtils.ts` 46-97 行、`src/runner.ts` 162 行）。
  `.test` を外し、`-` より前を取り、`T` を前置して 10 文字以内ならそれ。超えれば `_` の前を接頭辞にし、名前の大文字だけを拾って
  詰め、`T` を前置して 10 文字に切る。Source Orbit と同じ規則（コメントに出典 URL）。
- F10: **置き場（ライブラリー）**: 現行ライブラリー（`libraryList.currentLibrary || config.currentLibrary`）。`TSTPGM(&CURLIB/&SHORTNAME)`
  （`api/runner.ts` 235-256 行・470-480 行）。
- F11: **展開とコンパイル**: 実行の前にワークスペースを Code for IBM i のデプロイで IFS へ送り（`src/runner.ts` 278-284 行 `launchDeploy`、
  `api/runner.ts` 100-102 行）、`SRCSTMF(<デプロイ先>/<ワークスペースからの相対パス>)`（`api/runner.ts` 239-244 行）。
  `INCDIR` は `testing.json` の `incDir`（相対ならデプロイ先から解決）に**デプロイ先を必ず足す**（`api/runner.ts` 368-392 行）。
  `TGTCCSID` の既定は `*JOB`（同 355-357 行）。**文字コードの変換はしていない**。
- F12: したがって **IBM i Testing をそのまま 7.3・日本語環境で使うと、F2 の 1208 の行に当たると考えられる**（F13 でデプロイ後のタグは 1208）。
  ——これは推論で、IBM i Testing を実機で動かしてはいない。

### Q4: Code for IBM i の API

- F13: **デプロイは展開したファイルのタグを 1208 にする**: 既定のタグが 1208 でない機械では `setccsid -R 1208 <展開先>` を実行する
  （`src/filesystems/local/deployment.ts` 296-303 行・318-330 行 `mustFixCCSID`）。
- F14: 公開 API（`exports.deployTools`。`src/typings.ts` 24 行・`src/extension.ts` 171 行）:
  - `getRemoteDeployDirectory(workspaceFolder)`: 利用者が設定したデプロイ先。**未設定なら `undefined`**（`deployTools.ts` 77-81 行）。
  - `launchDeploy(workspaceIndex?, method?, selectedFiles?)`: デプロイ。方法を渡さないと**選択の UI が出る**（既定の方法が設定されていれば
    それを使う。同 91-140 行）。戻り値はデプロイ先と workspace の番号、失敗なら `undefined`。
  - `buildPossibleDeploymentDirectory(workspace)`: 既定の候補 `/home/<user>/builds/<workspace 名>`（同 372-376 行）。
- F15: `content.writeStreamfileRaw(path, content)` は SFTP でファイルを置く。**新規ファイルのタグは機械の既定**に従う
  （既存ファイルなら元のタグへ iconv で戻す。`IBMiContent.ts` 153-181 行）。**タグを 1208 にする保証は無い**。

### Q5: いまの実装

- F16: 検出は `src/**/*.{rpgle,sqlrpgle}` だけを見て、`resolveMemberTarget`（`src/<LIB>/<SRCFILE>/<MEMBER>.<ext>`）に合わないものは捨てる
  （`discovery.ts` 71-86 行 `buildDiscoveredTestFile`・93-110 行 `discoverTestFiles`）。**IFS 方式の `*.test.rpgle` は `src/` の外なら見つからず、
  `src/` の中でも 4 階層でなければ捨てられる**。
- F17: 共通部品はメンバー方式しか持たない: `compileSuite`/`runSuite` の入力は `MemberTarget`（`suiteRunner.ts` 43-46 行・75-78 行）、
  `SuiteConnection.uploadMemberContent`（同 18 行）、`buildCreateTestCommand` は `SRCFILE`/`SRCMBR` 固定（`rpgunitCommands.ts` 38-45 行）。
- F18: 道具は `--pgm` 省略時にファイル名の拡張子前を大文字にしてプログラム名にする（`tools/run-rpgunit.mjs` 160 行）。`calc.test.rpgle` なら
  `CALC.TEST`——**IBM i の名前として不正**。IFS 方式の名前の決め方を共通部品に置けば、道具もそれに従う。
- F19: 道具の IFS への書き込みは hostserver の `IfsConnection.writeFile(path, data, { create, dataCcsid })`。`dataCcsid` を渡せば新規ファイルの
  タグを決められる（`/workspaces/ts5250/packages/hostserver/dist/ifs/ifs-connection.d.ts` 85-99 行）。
- F20: Code for IBM i の接続設定から現行ライブラリーを取れる（IBM i Testing は `config.currentLibrary` を使う。F10）。
  いまの `RawIbmiConnection.getConfig()` の型は `libraryList` しか宣言していない（`codeForIbmi.ts` 36 行）。

### 追加の確認（design 前。`verify/probe-stmf-details.mjs`）

- F21: **`CPY … TOCCSID(*JOBCCSID) DTAFMT(*TEXT)` が使え、ジョブの CCSID（5035）のタグが付く**（D1）。
- F22: **`INCDIR` に 2 つのディレクトリを渡せる**（`INCDIR('<元のテストのディレクトリ>' '<最上位>')`）。2 つ目にだけあるコピー句（タグ 1208・
  日本語の注記と日本語リテラルの定数）が解決され、テストが `assert(JP_WORD = '日本語': …)` で合格（D2）。
- F23: **SQLRPGLE も `SRCSTMF` で作れる**。拡張子 `.sqlrpgle` の写し（`*JOBCCSID` へ変換）を渡し、`EXEC SQL SET :n = 7` のテストが合格（D3）。

## 影響範囲

- 検出（`discovery.ts`）・Test Explorer の項目（`testController.ts` 187-200 行）・共通部品（`suiteRunner.ts`・`rpgunitCommands.ts`）・
  Code for IBM i の接続の型（`codeForIbmi.ts`）・道具（`tools/run-rpgunit.mjs` の引数・接続・`--pgm` の既定）。
- メンバー方式の経路は変えない（AC9）。共通部品の入力に「どちらの方式か」を持たせることになる。

## 実現性 / リスク

- 方式は成り立つ（F1・F2・F5）。**必須の追加手順は「主ソースを EBCDIC に変換した写しを作る」こと**（F2）。
- **変換先の CCSID の決め方**: このマシンでは 5035 と 1399 が通った。ジョブの CCSID（SQL の `DEFAULT_CCSID`）に合わせるのが自然だが、
  英語環境（37 等）では確かめていない。ジョブの CCSID が 65535 のとき `TOCCSID(65535)` は意味を持たない——既定 CCSID を使う。
- コピー句の日本語リテラルは F22 で確認済み。E2E でも AC4 で見る。
- **デプロイの UI**: `launchDeploy` は方法が決まっていないと選択の UI を出す（F14）。テストのたびに出ると邪魔。
- **エラー表示の位置**: 変換した写しをコンパイルするので、コンパイル・リストやイベントの行番号は写しの行。写しは元と行が一致する
  （`DTAFMT(*TEXT)` は行を保つ）が、パスは写しを指す。

## 実装アンカー

- A1: 検出（`vscode-extension/src/testing/discovery.ts:93` `discoverTestFiles` / `:71` `buildDiscoveredTestFile`）— `src/**/*.{rpgle,sqlrpgle}` と `resolveMemberTarget`。
- A2: Test Explorer の項目（`vscode-extension/src/testing/testController.ts:187-200`）— ラベルに `file.target.member`。
- A3: 実行（`vscode-extension/src/testing/testController.ts:73` `runFile`）— `compileSuite`/`runSuite` に `discovered.target`。
- A4: 共通手順（`vscode-extension/src/testing/suiteRunner.ts:43` `compileSuite` / `:75` `runSuite` / `:17` `SuiteConnection`）。
- A5: コマンド（`vscode-extension/src/testing/rpgunitCommands.ts:38` `buildCreateTestCommand`）— `SRCFILE`/`SRCMBR` 固定。
- A6: Code for IBM i の型と接続（`vscode-extension/src/testing/codeForIbmi.ts:36` `getConfig` / `:101` `writeStreamfile` / `:142` 拡張の `exports`）。
- A7: 道具（`tools/run-rpgunit.mjs:160` `o.pgm ??=` / `:382` `openSuiteConnection` / `:474` `target`）。
- A8: E2E 部品（`vscode-extension/dev/rpgunit-e2e-fixtures.mjs`）・VS Code の E2E（`vscode-extension/dev/rpgunit-e2e.mjs`）・道具の E2E（`tools/run-rpgunit-e2e.mjs`）。
- A9: 独自実装の見張り（`tools/run-rpgunit.mjs` の self-test「共通部品を使っている」）— `RUCRTRPG\s+TSTPGM` を道具の本体に書くと落ちる。
- A10: E2E ヘルパー拡張（`vscode-extension/dev/rpgunit-e2e-helper/`）— Code for IBM i の接続を張る。デプロイ先の設定もここで行うことになる（未特定 — coding で確認）。

## 実装時の注意

- **`CPY … TODIR` の先は作っておく**（F7）。
- **`DTAFMT(*TEXT)` を必ず付ける**（付けないとバイナリのまま写ってタグだけ変わる）。
- 実機の probe で `CHGJOB CCSID` を変えると ts5250 の SQL 結果の復号が落ちる（F3）。道具の SQL ジョブでは変えない。
- probe はスプールを消していない（RUCRTRPG の失敗分のコンパイル・リストが残る。名前はプログラム名 `TIFSP*`・`TIFS*`・`TJP*`・`TINC*`）。
- 失敗時の片付けは例外経路でも走らせる（`probe-stmf-convert.mjs` の初回は例外で片付けが止まり、別途消した）。

## design への申し送り

- 変換の置き場: 主ソースだけを一時ディレクトリへ変換するなら、`INCDIR` に **元のテストのディレクトリとデプロイ先の最上位**を渡す（F5・F6）。
  ツリーごと変換するなら重いが元と同じ相対関係が保てる（F7）。
- 変換先の CCSID の決め方（ジョブの既定 CCSID か固定か）。
- 展開: Code for IBM i のデプロイ（`launchDeploy`。未設定時・UI の扱い）に乗るか、テストファイルと参照されるファイルだけを
  `writeStreamfileRaw` で送るか（その場合はタグを 1208 にする手順が要る。F15）。道具は hostserver で `dataCcsid: 1208` を付けて送れる（F19）。
- 名前とライブラリー: IBM i Testing の `getSystemNameFromPath`・現行ライブラリーに揃えるか（F9・F10）。揃えると IBM i Testing と
  同じテストが同じ名前になる。
- 方式の判定: `src/<LIB>/<SRCFILE>/<MEMBER>` に合うものはメンバー方式、それ以外の `*.test.rpgle` は IFS 方式、と分けられる（F16）。
  重なり（`src/L/F/x.test.rpgle`）は `resolveMemberTarget` が `X.TEST` をメンバー名として弾く
  （`memberTarget.ts:21` `IBM_I_OBJECT_NAME = /^[A-Z$#@][A-Z0-9_$#@]{0,9}$/u` に `.` が無い）ので、**既存の規則のままで重ならない**。
  逆に `src/L/F/X.rpgle`（`.test` 無し）は IFS 方式の接尾辞に当たらない。単体テストで固定する（AC14）。
- 変換しないコピー句の日本語リテラルは E2E で確かめる（F5 の未確認）。
