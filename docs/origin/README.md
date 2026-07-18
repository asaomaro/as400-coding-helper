# 原典 HTML ソース (`docs/origin/`)

AS/400 コーディング支援のプロンプター定義（CL コマンド・RPG 固定長仕様書）を作成・検証するための
**原典スナップショット**を集めたもの。後続の「定義 JSON 化」作業が、原典をローカルで安定して
照合できるようにする（再取得コスト削減・bot ブロック回避）。

> **このディレクトリは原典の収集物であり、定義 JSON ではない。** ただし原典から定義 JSON を
> 生成・検証するスクリプトはここに置く（下記「定義 JSON の生成」）。

## 構成

| パス | 内容 | 件数 | 版/出所 |
|---|---|---|---|
| `cl/<CMD>.html` | CL コマンドの IBM Documentation ページ（日本語） | 134 | IBM i 7.4 (`ssw_ibm_i_74`) |
| `cl-en/<CMD>.html` | 同上（英語） | 133 | IBM i 7.4 |
| `ilerpg/<X>-SPEC.html` | ILE RPG 固定長仕様書（H/F/D/I/C/O/P）の概説ページ | 7 | IBM i 7.4 |
| `ilerpg/<X>-SPEC-<slug>.html` | 上記の桁・主要キーワード詳細サブページ（桁表を含む） | 14 | IBM i 7.4 |
| `rpg3/<id>.html` | RPG III(RPG/400) 用 固定長リファレンス（第三者・jaymoseley） | 6 | 下記「rpg3 の出所」参照 |
| `sources.mjs` | 取得対象リスト（入力） | — | — |
| `dds/<種別>-{POSITIONAL,KEYWORDS}.html` | DDS の桁とキーワード索引（日本語） | 6 | IBM i 7.4 |
| `dds/detail/<page>.htm` | DDS 各キーワードの詳細（構文の出所） | 285 | IBM i 7.4 |
| `dds-en/…` | 同上（英語） | 291 | IBM i 7.4 |
| `fetch-origin.mjs` | 取得スクリプト（Playwright） | — | — |
| `generate-cl-definitions.mjs` | CL 定義 JSON の生成スクリプト | — | — |
| `verify-cl-definitions.mjs` | 生成結果と原典の突き合わせ検査 | — | — |
| `manifest.yml` | 取得結果（URL・取得日・status・title・bytes・gaps） | — | 生成物 |

各ファイルの取得元 URL・取得日時・HTTP status・タイトル・サイズは **`manifest.yml`** に全件記録。
取得できなかったものは `manifest.yml` の `gaps` に理由付きで残す（捏造しない）。今回の取得は gaps 0。

## ilerpg の取得方法（コンテンツ API 経由）

IBM Documentation の `?topic=` 形式のページは、本文を **コンテンツ API から取得して
JavaScript で描画する**。描画完了の判定が難しく、目次だけが入った状態で保存されて
しまうことがある（実際に ilerpg は全21ファイルで桁表・桁記述が 0 件だった。
`innerText.length > 2000` という待機条件を目次だけで満たしていたため）。

そのため ilerpg は **API を直接叩いて本文だけを取得する**。`sources.mjs` の item に
`topic: 'ssw_ibm_i_74/rzasd/<name>.htm'` を指定すると、この経路が使われる。

```
https://www.ibm.com/docs/api/v1/content/<topic をURLエンコード>?parsebody=true&lang=ja
```

ブラウザ描画に依存しないため速く確実。取得時に **「N 桁目」「N から M 桁目」の
出現数と `<table>` の数を manifest に記録する**（`columns` / `tables`）。
桁表を目的に取得したページでこれが 0 なら取りこぼしを疑うこと。今回の見落としは
「HTTP 200 かつ本文が長い」だけを成功条件にしていたために起きた。

### 固定形式の桁レイアウト

各仕様書の全桁を列挙しているのは `*-SPEC-layout.html`（従来型の〜ステートメント）。
仕様書の入口ページ（`F-SPEC.html` 等）には桁の一覧が無いため、こちらが桁照合の正本。

| 仕様書 | レイアウトのトピック |
|---|---|
| H | `rzasd/conspss.htm` |
| F | `rzasd/fdsent.htm` |
| D | `rzasd/dsent.htm` |
| I | `rzasd/inpsstm.htm`（詳細は `I-SPEC-record-id-entries` / `I-SPEC-field-entries`） |
| C | `rzasd/calss.htm` |
| O | `rzasd/outspc.htm`（詳細は `O-SPEC-record-id-control-entries` / `O-SPEC-field-control-entries`） |
| P | `rzasd/psent.htm` |

> **未解決**: `P-SPEC-keywords`（`rzasd/pskwd.htm`）は本文が 149 文字しか返らず gap のまま。
> 正しいトピックパスの特定が必要。

## 実機のコマンド定義（cmddoc/）

`cmddoc/QSYS_<CMD>.HTML` は **実機のコマンドオブジェクトから `GENCMDDOC` で生成**した
定義。IBM Documentation のページ（版に固定された文書）と違い、そのシステムで実際に
受け付けられる定義そのものなので、裏取りに使う。

```sh
node docs/origin/verify-cl-against-cmddoc.mjs   # 定義と実機の突き合わせ（差分は報告のみ）
```

取得方法（pub400 は SSH が使える。画面操作より確実で速い）:

```sh
ssh -p 2222 <user>@pub400.com          # パスワード入力の文言が独自のため
                                        # sshpass 利用時は -P "password" が要る
system "GENCMDDOC CMD(QSYS/<CMD>) TODIR('/home/<user>/cmddoc')"
scp -P 2222 '<user>@pub400.com:/home/<user>/cmddoc/*.HTML' docs/origin/cmddoc/
```

**定義の正は原典（`cl/`、IBM i 7.4 文書）のまま**で、cmddoc は裏取り用。実機は 7.5 の
ため版差が出る。現時点の差分は次のとおりで、いずれも 7.5 で追加された項目と確認済み。

| 差分 | 内容 |
|---|---|
| 実機にあり定義に無い 6件 | `ALCOBJ.MIRROR` `CRTBNDCL.TGTCCSID` `DLCOBJ.MIRROR` `DLYJOB.RSMDATE` `DLYJOB.CTLEND` `RTVOBJD.BLDID` |
| 省略時値の差 1件 | `CALL.PARM = *DFT`（7.4 原典には既定値の記載が無い） |
| required の差 | **0件** |
| 定義にあり実機に無い | **0件** |

`required` と パラメータ集合が実機と完全一致していることは、原典からの生成が
正しいことの裏付けになっている。

## 言語（日本語 / 英語）

CL の原典は日本語版と英語版の両方を取得し、定義もそれぞれ生成する。

```sh
node docs/origin/fetch-origin.mjs --only=cl              # 日本語 → docs/origin/cl/
node docs/origin/fetch-origin.mjs --only=cl --lang=en    # 英語   → docs/origin/cl-en/
node docs/origin/generate-cl-definitions.mjs             # → resources/prompter/cl/ja/
node docs/origin/generate-cl-definitions.mjs --lang=en   # → resources/prompter/cl/en/
```

拡張機能側は設定 `rpgClSupport.language`（`auto`/`ja`/`en`、既定 `auto`）で切り替える。
`auto` は VS Code の表示言語に従う。

**入力欄の名前は言語によらず共通**にしている。名前は表示語ではなく内部の識別子で、
`dependsOn` / `constraints` / `basic` もこれを参照するため。英語版の生成時は日本語版を
引き継ぎ元にして名前を揃えている（揃えないと `LOG_E1` のような合成名になり、
同じコマンドなのに欄の名前が言語で食い違う）。

## 定義 JSON の生成

CL プロンプター定義 `vscode-extension/resources/prompter/cl/<CMD>.json` は、**原典HTMLから
決定的に生成する**。LLM や手作業で書き起こさない（下線でしか表現されない省略時値など、
マークアップにしか無い情報がテキスト化で落ちるため）。

```sh
node docs/origin/generate-cl-definitions.mjs [CMD ...]   # 省略時は全件。--dry-run で標準出力
node docs/origin/verify-cl-definitions.mjs   [CMD ...]   # 原典と突き合わせ。差分があれば exit 1
```

`verify` が差分ゼロ（exit 0）であることが受け入れ条件。差分が出たら **JSON を手で直さず
生成スクリプトを直す**（手で直しても次の再生成で消える）。

原典に書かれておらず生成できない項目（`dependsOn` の相関規則、`constraints`、`placeholder`、
要素の英名）は既存 JSON から引き継がれる。これらの追加・修正は `.claude/skills/cl-command-def`
の手順に従う。

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
