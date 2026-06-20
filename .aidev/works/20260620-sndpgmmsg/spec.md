# 仕様: SNDPGMMSG 定義JSONのマッピング設計

前提: research.md（IBM原典・検証済み）、テンプレ `cl/CALL.json`

## 概要
research の SNDPGMMSG 仕様を、既存スキーマ（keyword/parameters[name,description,help,inputType,
required,attributes,placeholder,children,maxOccurrences]）へマッピングする。

## 設計方針（マッピング）

| パラメータ | inputType | required | attributes/その他 | 定義済み値の扱い |
|---|---|---|---|---|
| MSG | text | false | maxLength 3000 | help: MSGIDと排他 |
| MSGID | text | false | characterSet upper, maxLength 7 | help: MSGと排他 |
| MSGF | group | false | children: ライブラリ + ファイル | 子のlibに *LIBL/*CURLIB を help |
| MSGDTA | text | false | maxLength 3000 | help: *NONE |
| TOPGMQ | group | false | children(平坦化4要素) | help: 単一値*EXT・特殊値 |
| TOMSGQ | group | false | children: ライブラリ+待ち行列, maxOccurrences 50 | help: *TOPGMQ/*SYSOPR/*HSTLOG |
| TOUSR | text | false | characterSet upper, maxLength 10 | help: *SYSOPR/*REQUESTER/*ALLACT |
| MSGTYPE | text | false | placeholder *INFO | help: 8種を列挙(既定*INFO) |
| RPYMSGQ | group | false | children: ライブラリ+待ち行列 | help: 単一値*PGMQ |
| KEYVAR | text | false | characterSet upper | help: 戻り変数(長さ4) |
| CCSID | text | false | placeholder *JOB | help: *HEX/*JOB/1-65535 |

## 設計判断
- **enum 欄が無い**: 定義済み値は help に列挙し、代表値を placeholder に置く（スキーマ未拡張のため）。
- **TOPGMQ のネストELEM は平坦化**: 現スキーマの children は1階層。TOPGMQ の
  「関係／呼び出しスタック項目／モジュール／プログラム」を group の children 4要素に平坦化し、
  単一値 *EXT は help に明記。完全なネスト表現はスキーマ拡張が必要（→ decisions に記録、改善提案）。
- **排他・条件付き必須**（MSG↔MSGID、送信先 TOPGMQ/TOMSGQ/TOUSR、MSGID時MSGF必須）は
  スキーマに表現が無いため各 help に明記。

## 受け入れ基準との対応
- 全11パラメータを網羅・型/必須/反復/修飾を原典準拠で反映 → 各行で担保
- 既存スキーマ準拠（CALL.json と同一キー） → inputType/children/attributes のみ使用
- 日本語ヘルプ → 各パラメータに付与
