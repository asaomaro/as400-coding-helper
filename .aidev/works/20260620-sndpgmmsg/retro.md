# 振り返り: SNDPGMMSG 定義作成

## サマリ
CLコマンド SNDPGMMSG のプロンプター定義を requirement→deliver で完走（PR #8）。
リードタイム約29分（07:56→08:25Z）。手戻り2回・差し戻し2件。
（注: spec/plan/coding 初回は「通して」一括実行したため timestamp が同一で、工程別時間は測定不可。）

## うまくいった点
- **research の原典取得**で、知識ベース下書きの誤り（MSG長 512→3000、TOPGMQ のネスト構造）を早期是正できた。
- **review が dropdown 未使用を捕捉**し、help 埋め込み→選択肢UIへ品質向上できた。
- **差し戻しループ（research, review→coding）が機能**し、各段で是正できた。
- approach A（PJ skill 委譲）で取得手段・スキーマ・マッピングを `cl-command-def` に集約できた。

## 課題 / 手戻り
- **手戻り1（research・403）**: IBM docs が WebFetch=403 かつ SPA で本文取得不可。
  → Playwright headless で解決。**前段（取得手段の道具立て）を先に確認していれば**回避できた。
- **手戻り2（review→coding・dropdown）**: 固定値パラメータを text+help にしていた。
  原因は **research/spec が PJ 自身のスキーマ型 `types.ts` を未確認**だったこと
  （IBM原典は読んだが、出力先スキーマの全機能を確認していなかった）。**research で types.ts を読めば**防げた。
- **メトリクスの粒度**: 「通して」進めた区間は start/approved の ts が潰れ、工程別の所要が測れない。

## 改善提案
### 製品 / コード（→ issue 候補）
- スキーマギャップ: 項目間相関制御（**#7 登録済**）、children のネスト対応（TOPGMQ の2階層ELEMを平坦化中）。
- （enum は当初ギャップと誤認したが types.ts に dropdown/options が存在＝対応済。新規対応不要。）

### PJ プロセス / 規約（→ AGENTS.md）
- CL定義作成時は **「IBM原典」＋「出力先スキーマ型(types.ts)」の両方を必ず確認**する旨を明記。
  （`cl-command-def` skill には反映済。AGENTS.md にも一般則として追記候補。）
- IBM Documentation の取得は **Playwright headless が前提**（WebFetch=403・SPA）。

### ハーネス自体（→ aidev-* への提案・適用は人間）
- **research のジェネリック観点に「PJ自身のスキーマ/型/規約の確認」を追加**。今回はPJ skill側で是正したが、
  汎用 research にも「出力先の仕様（型・既存実装）を読む」を一般則として加える価値がある（手戻り2の根因対策）。
- **deliver の記録順序の癖**: deliver は工程記録をコミットするため、deliver 自身の approved/metrics を
  同コミットに含められない。protocol に「deliver の state/metrics はコミット直前に記録」等の手順を明記。
- **一括実行時のメトリクス**: 「通して」進めると工程別時間が潰れる点を注記、または各工程の最低限の
  時間記録を促す運用ガイドを protocol に追加。
