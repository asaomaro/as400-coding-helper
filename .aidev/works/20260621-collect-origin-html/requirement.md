# 要件: CLP コマンド定義拡充に向けた原典 HTML ソースの収集・保存

## 背景 / 課題

- 本 PJ は SEU の F4 プロンプトを再現する **プロンプター定義 JSON** を提供する（CL: `vscode-extension/resources/prompter/cl/<CMD>.json`、RPG: `.../rpg/{ile,rpg3}/<X>-SPEC.json`）。
- 現在 CL 定義は 10 件のみ（CALL, SNDPGMMSG, DCL, CHGVAR, MONMSG, RCVMSG, DLTF, RTVJOBA, SNDRCVF, WRKSPLF）。今後 CLP コマンド定義を**拡充**していく方針。
- 定義 JSON の正誤は **IBM 原典の生テキストを直接照合して確定する**のが PJ 規約（AGENTS.md「開発時の検証規約」）。しかし IBM Documentation は bot に HTTP 403／JS 描画 SPA のため、毎回 Playwright で取得が必要で、原典がリポジトリに残らない。
- 原典をリポジトリに**ソースとして保存**しておけば、後続の定義 JSON 化作業が原典照合をローカルで安定して行え、再取得コスト・幻覚的指摘のリスクを減らせる。

## 目的 / ゴール

- CL コマンド（拡充対象のコア群＋定義済み）と RPG（ilerpg / rpg3）の**原典 HTML を `docs/origin/` 配下に収集・保存**し、後続の定義 JSON 化作業の grounded なソースとする。
- **本ワークのゴールは「原典 HTML の収集・保存」までとし、HTML を元にした JSON 定義の作成は後続 issue で対応する**（スコープ外）。

## スコープ

### 対象

- **収集対象コマンド/仕様書の確定リスト**（下記「収集対象リスト」）。
- IBM Documentation から各対象の**原典 HTML を取得**し、`docs/origin/{cl,ilerpg,rpg3}/` 配下に保存する。
- 取得元 URL・取得日・対象一覧を残す**インデックス／マニフェスト**（後続の追跡・再取得用）。
- 定義済み CL コマンド 10 件の原典 HTML も収集対象に含める（原典をソースとして一元化するため）。

### 対象外

- **HTML を元にした定義 JSON の作成・更新**（後続 issue）。
- 既存定義 JSON の正誤再検証・修正（後続）。
- IBM の全 CL コマンド（2000+）の完全網羅（今回はコア群に限定）。
- 取得 HTML の整形・パース・構造化データ抽出（保存はあくまで原典スナップショットとして）。

## 機能要件

- `docs/origin/cl/<CMD>.html`、`docs/origin/ilerpg/<...>.html`、`docs/origin/rpg3/<...>.html` の形で原典を保存する。
- 各原典に**取得元 URL と取得日**を辿れるようにする（マニフェスト or ファイル先頭コメント等。手段は spec で決定）。
- 取得は PJ 既存運用（Playwright + headless Chromium）に準拠する。bot 403・SPA 描画に対応できること。
- 収集件数・成否を一覧化し、取得できなかったもの（404・URL 不明等）は欠落として明示する（捏造で埋めない）。

### 収集対象リスト（確定）

**CL コアコマンド（約 40 件、★＝定義済み・原典も再収集）**

- ファイル操作: CRTPF / CRTLF / DLTF★ / OVRDBF / CPYF / CLRPFM / RGZPFM / CRTSRCPF
- オブジェクト/ライブラリ: CRTLIB / DLTLIB / DLTOBJ / CRTDUPOBJ / CHGOBJD / RNMOBJ / MOVOBJ / ADDLIBLE / CHKOBJ
- プログラム/ジョブ制御: CALL★ / CALLPRC / SBMJOB / RTVJOBA★ / RTVDTAARA / CHGDTAARA / CRTDTAARA
- CL ロジック/変数: DCL★ / DCLF / CHGVAR★ / IF / ELSE / DOWHILE / DOUNTIL / DOFOR / SELECT / RETURN / CALLSUBR
- メッセージ: SNDPGMMSG★ / RCVMSG★ / MONMSG★ / SNDUSRMSG / SNDMSG
- ファイル I/O（CL内）/ スプール: SNDRCVF★ / RCVF / SNDF / WRKSPLF★ / CPYSPLF / OVRPRTF

**ilerpg（ILE RPG / RPG IV）固定長仕様書 7 種**

- Control(H) / File(F) / Definition(D) / Input(I) / Calculation(C) / Output(O) / Procedure(P) の各仕様ページ
- 既存 `docs/ILE_RPG_Fixed_Format_Reference.md` の HTML 原典に相当

**rpg3（RPG III / RPG/400）仕様書**

- Header(H) / File(F) / Extension(E) / Input(I) / Calculation(C) / Output(O) の各仕様ページ

> 具体的な URL は research/spec で IBM Documentation を直読して特定する（版・ページ構成の確定を含む）。
> RPG 仕様書は 1 ページ内に複数仕様が記載される場合があり、ページ↔仕様の対応は取得時に確定する。

## 非機能要件 / 制約

- 保存先は `docs/origin/{cl,ilerpg,rpg3}/`（リポジトリ追跡・成果物として commit）。
- 取得手段は WebFetch/curl 不可（403・SPA）。Playwright + bundled chromium を用いる（`cl-command-def` skill の既存手順に準拠）。
- 原典照合・取得の確定は**主エージェントが一次ソースを直読**して行う（サブエージェント委譲不可。AGENTS.md / protocol §2.6）。
- 大量取得になるため、リクエスト過多を避ける配慮（逐次・待機）をする。
- 言語登録・contributes には触れない（収集のみのため languageId 波及なし）。

## 完了条件 (受け入れ基準)

- [ ] 確定した CL コアコマンド（約 40 件）の原典 HTML が `docs/origin/cl/` に保存されている。
- [ ] ilerpg 仕様書 7 種の原典 HTML が `docs/origin/ilerpg/` に保存されている。
- [ ] rpg3 仕様書の原典 HTML が `docs/origin/rpg3/` に保存されている。
- [ ] 各原典の取得元 URL・取得日を辿れるマニフェスト（or 同等）が存在する。
- [ ] 取得できなかった対象は欠落として一覧に明示されている（捏造なし）。
- [ ] 本ワークでは定義 JSON を新規作成・変更していない（スコープ厳守）。

## 未確定事項 / 確認したいこと（research/spec で解消）

- IBM Documentation の各対象の**正式 URL と版**（例 `ssw_ibm_i_74` / `75`）。RPG 仕様書ページの構成（1 ページ複数仕様か）。
- 保存形式: **生 HTML（ネットワーク応答）か、描画後 DOM（outerHTML）か**。SPA のため生 HTML には本文が無い可能性が高く、描画後 DOM 保存が妥当か要検証。
- マニフェストの形式（YAML/JSON/Markdown）とファイル命名規約の細部。
- RPG3（RPG/400）原典が IBM Documentation に現存するか、版は何か（旧版のみの可能性）。
