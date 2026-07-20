# テスト結果: DDS / .cmd の DocumentSymbolProvider

## 実施した検証

### 1. ユニットテスト（`npm test`）

**122 passing / 0 failing**（本作業の前は 72 passing）。追加は 50 件。

| テストファイル | 内容 |
|---|---|
| `outlineDds.test.ts` | DDS の木の形・detail・range/selectionRange・異常系 |
| `outlineCmd.test.ts` | `.cmd` の木の形・グループ解決・継続行・異常系 |
| `outlineTypes.test.ts` | `OutlineKind` → `SymbolKind` の網羅、アダプタの再帰 |
| `outlineRegistration.test.ts` | 到達性（実際に登録された selector を検査） |
| `contributesSideEffects.test.ts`（追記） | 拡張子集合の単一真実源 |

フィクスチャは `docs/src/` の**実サンプル**を読んでいる（合成文字列ではない）。

### 2. 追加したテストが本当に欠陥を捕まえるかの確認

AGENTS.md「テストを足したら、直す前の状態に戻して落ちることを確かめる。
落ちないテストは何も守っていない」に従い、欠陥を意図的に戻して確認した。

| 戻した欠陥 | 結果 |
|---|---|
| DDS のキー(`K`)をフィールド扱いにする | **3 failing** |
| `.cmd` の QUAL/ELEM グループ解決を無効化 | **3 failing** |
| `ddsKeywordCompletion` の glob を手書きに戻す（`.dds` 欠落） | **1 failing** |
| （復元後） | 122 passing |

### 3. provider 本体の駆動（純粋関数だけでは足りない）

純粋関数（`buildDdsOutline` / `buildCmdOutline`）のテストは、**provider や登録が壊れていても通る**。
そこで `provideDocumentSymbols` を「VSCode が呼ぶのと同じ形」（偽の `TextDocument` を渡す）で
実際に駆動し、返り値が本物の `vscode.DocumentSymbol` インスタンスであることまで確認した。

`CUSTMST.pf`:

```
CUSTREC  <Struct>  L2-8
  CUSTNO  [5S 0]  <Field>  L3-3
  CUSTNM  [30A]  <Field>  L4-4
  CUSTKN  [30O]  <Field>  L5-5
  CUSTAM  [9S 2]  <Field>  L6-6
  UPDDAT  [8S 0]  <Field>  L7-7
  CUSTNO  <Key>  L8-8
```

`CUSTLF1.lf`（キーと選択が種別で区別されている）:

```
CUSTREC  <Struct>  L2-7
  CUSTNO / CUSTNM / CUSTAM  <Field>
  CUSTNM  <Key>  L6-6
  CUSTAM  <Property>  L7-7
```

`CUSTMNT.dspf`（定数行はシンボルにならず、参照フィールドの属性が detail に出る）:

```
HEADER  <Struct>  L6-9
DETAIL  <Struct>  L10-14
  CUSTNO  [R B 5 20]  <Field>
  MSGTXT  [50A O 23 2]  <Field>
```

`ADDCUST.cmd`（グループ解決と継続行）:

```
ADDCUST  [顧客の追加]  <Module>  L2-14
  CUST  [Q1 顧客ファイル]  <Field>
    *NAME  [10]  <Property>
    *NAME  [10 ライブラリー]  <Property>   ← 継続行(L5-6)の PROMPT を拾えている
  NAME  [*CHAR 顧客名]  <Field>
  RANGE  [E1 番号の範囲]  <Field>
    *DEC  [5 0 開始]  <Variable>
    *DEC  [5 0 終了]  <Variable>
  REPLACE  [*CHAR 置換]  <Field>  L11-12
  DEP  [REPLACE]  <Event>          ← PARM の子ではなくルート直下
```

**この駆動で欠陥を 1 件見つけた**: レコード様式の range が末尾の空行まで伸びていた
（`CUSTNO <Key> L8-9` だがファイルは 8 行）。空行を取り込まないよう修正済み
（`ddsSymbols.ts` の「空行は誰にも属さない」分岐）。ユニットテストだけでは
気付けなかった種類の粗さ。

### 4. 既存検証（`npm run verify`）

全 12 検証 OK。特に:

- `verify-contributes.mjs` … **対象拡張子 13 件のまま**（`TARGET_EXTENSIONS` を合成に
  変えても値が変わっていない証拠）
- `verify-dds-prompter.mjs` … 桁がルーラーの桁定義と一致（`ddsLayout` への切り出しで
  桁が動いていないこと）
- CL / RPG の往復検証 … 影響なし

なお `TARGET_EXTENSIONS` を合成に変えたことで `verify-contributes.mjs` の正規表現が
空集合を拾うようになるため、**合成元を読む形に更新**した（合成元の足し忘れも検出する）。

### 5. `npm run compile`

エラーなし。

## 受け入れ基準の判定

| requirement の完了条件 | 判定 | 根拠 |
|---|---|---|
| DDS でレコード様式→フィールド→キーの階層が出る | **満たす** | 上記 3 の実出力。PF/LF/DSPF/PRTF の4種で確認 |
| `.cmd` で CMD→PARM→ELEM/QUAL の階層が出る | **満たす** | 上記 3 の実出力 |
| シンボル選択で該当行へジャンプ | **満たす** | `selectionRange` を名前の位置に置き、全ノードで `selectionRange ⊆ range` を検査 |
| 拡張子集合の一致を機械検査 | **満たす** | `contributesSideEffects.test.ts` ＋ `outlineRegistration.test.ts`（実登録の検査） |
| RPG・CL を提供しない | **満たす** | selector に RPG/CL 拡張子が無いことをテストで固定 |
| 空・不完全ファイルで例外を投げない | **満たす** | 異常系 13 ケース |
| `npm test` が通る | **満たす** | 122 passing |

## 未解決 / 申し送り

- **`.dds` は DDS キーワード補完では依然として効かない**。`resolveDdsType` が `.dds` を
  PF/DSPF/PRTF のどれか判別できないため（拡張子に情報が無い）。selector に `.dds` が
  入ったのは前進だが補完が出るようになったわけではない。**アウトラインは `.dds` でも動く**
  （構造が種別共通で種別判定を要さない）。これは本作業のスコープ外の既存の限界であり、
  PR で過大に主張しないこと。
- **拡張機能ホストでの目視確認はしていない**（この環境で VSCode を起動できないため）。
  provider を実際の呼び出し形で駆動するところまでは確認済み。

---

## 最終状態（レビュー3ラウンド後）

- `npm test` … **154 passing / 0 failing**（着手前 72）
- `npm run verify` … **12/12 OK**
- `npm run compile` … エラーなし
- provider 実駆動 … **包含違反 0 件・兄弟重なり 0 件**、`ADDCUST.cmd` の階層は維持

### 既知の限界（PR で正確に伝えるべきこと）

1. **`.dds` は DDS キーワード補完では効かない**。`resolveDdsType` が `.dds` から
   PF/DSPF/PRTF を判別できないため。**アウトラインは `.dds` でも出る**（種別判定が不要）。
2. **glob は小文字のみ**。実機由来の `CUSTMST.PF` には一致しない。これは PJ 全体の課題で、
   F4 キーバインド（`resourceExtname == .pf`）と `ruler.ts` の glob も小文字固定。
   一度アウトラインだけ大文字対応して**食い違いを作ったので取り下げた**。follow-up。
3. **`.cmd` で入れ子にするのは参照元の直後にあるグループだけ**。離れたグループは
   ルート直下に出る。`CHGPRTF USRDFNOBJ` 型（修飾名が要素リスト全体の後ろ）は
   入れ子にならない。包含と非重複を両立させるための判断で、緩めると兄弟を飲み込む
   （2 回試して 2 回とも壊した）。
4. **拡張機能ホストでの目視確認はしていない**（この環境で VSCode を起動できない）。
   provider を実際の呼び出し形で駆動するところまでは確認済み。

### レビューの経緯（自動ループは上限に到達）

3 ラウンドすべてで欠陥が見つかり、**うち 2 ラウンドは自分の前回の修正が原因**だった。
`maxSendBacks`（3）に到達したため、protocol の安全弁に従いこれ以上ループせず
人手のレビューに委ねる。
