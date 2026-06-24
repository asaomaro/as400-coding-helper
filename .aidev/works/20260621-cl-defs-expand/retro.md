# 振り返り: CLコマンド定義JSONの拡充（issue #43 / 85件 全消化）

対象は issue #43 を構成する3作業を横断:
`20260621-cl-defs-expand`（P1 21件・標準パイプライン）/ `-batch-p2p4`（P2+P3+ADDPFM 10件）/
`-batch-rest`（残り54件）。PR #44 にまとめてマージ済み（issue #43 CLOSE）。

## サマリ

- **CL未定義85件すべてを原典準拠で定義化**（既存10＋85＝計95件）。1セッションで requirement→deliver→merge まで到達。
- **手戻り0・差し戻し0・test失敗0**。レビュー指摘は nit 1件（CALLPRC の子要素 name を日本語→`PASSING` に修正）のみ。
- リードタイム: 実装は約70分（09:06 requirement start 〜 10:15 最終 deliver）。後半54件は並列化で短縮。
- 主エージェントによる原典機械diff: 集合54/54一致・必須955件一致・dropdown 249値幻覚0。

## うまくいった点

- **ローカル原典HTMLを正とする方式（D1）**: PR #42 収集の出典固定HTMLを直読。IBM Docs の403/SPAを回避でき、
  再現性・オフライン実行・機械diff照合が可能になった。
- **ドラフト委譲 × 主エージェント検証の分業**: 後半54件はドラフトを11並列サブエージェントに委譲しつつ、
  原典照合（パラメータ集合・必須の機械diff）は主エージェントが全件実施。**スループットと原典忠実性を両立**。
  サブエージェントが読むのは**ローカルファイル**なので、protocol §2.6 が警戒する「ネットワーク権限劣化による幻覚」
  の問題が起きない構図にできた。
- **双方向 keyword diff の検証手法**: 「原典詳細節の `(KW)` ヘッダ」と「JSON パラメータ集合」を機械突合し、
  不一致のみ要約表を直読して確定。19件の不一致がすべて heuristic 由来（誤検出）と判明し、実装の正しさを確認できた。
- **早期に確立した規約の横展開**: P1 で固めたマッピング（修飾名→group[LIB,name]、ELEM平坦化、固定値dropdown／
  混在text+help、定義済み値default=先頭）を以降のバッチ・各サブエージェントに同一指示で適用し一貫性を確保。
- **カテゴリ別コミット**: 85件を P1–P10 の小コミットに分割し、巨大PRでもレビュー単位を保った。

## 課題 / 手戻り

- **手戻りは0だが「検証摩擦」はあった**: `(KW)` 抽出 heuristic が他パラメータ参照（CRTAUT/UPDPROD/RMTLOCNAME等）を
  誤検出し、また SRCMBR/CONTIG/FNTRSL 等を取りこぼした。19件すべて要約表の手読みで「誤検出」と確定でき、
  実装誤りはゼロだった。前段（検証手法の設計）で「詳細節ヘッダは他コマンド参照を含みうる」と分かっていれば、
  最初から要約表ベースの抽出にできた。
- **ネスト要素リストの子要素 name はベストエフォート**: 平坦化した子（例 SAVOBJ の SELECT 配下、ADDLIBLE POSITION）の
  name は IBM 内部キーワードと厳密一致を保証していない。トップレベルは機械diff済みだが、子レベルの忠実性と
  ソース書き戻し（applyChanges）の整合は未検証。
- **F4 実機スモーク未実施**: headless 環境のため受け入れ①は「ロード可能性＝構造健全性」で代理担保にとどまる。
- **記録品質**: バッチ2作業（p2p4 / rest）は coding→review→deliver の承認を連続実行したため `metrics.yml` の
  ts が同一値に潰れ、工程別の所要時間が失われた（protocol §8「工程ごとに date を取り直す」を満たせていない）。
  また CLI が phase `batch` を未対応で coding に読み替えた（precedent の state.yml は `batch` を使用）。

## 改善提案

### 製品 / コード（→ issue 候補）

- **子要素レベルの原典忠実性＆書き戻し検証**: 平坦化した group 子要素の name とソース書き戻し（CL構文
  `PARM((val *BYREF)...)` 等）の整合を検証する follow-up。必要なら types.ts に ELEM/単一値を表す構造を追加。
- **スキーマ拡張の検討**: 「単一値 or 要素リスト」「修飾名＋単一値の混在」を表現する型が無く平坦化で意味が
  落ちている（CHGDTAARA/RMVMSG/DSPFD 等）。enum＋検索や oneOf 的表現の追加可否を検討。
- **RTVSYSVAL SYSVAL（158値 dropdown）の UX**: 大規模固定列挙の入力方式（検索可能 dropdown / text+補完）を検討。
- **構造検証を CI/テストに組み込み**: `scripts/validate-prompter-defs.mjs` は独立実行。`npm test` 連動や CI 化で
  回帰を自動化（現状 `test` script はプレースホルダ）。
- **F4 実機スモーク**: 代表数件（IF / CALLPRC / SNDMSG / CPYF 等）の実機 F4 動作確認を行う follow-up。
- ile / rpg3 の CL 定義は別 issue（既定スコープ外）。

### PJ プロセス / 規約（→ AGENTS.md / cl-command-def skill）

- **確立した CL マッピング規約を skill に明文化**: 修飾名→group[LIB,name]（LIB先頭）、ELEM平坦化、固定値dropdown／
  混在text+help+default、定義済み値default=先頭、戻りCL変数→text、反復→maxOccurrences。今回は各サブエージェントが
  個別に再導出した。skill に集約すれば次バッチの一貫性・効率が上がる。
- **原典ソースの記述を更新**: `cl-command-def` skill は今も「Playwright で IBM Docs を取得」前提。`docs/origin/` の
  ローカル原典を正とする運用（D1）を skill に反映する。
- **検証手法の明文化**: 双方向 keyword diff（要約表＝権威、詳細節 `(KW)` は補助で他コマンド参照を含みうる）＋
  必須フラグ機械照合＋dropdown値照合、という検証パターンを規約化（誤検出モードも併記）。

### ハーネス自体（→ aidev-* への提案・適用は人間）

- **batch util の記録ガイド**: 連続承認による `metrics.yml` の ts 潰れを防ぐため、バッチでも工程ごとに ts を取り直す
  か、CLI 側で同一秒の連続イベントに自動オフセットを付ける運用を検討。工程別所要時間の分析性が戻る。
- **phase 語彙の整合**: precedent（`20260620-cl-defs-batch`）の state.yml は `approved:[batch,...]` を使うが現 CLI は
  phase `batch` を拒否。`aidev-util-batch` の標準フェーズ（coding 読み替え or `batch` 正式サポート）を protocol/CLI で
  明文化し、ドキュメントと実装の乖離を解消する。
- **「ローカル一次資料からのドラフト委譲＋主エージェント機械diff検証」を §2.6 に明示**: 現行は「原典照合は委譲しない」
  を強調するが、今回の「サブエージェントは**ローカル原典**を読んでドラフト→主エージェントが機械diffで確定」は
  権限劣化リスクが無く忠実性も担保できた。この中間パターンを正式に許容パターンとして protocol に記すと、
  大量定義タスクのスループットを安全に上げられる。
