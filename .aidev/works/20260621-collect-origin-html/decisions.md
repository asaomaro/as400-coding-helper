# 決定記録

## D1: 入力リストは `sources.yml` ではなく `sources.mjs`（ESM）にした

- 背景: spec では入力リストを `sources.yml` としたが、取得スクリプト（Node ESM）が YAML を読むには YAML パーサ依存（js-yaml 等）が要る。本 PJ は収集専用にライブラリを増やしたくない。
- 決定: 入力リストを `docs/origin/sources.mjs`（設定オブジェクトを export する ESM）とし、スクリプトは `import('./sources.mjs')` で読む。出力 `manifest.yml` は YAML を維持（items/gaps は JSON フロー記法＝有効な YAML、かつ再実行時に読み戻してマージ可能）。
- 理由 / 代替案: 依存ゼロで人間可読（コメント可）・機械可読を両立。代替の `sources.json` はコメント不可で可読性が落ちる。YAML パーサ追加は収集ツールに不要な重量。
- 影響: spec「インターフェース / データ構造」の `sources.yml` 記述を `sources.mjs` に読み替え。manifest は spec どおり YAML。

## D2: playwright は本体依存に入れず、外部導入先を `PLAYWRIGHT_PKG` で動的 import

- 背景: ESM は `NODE_PATH` でパッケージ解決しない（NODE_PATH は CJS のみ）。さらに playwright は CJS で、ディレクトリ import 不可・named export が `default` 配下に来る interop 差がある。
- 決定: `const _pw = await import(process.env.PLAYWRIGHT_PKG || 'playwright'); const chromium = _pw.chromium || _pw.default?.chromium;` とし、実行は `PLAYWRIGHT_PKG=/tmp/node_modules/playwright/index.js node docs/origin/fetch-origin.mjs`。
- 理由 / 代替案: playwright を本体 devDependency に入れず収集時のみ外部参照（`cl-command-def` skill の運用と一貫）。手順は README に明記。
- 影響: spec の NODE_PATH 前提を `PLAYWRIGHT_PKG`（index.js 絶対パス）へ更新。

## D3: ilerpg は概説 7 ページのみ収集（桁の記入項目要約サブページは収集しない）

- 背景: research F3・spec の決定どおり、ILE RPG 固定長仕様書の概説ページ（演算仕様書 等）には桁位置の「記入項目要約」が無く、配下サブページ（例: 演算仕様書→「従来型の構文」）にある。取得した 7 概説ページは overview＋TOC が主体で、桁の語（けた/位置/ファクター）はほぼ含まれない。
- 決定: 本作業は概説 7 ページのみ保存（spec のスコープどおり）。桁要約サブページの収集は後続 JSON 化 issue に送る。
- 理由 / 代替案: ile の桁位置は既に `docs/ILE_RPG_Fixed_Format_Reference.md`（rpg-spec-def skill の正典）として repo にあり、ile が桁未 grounding になることはない。HTML 概説ページはキーワード・用途の補助原典として価値がある。サブページ併取はスコープ拡大になるため後続に分離。
- 影響: README にこの限界（概説ページである旨・桁はサブpage/既存 md 参照）を明記。後続 issue で C-spec の「従来型の構文」等サブページを追加する想定。

## D4: bot 通知ページ（200 で本文長十分）の検出を追加（test 差し戻し対応）

- 背景: test で `cl/RTVJOBA.html` が「IBM notice: The page you requested cannot be displayed」通知ページだった。IBM の bot ブロックは status 200・本文長 >1000 で通知ページを返すため、初版の gap 判定（`status!==200 || textLen<1000`）をすり抜けて成功扱いになっていた（一時的ブロックの取りこぼし）。
- 決定: `fetch-origin.mjs` に `BOT_NOTICE` 正規表現（"cannot be displayed"/"IBM notice"/"HTTP response code 5xx" 等）を追加し、title/本文に該当すれば失敗扱い→2 秒待ってリトライ→なお該当なら gap。併せて特定 name のみ再取得する `--names=` フィルタを追加。
- 理由 / 代替案: status だけでは bot ブロックを判別できない。内容ベース検出が必要。`--names` で全件再取得せず該当 1 件だけ安全に差し替え可能（manifest はマージ保持）。
- 影響: RTVJOBA を再取得し正データ（「ジョブ属性検索 (RTVJOBA)」156KB）に修正。全 59 件で notice 混入 0・全 CL title がコマンド名一致を確認。test 12/12 合格。

## D5: CL 収集範囲をユーザー要望で 46→95 件に拡張（第2弾）

- 背景: test 通過後、ユーザーが「他に取得すべき頻出 CL コマンドの候補」を要望。現行 46 件は制御構造（IF/DO系/SELECT/CALLSUBR）の区切り命令などが欠落していた。
- 決定: 4 群（A 制御構造補完 / B+C メッセージ・取得系 / D+E ファイルDB・ジョブ / F+G+H スプール・作成・保存権限）計 49 件を追加し CL を **95 件**に拡張。`sources.mjs` に追記し `--names` で差分のみ取得（既存 46 は merge 保持）。
- 理由 / 代替案: requirement「コア群」の自然な拡張。全件再取得せず差分取得で transient ブロック面積を最小化。存在不確実だった命令（WHEN/OTHERWISE/ENDSELECT/SUBR/ENDSUBR 等）は全て実在を取得で確認（CL の構造化命令として 200・title 一致）。
- 影響: requirement「CL コア約 46 件」を **95 件**へ読み替え。合計 108 件（CL95＋ilerpg7＋rpg3 6）。WRKJOB は一時 bot ブロックで 1 度 gap 化したが再取得で解消（gaps 0）。bot 検出（D4）が第2弾でも機能。

## D6: ile の桁・主要キーワード詳細サブページ 14 件を追加（第3弾・ユーザー要望）

- 背景: ユーザーが「ile/rpg3 の原典は取得できているか」を確認。検証の結果、cl・rpg3 は桁表まで含むが、ile は概説 7 ページのみで桁の記入項目表が無い（D3）非対称があった。後続 JSON 化に桁が要る。
- 決定: D3 の方針を更新し、ile の桁・主要キーワード詳細サブページ 14 件（H:2 / F:3 / D:2 / I:2桁 / C:2桁 / O:2桁 / P:1）を追加収集。ile を **21 件**（概説7＋詳細14）に拡張。命名は `<X>-SPEC-<slug>` でファイル化。
- 理由 / 代替案: 桁レイアウトの原典を ile でも HTML 化して cl/rpg3 と同水準に。レンダリングで桁表の実在を確認済み（例: C-SPEC-traditional-syntax に「6桁目に C」「7〜11桁目に制御レベル標識」＋ルーラー図 `*.. 1 ...+...`）。「全キーワードページ網羅（約25）」は冗長として見送り、桁＋代表キーワードに限定。
- 影響: 合計 122 件（CL95＋ile21＋rpg3 6）。README の ilerpg 件数を 7→21 に更新。F-SPEC-keywords-program-described・O-SPEC-record-id-control-entries は一時 503（IP レート制限）で複数回 gap 化したが、間隔を空けた再取得で解消（gaps 0）。後続 JSON 化 issue へ D3 の「サブページは後続」は本決定で部分前倒し。
