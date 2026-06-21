# 仕様: aidev 状況の機械抽出（status / metrics）とルーター置換

関連 issue: #24 / 前工程: requirement.md, research.md

## 概要

`aidev` CLI（sh / ps1）に **読み取り専用の機械抽出コマンド 2 つ**を追加し、AI による手読み・手集計を置換する。

- `aidev status` … works 横断（state.yml）＋ backlog 未着手（`.aidev/backlog/*.md`）の状況サマリ。
  → `aidev-00-start`「2/2.5」の手読みを置換。
- `aidev metrics` … metrics.yml のイベントログから protocol §8 の派生指標（リードタイム/手戻り/差し戻し/
  工程経過）を機械集計。→ `aidev-util-insights` の手集計を置換。
- dependsOn 充足判定を **読み取り専用の共有関数**に切り出し、`guard` と `status` で共用（C）。

いずれも **Node 非依存・sh/ps1 パリティ・読み取り専用（state を書き換えない）**。

## 設計方針

- 既存 CLI のヘルパ（`yget`/`ylist`/`approved_has`/works 走査/`PHASES`）とディスパッチに**追加**する形を取る
  （新ファイルを作らず、二本（sh/ps1）に同一機能を実装）。
- **パリティ契約は機械形式（`--format tsv`）の厳密一致**を主とする。表形式（既定）は同一データ由来の派生で、
  全フィールド ASCII のため桁揃えも一致する（research F3）。
- 時刻差演算（metrics）は ISO8601(UTC) を epoch 秒へ変換して算出。sh は **awk の civil-days 純算術**、
  ps1 は `[DateTimeOffset]` で求め、**秒（整数）で一致**させる。
- 出力は UTF-8(BOM なし)・LF。終了コードは原則 `0`（読み取り専用。致命的環境エラーのみ `1`）。

## 対象範囲（変更/追加ファイル）

- `.aidev/bin/aidev`（sh）: `status` / `metrics` コマンド追加、`eval_depends`（共有）追加、`check_depends` を
  共有関数利用に改修、冒頭コメントの使い方追記、`usage()` の抽出行範囲調整、末尾 `case` に分岐追加。
- `.aidev/bin/aidev.ps1`（ps1）: 上記と挙動一致の実装（`Cmd-Status`/`Cmd-Metrics`/`Eval-Depends`、
  `Cmd-Guard` 改修、コメント＋`Usage()` の `-First` 調整、`switch` 追加）。
- `.aidev/bin/README.md`: コマンド表に `status` / `metrics` を追記。
- `.claude/skills/aidev-00-start/SKILL.md`: 「2. 作業状況の確認」「2.5 未着手キュー」を `aidev status` 呼び出しへ。
- `.claude/skills/aidev-util-insights/SKILL.md`: 「入力」「手順2/3」の手集計を `aidev metrics --all` 利用へ。
- テスト: `.aidev/bin/test/`（または既存テスト位置）に sh/ps1 パリティ・出力検証を追加（plan で配置確定）。

## インターフェース / データ構造

### 1. `aidev status [--format table|tsv]`

- 既定 `--format table`（人間可読・桁揃え）。`--format tsv`（機械向け・タブ区切り）。
- **works 走査**: `.aidev/works/*/`（名前昇順）。各 work の `state.yml` から抽出。
  - `work`   : works ディレクトリ名（例 `20260621-aidev-mechanize-status`）= 一意キー。
  - `ticket` : `ticket`（無ければ `-`）。
  - `mode`   : `mode`（無ければ `-`）。
  - `current`: `current`。
  - `next`   : **done=yes（deliver 承認済）なら `-`**。done=no のとき、**標準パイプライン**
    `requirement spec plan coding test review deliver` のうち `approved` に無い**最初**の工程
    （すべて承認済みなら `-`）。
  - `done`   : `approved` に `deliver` を含めば `yes`、無ければ `no`。
  - `deps`   : `eval_depends`（後述）の結果。充足/依存なしは `ok`、未充足はトークンを `,` で連結
    （例 `20260620-x(未deliver),#18(advisory)`）。
- **backlog 走査**: `.aidev/backlog/*.md`（`archive/` ディレクトリ配下は除外、名前昇順）。
  - `file`   : ファイル名（例 `rpg-spec.md`）。
  - `todo`   : 未チェック行 `^[[:space:]]*- \[ \]` の件数。
  - `needs`  : 上記のうち `(needs:` を含む行数（依存待ち件数）。
- **table 形式**（例。列はデータ最大幅で揃える）:

  ```
  WORKS (2)
  work                              ticket  mode        current  next   done  deps
  20260620-ruler-display            #2      -           deliver  -      yes   ok
  20260621-aidev-mechanize-status   #24     interactive spec     plan   no    ok

  BACKLOG (未着手 4 件)
  file          todo  needs
  rpg-spec.md   4     4
  ```
  - works が 0 件なら `WORKS (0)` のみ。backlog ファイルが無ければ `BACKLOG (未着手 0 件)` のみ。

- **tsv 形式**（先頭列にレコード種別。`\t` 区切り・ヘッダ無し）:

  ```
  work<TAB><work><TAB><ticket><TAB><mode><TAB><current><TAB><next><TAB><done><TAB><deps>
  backlog<TAB><file><TAB><todo><TAB><needs>
  ```
  - 空値は `-`。`deps` の未充足は `,` 連結（タブは含めない）。
  - パーサは1列目（`work`/`backlog`）でレコード種別を判定できる。

### 2. `aidev metrics [slug] [--all] [--phases] [--format table|tsv]`

- 対象: 引数 slug → その work／`--all` → 全 work（名前昇順）／無指定 → `.aidev/current`。
- ソースは各 work の `metrics.yml`（`events:` ブロック）。各イベント行から `ts` / `phase` / `event` を抽出
  （`metrics:{…}` マップは metrics 既定出力では使わない。将来拡張）。
- **ts 正規化**: 末尾 `Z` / `UTC` / 無しのいずれも受理し、`YYYY-MM-DDThh:mm:ss` を UTC として epoch 秒へ。
  不正な ts はスキップ（その値は欠落として扱い、警告は stderr）。
- **既定（per-work サマリ）出力列**:
  - `work`        : works ディレクトリ名。
  - `first_start` : 最初の `start` の ts（無ければ `-`）。
  - `delivered`   : `deliver`/`approved` の有無 → `yes`/`no`。
  - `lead_sec`    : `deliver` approved の ts − 最初の start の ts（秒）。未 deliver は `-`。
  - `reworks`     : **同一 phase の `start` が 2 回以上**ある phase の数（手戻り）。
  - `sent_backs`  : `sent_back` イベントの総数。
- **`--phases` 指定時（工程別明細）出力列**:
  - `work` / `phase` / `start`(直近) / `approved` / `elapsed_sec`（approved − 直近 start）。
    approved 未到達の phase は `elapsed_sec=-`。
- **table / tsv** は status と同方針（tsv はヘッダ無し・`\t` 区切り・空値 `-`）。`--phases` の tsv は
  1列目を `phase` レコードにする必要はなく、列数が一定なのでそのまま行出力。

### 3. 共有関数 `eval_depends`（C / 読み取り専用）

- 入力: 対象 work の `state.yml` の `dependsOn`。
- 動作: 各依存トークンを判定し、**未充足トークンの配列/文字列**を返す（state は変更しない）。
  - `#…`（外部チケット）→ 自動判定不可 = `#…(advisory)` を「未充足扱いの注記」として返す
    （status 表示用）。**guard では従来どおり advisory は exit に影響させない**（warn のみ）。
  - works slug → 当該 work の `approved` に `deliver` が含まれれば充足、無ければ `slug(未deliver)`、
    work 不在なら `slug(work不明)`。
- `guard` はこの関数を使って `GDEP` を構築（**現行の exit コード挙動・メッセージは不変**。advisory は warn）。
- `status` の `deps` 列は、未充足が無ければ `ok`、あればトークンを `,` 連結（advisory も併記）。

## 振る舞いの詳細 / エッジケース

- **legacy work**（`schema` 未記載）も status/metrics に通常どおり出る（除外しない）。`done`/`next` は
  `approved` だけから導出するので schema 非依存。
- **metrics.yml 不在 / `events:` 空**: その work の metrics は `first_start=-`,`delivered=no`,`lead_sec=-`,
  `reworks=0`,`sent_backs=0`。エラーにしない。
- **走査順**: works/backlog とも名前昇順（sh グロブ＝辞書順、ps1 は `Sort-Object Name`／backlog も同様）。
- **`--format` 不正値**: `die`（exit 1, 使用法エラー）。
- **`status`/`metrics` は state.yml/metrics.yml を書き換えない**（読み取り専用。verify/doctor と同列の検査系）。
- **usage 範囲**: 冒頭コメントに使い方行を足すため、`usage()`（sh `sed -n '2,30p'` / ps1
  `Select-Object -First 28`）の範囲を、追加後のコメント末尾まで届くよう拡張する（リグレッション注意）。

## ドメイン固有の考慮

- **sh/ps1 パリティ必須**（AGENTS / README 規約）。実装後、同一リポジトリ状態で
  `aidev status --format tsv` と ps1 版の出力・終了コードが完全一致することをテストで担保。
- **Node 非依存**（sh は sed/awk/grep/date のみ）。
- 既存コマンド（new/event/approve/guard/verify/doctor）の挙動・出力を壊さない
  （特に `guard` の改修は exit コード/メッセージ不変であること）。

## エラー処理 / 異常系

- `.aidev` 不在 → 既存 `find_root` が `die`（exit 1）。
- 不正 `--format` / 不明オプション → `die`（exit 1）。
- 不正 ts（metrics）→ 当該イベントをスキップし stderr に warn（致命にしない）。
- backlog ディレクトリ不在 → backlog セクションは 0 件表示（die しない）。

## 受け入れ基準との対応（requirement 完了条件）

- works 横断＋backlog を人間可読表で出力 → `status`（既定 table）。
- 機械向け形式でパース可能 → `status --format tsv` / `metrics --format tsv`（先頭列でレコード判別）。
- sh/ps1 出力・終了コード一致 → パリティテスト（status/metrics の tsv を主契約）。
- legacy work 込みで正しく一覧 → §振る舞い（schema 非依存導出）。
- ルーターの手読み消去 → `aidev-00-start/SKILL.md` を `aidev status` 呼び出しへ改修。
- README にコマンド追記 → `.aidev/bin/README.md` コマンド表。
- 他候補の調査・整理 → research.md（A=status,B=metrics,C=共有関数を本作業、doctor は対応済み）。
- （追加）insights 手集計の置換 → `aidev-util-insights/SKILL.md` を `aidev metrics --all` 利用へ。

## テスト方針（plan で具体化）

- status: works/backlog を含む一時 `.aidev` フィクスチャで table/tsv を検証、legacy work 込み、deps 各分岐。
- metrics: 既知イベント列から lead_sec/reworks/sent_backs/elapsed_sec を検証（境界: 未 deliver・手戻り有り）。
- パリティ: sh 出力 == ps1 出力（`pwsh` がある環境）。`pwsh` 不在 CI ではスキップ可（要明示）。
- 回帰: 既存コマンドのスナップショット（new/approve/guard/verify/doctor）が不変。
