# 仕様: 画面サイズ条件名を編集する

## 設計方針

**同じ入力欄で受ける。** 条件付け欄は 1 つなので、入力欄も 1 つが素直。
短い形の先頭が `*` なら画面サイズ条件名、そうでなければ標識と読む。

**編集の型は増やさない。** `setCondition` / `setKeywordCondition` に
`screenSize?: string` を足す。`condition`（標識）とは**同時に指定できない**ことを
検証で弾く——AND でも OR でもないので、型で混ぜられる形にしても意味が無い。

`setAttributes` が任意の欄を並べて検証で弾いているのと同じ形にそろえる。

## 対象範囲

- `src/core/dds/ddsConditionWriteBack.ts` — `formatScreenSizeArea` /
  `writeBackScreenSizeCondition` / `parseConditionText` の分岐
- `src/core/dds/ddsEdit.ts` — `screenSize` と検証・適用
- `src/dds/webview/protocol.ts` / `ui.ts` — 受け渡しと入力欄

## インターフェース / データ構造

```ts
| { kind: "setCondition"; sourceLine: number; condition: ConditionGroups; screenSize?: string }
| { kind: "setKeywordCondition"; sourceLine: number; condition: ConditionGroups; screenSize?: string }
```

新しい拒否コード `screen-size-name-invalid`（形が違う／標識と混ざっている）。

## 振る舞いの詳細

### 桁

**7 桁目はブランクで、名前は 8 桁目から。** `readConditioning` が
「8 桁目から `*` で始まる」で読んでいるのと対になる。**1 行だけ**（AND も OR もしない）。

### 形

原典:
> 定義する画面サイズ条件名は、**2 - 8 文字**でなければならず、
> また、**最初の文字はアスタリスク (*)** でなければなりません。

判定は `isScreenSizeConditionName` に委ねる（読む側と同じ関数）。

### 短い形

先頭が `*` なら画面サイズ条件名。**標識と混ぜて書けない**ので、
`parseConditionText` は `groups: []` と `screenSize` を返す。

## ドメイン固有の考慮

`*DS4` を 24x80 だけの DSPF に書くと、その項目は**キャンバスから消える**
（`resolveDspfLayout` が 1 次画面サイズに合うものだけ描く）。これは正しい振る舞いで、
2 次画面サイズ用の項目は 1 次画面には出ない。

## エラー処理 / 異常系

- 短い形が読めなければ**送らない**（理由をステータスに出す）。
- 断られたらソースは変わらない。

## 受け入れ基準との対応

- AC1: `formatScreenSizeArea` / `writeBackScreenSizeCondition`
- AC2: `readConditioning` で読み戻す往復のテスト
- AC3/AC4: `validateConditionShape` の `screen-size-name-invalid`
- AC5: 標識・空への切り替えのテスト（元のソースと一致）
- AC6: `setKeywordCondition` にも同じ引数
