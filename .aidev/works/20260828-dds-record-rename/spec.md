# 仕様: 様式の改名と参照追随

## 設計方針

### 1. `renameRecord` は**別の編集の種類**にする

`setAttributes` を広げる形は採らない。あちらは長さ・型・用途・定数の文字列を
受け取れるが、**様式にはどれも無い**——受け取れる形にすると
「様式に長さを送ったらどうなるか」を考え続けることになる
（`EditableDdsType` に `DDS-PF` を入れないのと同じ理由）。
追う参照も別（項目は `&名前` / `CSRLOC`、様式は `SFLCTL` / `ERASE` …）。

### 2. 追随の**当て方**は項目と共有する

`renameReferenceResults` は物理行ごとにキーワード欄を差し替える。
**差し替える関数だけを引数で受け取る**（`renameFieldReferences` /
`renameRecordReferences`）。当て方を写すと、片方だけ直したときに食い違う。

### 3. 表は**根拠を書き分ける**

`RECORD_ARGUMENTS` の各行に原典の引用を置き、**実機で確かめたか原典だけか**を
`origin` に明記する（`research.md` F2-F4）。

## 対象範囲

- `src/core/dds/ddsReferences.ts`
- `src/core/dds/ddsEdit.ts`
- `src/dds/webview/protocol.ts` / `ui.ts`

## インターフェース / データ構造

```ts
| { readonly kind: "renameRecord"; readonly sourceLine: number; readonly name: string }

export function findRecordReferences(keywords: string): readonly DdsNameReference[];
export function renameRecordReferences(keywords: string, from: string, to: string): string;
```

新しい拒否コード:

| コード | いつ |
|---|---|
| `record-line-not-found` | 指定した行に様式が無い |
| `record-needs-name` | 名前が空 |
| `record-name-duplicate` | その名前の様式が既にある（実機が通さない） |

長さの上限は既存の `name-too-long`（10 桁。項目と同じで、実機の判定も同じ）。

## 振る舞いの詳細

| キーワード | 引数 | 条件 | 根拠 |
|---|---|---|---|
| `SFLCTL` | 1 つ目 | — | 実機で確認 |
| `PASSRCD` | 1 つ目 | — | 実機で確認 |
| `ERASE` | **全部** | — | 実機で確認 |
| `HLPRCD` | 1 つ目 | **引数が 1 つのときだけ** | 実機で両形が通る／条件は原典 |
| `MNUBARDSP` | 1 つ目 | `&` で始まらないこと | **原典のみ** |
| `MNUBARCHC` | 2 つ目 | — | **原典のみ** |

- 名前は**大文字にそろえて**書く（既存の書き戻しと同じ）。
- 自分と同じ名前への改名は拒否しない（何も起きない）。

## エラー処理 / 異常系

- 拒否があれば**何も適用しない**（既存の方針）。理由はプロパティ内に出す。

## 受け入れ基準との対応

- AC1: `renameRecord` の適用（名前欄の書き換え）＋ `recordNameInput`。
- AC2: `renameRecordReferences`。
- AC3: 表が別なので項目の参照には当たらない。単体で固定する。
- AC4: `record-name-duplicate`。
- AC5: `record-needs-name` / `name-too-long`。
- AC6: `verify/verify-record-rename-compiles.mjs`（対照つき）。
- AC-I1: `attributeInput` と同じ約束で書く。
- AC-I2: `dds-reject` に出す。
- AC-I3: 断り書きに追随するキーワードを並べる。
