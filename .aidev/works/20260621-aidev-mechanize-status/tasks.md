# タスク: aidev 状況の機械抽出（status / metrics）とルーター置換

関連 issue: #24

- [x] T1: `eval_depends`（読み取り専用・共有）を sh に追加し、`check_depends` をそれ利用に改修。guard の
      exit コード(2/3)・メッセージ・advisory(warn) 挙動は不変に保つ。
- [x] T2: ps1 に `Eval-Depends` を追加し、`Cmd-Guard` をそれ利用に改修（T1 とパリティ・挙動不変）。（依存: T1）
- [x] T3: sh に `aidev status [--format table|tsv]` を追加。works 走査（work/ticket/mode/current/next/done/deps）
      ＋backlog 走査（file/todo/needs、archive 除外）。table（桁揃え）＋tsv（先頭列でレコード種別）。（依存: T1）
- [x] T4: ps1 に `Cmd-Status` を追加（T3 と出力・終了コード一致）。（依存: T3, T2）
- [x] T5: sh に `aidev metrics [slug] [--all] [--phases] [--format table|tsv]` を追加。ts 正規化（Z/UTC/無し）、
      awk による epoch 秒変換、per-work（first_start/delivered/lead_sec/reworks/sent_backs）＋`--phases`
      （phase/start/approved/elapsed_sec）。不正 ts は skip＋warn。（依存: T3）
- [x] T6: ps1 に `Cmd-Metrics` を追加（T5 と秒・出力一致。epoch は `[DateTimeOffset]`）。（依存: T5）
- [x] T7: 両 CLI 冒頭コメントに status/metrics の使い方を追記し、`usage()` を「先頭の連続コメント行のみ」を
      出す堅牢版に変更（行数レンジ脆弱性を解消）。`.aidev/bin/README.md` のコマンド表に status/metrics を追記。（依存: T4, T6）
- [x] T8: `.aidev/bin/test/run.sh` にシェルベーステストを新設（status/metrics の table・tsv 検証、legacy/未deliver/
      依存/手戻り の境界、sh⇔ps1 パリティ[pwsh無ければskip]、既存コマンド回帰、読み取り専用の確認）。全17 pass。（依存: T7）
- [x] T9: `aidev-00-start/SKILL.md`「2. 作業状況の確認」「2.5 未着手キュー」を `aidev status` 呼び出しへ置換
      （CLI 無し環境のフォールバック手順も併記。`⛔依存待ち` は deps 列由来で表現）。（依存: T4, T8）
- [x] T10: `aidev-util-insights/SKILL.md` の「入力」「手順2/3」の手集計を `aidev metrics --all` 利用へ更新
      （解釈・提案は従来どおり skill が担う）。（依存: T6, T8）
