# 調査: RPG III(RPG/400) 仕様書の桁レイアウト（原典直読）

原典: `docs/origin/rpg3/`（jaymoseley RPG tutorial、PR #42 収集）。主エージェントが生テキストを直読して桁位置を抽出。
**桁は1始まり。仕様書コード（Form Type）は全仕様共通で 6桁目**（既存 C-SPEC・research 20260620 と整合）。

## 結論（feasibility）

- **F / I / O 仕様**: `rpg002.html` に「Column(s) Field Name Use」表として**桁付きで完全に存在** → 実装可能。
- **H 仕様（制御/ヘッダー）**: RPG III では最小。プログラム名が **75-80桁**（`rpg002` 前文「program name, columns 75-80」）。
  その他は 7-74 ほぼ予約。最小定義として実装可能。
- **C 仕様**: #18 で実装済み（本作業対象外）。
- **E（拡張）/ L（行カウンター）**: `rpg010.html`（Advanced statement types: Extension/Line Counter）に桁情報あり
  （範囲表記 44件）。実装時に rpg010 を直読して確定する（本research では F/I/O/H を先行確定）。
- **O 編集語の詳細**: `rpg011.html`（Output Edit Words）。O-SPEC 実装時に補助参照。

## F-SPEC（ファイル記述仕様書）桁レイアウト ← rpg002 セクション1

| 桁 | 項目 | 値/用途 |
|---|---|---|
| 6 | Form Type | `F` |
| 7-14 | File Name | ファイル名 |
| 15 | File Type | `I`=input / `O`=output / `U`=update（dropdown） |
| 16 | File Designation | `P`=primary / `S`=secondary / `C`=chained / `R`=record address / `T`=table（dropdown） |
| 17 | End of File | `E` |
| 18 | Sequence | `A`=ascending / `D`=descending |
| 19 | File format | `F`=fixed / `V`=variable |
| 20-23 | Block Length | ブロック長 |
| 24-27 | Record Length | レコード長 |
| 28 | Mode of Processing | blank=sequential / `L`=segment(limits) / `R`=random |
| 29-30 | Length of Record Address or Key Field | |
| 33-34 | （Record Address Type / I-O area 等。原典 "33-34 ... I = indexed sequential"） | |
| 35-38 | （Extension code / Device 関連） | |
| 40-46 | Device | READ40/PRINTER/TAPE/DISK14 等 |
| 47-52 | （継続） | |
| 66 | （継続項目） | |
| 71-72 | （new records to be added 等） | |

> 注: 35-52・66 周辺は原典の散文が断片的。F-SPEC 実装時に rpg002 の該当節を再精読して 33-72 を確定する
> （主要桁 6-30 は確定）。

## I-SPEC（入力仕様書）桁レイアウト ← rpg002 セクション2（レコード識別）＋セクション3（フィールド）

### レコード識別エントリ
| 桁 | 項目 | 値/用途 |
|---|---|---|
| 6 | Form Type | `I` |
| 7-14 | File Name | |
| 14-16 | OR/AND | 3超のレコード識別子/代替指標 |
| 15-16 | Sequence | 01〜 / 英字2桁（unsequenced） |
| 17 | Number | `1`=1件のみ / `N`=1件以上 |
| 18 | Option | `O`=任意 / blank=必須 |
| 19-20 | Record Indicator | 01-99 |
| 21-24, 28-31, 34-38 | Position（レコード識別コード） | |

### フィールド記述エントリ
| 桁 | 項目 | 値/用途 |
|---|---|---|
| 43 | Packed | `P` |
| 44-47 | Field Begins | フィールド開始位置 |
| 48-51 | Field Ends | フィールド終了位置 |
| 52 | Decimal Positions | 0-9 |
| 53-58 | Field Name | |
| 59-60 | Control Level | L1..L9 |
| 61-62 | Matching/Chaining Fields | M1..M3 / C1..C9 |
| 63-64 | Field/Record Relation | |
| 65-66 | Positive | 指標 |
| 67-68 | Negative | 指標 |
| 69-70 | Zero or Blank | 指標 |

## O-SPEC（出力仕様書）桁レイアウト ← rpg002 セクション4（レコード）＋セクション5（フィールド）

### レコード（出力制御）エントリ
| 桁 | 項目 | 値/用途 |
|---|---|---|
| 6 | Form Type | `O` |
| 7-14 | File name | |
| 14-16 | AND/OR | |
| 15 | Type | `H`=heading / `D`=detail / `T`=total（dropdown） |
| 16-18 | ADD | ISAM へのレコード追加 |
| 17 | Space Before | 0-3 |
| 18 | Space After | 0-3 |
| 19-20 | Skip Before | 01-12 |
| 21-22 | Skip After | 01-12 |
| 23, 26, 29 | Negates indicator | `N` |
| 24-25, 27-28, 30-31 | Indicator | 条件指標 |

### フィールド（出力）エントリ
| 桁 | 項目 | 値/用途 |
|---|---|---|
| 32-37 | Field Name | 出力フィールド |
| 38 | Edit Code | 編集コード |
| 39 | Blank After | |
| 40-43 | End Position | 出力レコード内の右端位置 |
| 44 | Packed | `P` |
| 45-70 | Constant or Edit Word | リテラル定数/編集語（アポストロフィ囲み） |

## H-SPEC（制御/ヘッダー仕様書）

| 桁 | 項目 | 値/用途 |
|---|---|---|
| 6 | Form Type | `H` |
| 7-74 | （RPG III ではほぼ予約/各種制御オプション） | |
| 75-80 | Program Name | 省略時 RPGOBJ（原典 "program name, columns 75-80"） |

> RPG III の H 仕様は最小。確実な原典記載は Form Type(6) と Program Name(75-80)。

## 設計上の論点（spec へ）

- **I/O 仕様は「レコード行」と「フィールド行」で桁が異なる**（別のエントリ種別）。1つの `<X>-SPEC.json` 定義で
  両方を表すか、行種別で分けるか。既存 `rpg/ile/{I,O}-SPEC.json` の扱いを spec で確認して踏襲する。
- 桁が断片的な箇所（F-SPEC 33-72）は実装時に rpg002 を再精読。**到達できない桁は推測せず保留**（skill 規約）。
- 実装スコープ: 原典が確定している H/F/I/O を優先。E/L は rpg010 直読後に追加（backlog 追跡）。
