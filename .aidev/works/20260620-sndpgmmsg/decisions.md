# 決定記録

## D1: 定義済み値(*INFO 等)は dropdown+options で表現（review で是正）
- 当初決定（誤り）: 「スキーマに enum 欄が無い」と判断し help 列挙＋placeholder にした。
- 是正: `src/prompter/types.ts` に `inputType: "dropdown"` ＋ `options[{label,value}]` が存在。
  固定値が主役のパラメータ（MSGTYPE、TOPGMQ.RELATION）は **dropdown+options** を使う。
- 原因: research/spec が IBM原典のみ参照し、PJ自身のスキーマ型を未確認だった（→プロセス改善）。
- 影響: 固定値＋自由入力が混在する CCSID/TOUSR は text 継続（dropdown不可のため）。

## D2: TOPGMQ のネストELEM を平坦化
- 背景: 原典の TOPGMQ は「単一値*EXT / 要素1関係 + 要素2(さらに3要素)」の2階層ネスト。
  現スキーマの children は1階層のみ。
- 決定: children を4要素（RELATION/CSEID/MODULE/PGM）に平坦化し、単一値*EXTと特殊値は help に明記。
- 影響: 原典のネスト構造を完全再現しない。完全表現には children のネスト対応（スキーマ拡張）が必要。
  → 改善提案候補（review/retro）。

## D3: 条件付き必須・排他はスキーマ表現不可のため help で補足
- MSG↔MSGID 排他 / 送信先 TOPGMQ・TOMSGQ・TOUSR 排他 / MSGID時 MSGF 必須。
- スキーマに排他・条件必須の表現が無いため、各 help に明記する方針。
