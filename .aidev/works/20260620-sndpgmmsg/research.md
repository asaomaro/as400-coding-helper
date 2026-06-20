# 調査: SNDPGMMSG コマンド仕様（IBM原典・検証済み）

## 取得方法（403回避）
- IBM Documentation は WebFetch（bot）に **403**、かつ JS 描画の SPA のため curl では本文取得不可。
- **Playwright + headless Chromium** で実ブラウザ描画して本文を取得（成功）。
  - 出典: `https://www.ibm.com/docs/ja/ssw_ibm_i_74/cl/sndpgmmsg.htm`（→ ja/i/7.4.0 にリダイレクト）
- → 以降、CLコマンド定義の原典取得はこの方式（headless ブラウザ）を標準とする。

## 用途
CL プロシージャー/プログラムから、メッセージ待ち行列または呼び出しメッセージ待ち行列へ
メッセージを送信する。例外/非例外メッセージの両方を送れる。

## パラメータ仕様（原典より・全て任意）

| キーワード | 定位置 | 型/選択項目 | 構造 | 備考 |
|---|---|---|---|---|
| MSG | 1 | 文字値（最大3000、プロンプト時512） | 単一 | 即時メッセージ本文。MSGID と排他 |
| MSGID | 2 | 名前 | 単一 | 定義済みメッセージID。MSG と排他 |
| MSGF | 3 | 修飾オブジェクト名 | group(2): ファイル名 / ライブラリ(*LIBL,*CURLIB,名前) | MSGID 指定時は必須 |
| MSGDTA | 4 | 文字値, *NONE | 単一 | 置換データ |
| TOPGMQ | – | 単一値 *EXT / または要素リスト | **ネストgroup** | 下記参照。送信先(PGM MSGQ) |
| TOMSGQ | – | 単一値 *TOPGMQ,*SYSOPR / 修飾名(最大50反復) | group(2)＋maxOccurrences:50 | 名前/*HSTLOG ＋ ライブラリ。TOUSR と排他 |
| TOUSR | – | 名前, *SYSOPR, *ALLACT, *REQUESTER | 単一 | TOMSGQ/TOPGMQ と排他 |
| MSGTYPE | – | *INFO,*INQ,*RQS,*COMP,*DIAG,*NOTIFY,*ESCAPE,*STATUS | 単一 | 既定 *INFO |
| RPYMSGQ | – | 単一値 *PGMQ / 修飾名 | group(2): 名前 / ライブラリ | *INQ/*NOTIFY の応答先 |
| KEYVAR | – | 文字値（CL変数, 長さ4） | 単一 | 戻り: メッセージ参照キー |
| CCSID | – | 1-65535, *HEX, *JOB | 単一 | コード化文字セットID |

### TOPGMQ の構造（ネスト）
- 単一値: `*EXT`
- または 要素リスト:
  - 要素1 関係: `*PRV`(既定), `*SAME`
  - 要素2 呼出スタック項目識別コード（さらに3要素）:
    - 要素2-1 呼び出しスタック項目: 文字値, `*`（特殊値 *CTLBDY/*PGMBDY/*PGMNAME 等）
    - 要素2-2 モジュール: 名前, `*NONE`
    - 要素2-3 バインド済みプログラム: 名前, `*NONE`

## spec への申し送り（マッピング上の論点）
- **送信先の排他**: TOPGMQ / TOMSGQ / TOUSR はいずれか。スキーマに排他表現が無いため help に明記。
- **MSG/MSGID の排他**、**MSGID 指定時 MSGF 必須**（条件付き必須）も help に明記（スキーマに条件必須なし）。
- **定義済み値（*INFO 等）**: 現スキーマに enum 欄なし → help 列挙＋placeholder。MSGTYPE のように
  選択肢が主役のパラメータが多く、**スキーマへの enum 追加**を改善提案候補とする（review/retro）。
- **TOPGMQ のネストELEM**: 現スキーマの children は1階層想定。2階層ネストの表現可否を spec で要判断
  （簡略化して主要素のみ group 化する案も検討）。
- **maxOccurrences**: TOMSGQ=50。

## 知識ベース版との差分（research の効果）
- MSG 長: 512 と誤認 → 正は最大3000（512はプロンプト時のみ）。
- TOPGMQ: 単純2要素と誤認 → 正は単一値*EXT＋深いネストELEM。
- これらは spec を誤らせる差分であり、原典取得で是正できた。
