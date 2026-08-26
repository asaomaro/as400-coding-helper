# 原典 HTML ソース (`docs/origin/`)

AS/400 コーディング支援のプロンプター定義（CL コマンド・RPG 固定長仕様書）を作成・検証するための
**原典スナップショット**を集めたもの。後続の「定義 JSON 化」作業が、原典をローカルで安定して
照合できるようにする（再取得コスト削減・bot ブロック回避）。

> **このディレクトリは原典の収集物であり、定義 JSON ではない。** HTML を元にした定義 JSON の作成は
> 別作業（後続 issue）で行う。

## 構成

| パス | 内容 | 件数 | 版/出所 |
|---|---|---|---|
| `cl/<CMD>.html` | CL コマンドの IBM Documentation ページ | 95 | IBM i 7.4 (`ssw_ibm_i_74`) |
| `ilerpg/<X>-SPEC.html` | ILE RPG 固定長仕様書（H/F/D/I/C/O/P）の概説ページ | 7 | IBM i 7.4 |
| `ilerpg/<X>-SPEC-<slug>.html` | 上記の桁・主要キーワード詳細サブページ（桁表を含む） | 14 | IBM i 7.4 |
| `rpg3/<id>.html` | RPG III(RPG/400) 用 固定長リファレンス（第三者・jaymoseley） | 6 | 下記「rpg3 の出所」参照 |
| `dds/DDS-*.pdf` | **DDS リファレンス（IBM 公式 PDF）** | 2 | **IBM i V6R1**（下記「dds の出所」参照） |
| `sources.mjs` | 取得対象リスト（入力） | — | — |
| `fetch-origin.mjs` | 取得スクリプト（Playwright・HTML 用） | — | — |
| `fetch-dds-origin.sh` | 取得スクリプト（素の HTTP・PDF 用） | — | — |
| `manifest.yml` | 取得結果（URL・取得日・status・title・bytes・gaps） | — | 生成物 |

各ファイルの取得元 URL・取得日時・HTTP status・タイトル・サイズは **`manifest.yml`** に全件記録。
取得できなかったものは `manifest.yml` の `gaps` に理由付きで残す（捏造しない）。今回の取得は gaps 0。

## 保存形式（重要）

IBM Documentation は bot に対し HTTP 403/503 を返し、本文を JavaScript で描画する SPA のため、
`curl` / `WebFetch` では本文が取得できない。したがって本ディレクトリの HTML は:

- **Playwright(chromium) で描画した後の `document.documentElement.outerHTML`** を保存している
  （DOMContentLoaded 前の生 HTTP 応答ではない）。
- サイズ・ノイズ削減のため **`<script>` / `<noscript>` のみ DOM から除去**。
  **本文・表・桁構造・`<style>` は保持**（後続の桁・パラメータ照合の正を損なわないため）。

ブラウザでローカルに開けば描画済みの内容を確認できる。

## 再取得・追加の手順

playwright は本体の依存に入れていない（収集専用）。外部に導入して `PLAYWRIGHT_PKG` で渡す。
ESM は `NODE_PATH` で解決しないため、`index.js` の**絶対パス**を指定すること。

```sh
# 初回のみ playwright + chromium を導入（例: /tmp）
cd /tmp && npm i playwright && npx playwright install chromium

# リポジトリルートで実行
cd /path/to/repo
PLAYWRIGHT_PKG=/tmp/node_modules/playwright/index.js node docs/origin/fetch-origin.mjs            # 全カテゴリ
PLAYWRIGHT_PKG=/tmp/node_modules/playwright/index.js node docs/origin/fetch-origin.mjs --only=cl  # 一部のみ
```

対象を増やす場合は `sources.mjs` の `items` に追記して再実行する（`--only` で対象カテゴリのみ
再取得しても、他カテゴリの `manifest.yml` 記録は維持される）。

## カテゴリ別の注意

### cl（CL コマンド）

- URL: `https://www.ibm.com/docs/ja/ssw_ibm_i_74/cl/<cmd 小文字>.htm`。
- ファイル名は既存の定義 JSON（`vscode-extension/resources/prompter/cl/<CMD>.json`）と揃え**大文字 CMD**。
- 既存定義済み 10 件（CALL/SNDPGMMSG/DCL/CHGVAR/MONMSG/RCVMSG/DLTF/RTVJOBA/SNDRCVF/WRKSPLF）も
  原典を一元化するため再収集している。

### ilerpg（ILE RPG / RPG IV 固定長仕様書）

- **概説ページ 7 件**（`<X>-SPEC.html`）: 各仕様書の用途・構成（`?topic=specifications-control` 等）。
- **詳細サブページ 14 件**（`<X>-SPEC-<slug>.html`）: 桁・主要キーワードの詳細。**桁位置の記入項目表はこちらに含まれる**
  （例: `C-SPEC-traditional-syntax.html` に「6桁目に C / 7〜11桁目に制御レベル標識」とルーラー図、
  `I-SPEC-*-entries` / `O-SPEC-*-entries` に入出力の桁、`H/F/D/P-SPEC-keywords` にキーワード定義）。
- 桁レイアウトの相互確認用に既存 `docs/ILE_RPG_Fixed_Format_Reference.md`（`rpg-spec-def` skill の正典）も併用できる。
- D-SPEC の全キーワード個別ページ等の長い裾は未収集（桁＋代表キーワードに限定）。必要なら `sources.mjs` に追加して再取得する。

### rpg3 の出所（RPG III / RPG/400）

- **IBM の RPG/400 Reference は IBM Documentation に生 HTML が存在しない**。RDi help の該当ページ
  （`ibm.com/docs/.../rdfi/9.6.0?topic=rpg400-language-reference`）は「End of support / Product version
  no longer published」にリダイレクトされる。IBM 一次資料は **PDF のみ**（RPG/400 Reference, 資料番号
  **SC09-1817** 系。IBM Publications Center / 各種ミラー）。
- そのため本ディレクトリの rpg3 原典は、本 PJ が #18（`20260620-rpg-dialect-split`）で固定長の桁照合に
  実際に用いた **第三者の jaymoseley RPG チュートリアル**（`jaymoseley.com/hercules/rpgtutor/`）を保存している。
  これは System/3 系 RPG II/III のチュートリアルで、桁レイアウトは RPG/400 と概ね共通だが、
  **IBM の厳密な原典ではない**点に注意（正典は上記 SC09-1817 の PDF）。
- 収集ページ: `rpg002`(H/F/I/O 基本) / `rpg006`(演算) / `rpg007`(選択演算) / `rpg008`(指示器) /
  `rpg010`(拡張/行カウンタ) / `rpg011`(出力編集語)。

## ライセンス / 取り扱い

- 保存している HTML は IBM および jaymoseley.com の著作物のスナップショットで、**社内の開発照合用途**に
  限定する。再配布や公開を意図しない。出所は各ファイルおよび `manifest.yml` で辿れる。


## dds の出所（2026-08-26 追加）

DDS（DSPF / PRTF）のリファレンス。**HTML ではなく IBM 公式 PDF**。

| ファイル | 内容 | 出所 |
|---|---|---|
| `dds/DDS-DSPF.pdf` | System i Programming: DDS for display files | `public.dhe.ibm.com/.../v6r1/en_US/rzakc.pdf` |
| `dds/DDS-PRTF.pdf` | System i Programming: DDS for printer files | `public.dhe.ibm.com/.../v6r1/en_US/rzakd.pdf` |

取得は `./fetch-dds-origin.sh`（Playwright 不要）。

### なぜ ibm.com/docs から採っていないか

**取れないから。** 実測（2026-08-26）:

- `curl` → **403**
- **Playwright の実ブラウザでも 403**。返るのは `IBM notice: The page you requested cannot be displayed`
  （`fetch-origin.mjs` が `BOT_NOTICE` として検出対象にしている、まさにその通知ページ）
- `https://www.ibm.com/docs/` の**ルートすら 403**。URL の問題ではなくネットワーク単位で弾かれている

ボット検知の回避は行っていない。IBM が自動アクセスを明示的に拒否している以上、迂回すべきではない。
代わりに、IBM が**公開ファイルサーバで配布している公式 PDF** を使う。

### 制約（参照するとき必ず意識すること）

- **版が違う。** これらは **V6R1**。`cl` / `ilerpg` カテゴリは **7.4**。
  `public.dhe.ibm.com/systems/power/docs/systemi/` には **v5r2〜v6r1 しか無く、7.x は置かれていない**。
  DDS の固定長桁割りや主要キーワードは実質変わらないと思われるが、
  **「思われる」で済ませない**。版差に依存しうる記述を引くときは、その旨を成果物に明記する。
- **英語版を正とする。** 日本語版（`ja_JP/`）も存在するが、**CID フォントのためテキスト抽出ができず**、
  機械的な照合に使えない（`poppler-utils` があれば解決するが、前提にしない）。
  原典照合が目的なので、抽出できる英語版を採る。
- **PDF なので `<style>` や表構造は保持されない。** 桁位置の表は本文テキストとして読む。
  抽出テキストは約 700KB（DSPF 版）で、`positions 7 through 16` のような桁の記述を検索できる。

### 実際に裏付けられたこと

取り込み時の確認として、実機から導いた桁割りが原典と一致することを見ている:

```
positions 7 through 16 are a multiple-field area in which you can specify option indicators
Positions 17 through 38 must be blank. The location of the field is required (positions 39 through 44)
```

条件欄 7-16、定数は 17-38 が空白で行桁 39-44 が必須 — `packages/dds-core` が実ソースから
導いた桁割り（research F8）と一致する。
