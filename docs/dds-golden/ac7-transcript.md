# AC7 の実行記録（2026-08-26）

> **AC7**: AI エージェントが **CLI のみ**を使って、要求文から新規 DSPF を 1 本作成し、
> `validate` を通過させ、実機表示がゴールデンと一致するところまで到達できる。

被験者は AI エージェント（Claude）。**CLI 以外の手段でファイルを編集していない。**

この記録の価値は「成功した」ことではなく、**どこで詰まったか**にある。
詰まりはエージェントの能力の問題ではなく **CLI 表面の穴**であり、
取り繕って手で補うと AC7 が検証している当のもの（表面の完全性）が測れなくなる。

## 要求文

> 部門マスタの照会画面を作る。1 行 2 桁にタイトル『部門マスタ照会』。
> 3 行 2 桁に『部門コード』、その右にコード入力欄（3 桁数値）。
> 5 行 2 桁に『部門名』、その右に名称表示欄（20 桁英数字）。23 行 2 桁に『F3=終了』。

## 実行した手順

```sh
# 1. 新規作成
dds init DEPTINQ.dspf --record DEPTINQ

# 2. 定数とフィールドを足す（--ops に JSON）
dds patch DEPTINQ.dspf --ops ops.json --write

# 3. 検証
dds validate DEPTINQ.dspf     # → 0

# 4. 描画
dds render DEPTINQ.dspf --record DEPTINQ
```

`ops.json`（抜粋）:

```json
[
  {"op":"addItem","record":"DEPTINQ","item":{"kind":"constant","text":"部門マスタ照会","line":1,"pos":2}},
  {"op":"addItem","record":"DEPTINQ","item":{"kind":"field","name":"DEPTCD","length":3,
    "dataType":"S","decimals":0,"usage":"B","line":3,"pos":15}}
]
```

## 詰まった箇所（＝CLI 表面の穴）

### 穴 1: 新規ファイルを作る手段が無かった

`PatchOp` は 4 種すべてアイテム単位で、`addItem` は**既存のレコード様式を要求する**。
**空の状態から DSPF を作れなかった。**

- 対応: CLI に `init` を足した。**編集操作ではなく足場作り**なので `PatchOp` は 4 種のまま。
- **AC4（CLI が GUI と同等）の対象外**である旨をヘルプと成果物に明記した。

### 穴 2: 数値フィールドに小数桁を指定できず、実機のコンパイルが落ちた

1 回目の試行で `validate` は通ったが、**実機の `CRTDSPF` が `CPD7408` で落ちた**。

```
     A            DEPTCD         3S  B  3 15
*                                  CPD7408-*
    Entry for decimal positions or field length not valid.
```

原因は `NewItem` に **`decimals` が無かった**こと。36-37 桁が空白のままだった。

**さらに悪いのは `validate` が「問題は見つかりませんでした」と答えたこと**——
実機が拒否する DDS を通した＝**偽の緑**。

- 対応 1: `NewItem` に `decimals` を足した。
- 対応 2: `validate` に `DDS7108`（数値キーボードシフトなのに小数桁が空白＝エラー）を足した。

### 穴 3: データ型の解釈が誤っていた（原典と実機で確定）

穴 2 を直す過程で、**35 桁目を「データ型」として扱っていた**のが誤りだと分かった。

取得した原典（`docs/origin/dds/DDS-DSPF.pdf`）:

> If you make a valid entry in positions 36 and 37, the data type is zoned decimal and
> the keyboard shift attribute is signed numeric (S)
>
> If you leave position 35 blank, the entry in positions 36 and 37 determines the data type

実機の `CRTDSPF` で網羅確認した結果（"Expanded Source" が compiler の正規化を見せる）:

| 35 桁 | 36-37 桁 | 結果 | 展開後 |
|---|---|---|---|
| `S` | 空白 | **CPD7408 エラー** | — |
| `S` | `0` | OK | `5S 0` |
| `Y` | 空白 | **CPD7408 エラー** | — |
| `Y` | `0` | OK | `5Y 0` |
| `A` | 空白 | OK | `5A` |
| **空白** | `0` | OK | **`5S 0`** に展開 |
| **空白** | 空白 | OK | **`5A`** に展開 |

- 対応: 実効データ型を求める `effectiveDataType` を入れ、**描画の型判定を 35 桁だけに依存させない**ようにした。

### 穴 4: 符号付き数値フィールドの占有桁が 1 桁足りなかった

実機で画面を出したとき、フィールド情報が `(3,15) len=4 ... signedNumeric: true` を返した。
**長さ 3 のフィールドが画面上は 4 桁を占めていた**（符号位置）。

実機で規則を確定（隣接配置を投げて `CPD7866` の有無で判定）:

| 35 桁 | 使用 | 追加桁 |
|---|---|---|
| `S` | `B` / `I`（入力を伴う） | **+1** |
| `S` | `O`（出力のみ） | 0 |
| `Y` | `B` / `O` | 0 |
| `A` | `B` | 0 |

符号を**入力する場所**が要るため、`S` かつ入力可のときだけ末尾に 1 桁増える。

- 対応: 占有幅（`itemWidth`）と見える内容の幅（`itemContentWidth`）を分けた。
  **描画は後者を使う**ので、実機との一致は保たれる（符号位置は画面上では空白）。

### 副次的に見つかったこと

新しい検証規則（`DDS7108`）が、**テストのフィクスチャ自体が不正だった**ことを検出した
（`EMPNO 6S B` に小数桁が無く、実機ならコンパイルできない DDS だった）。修正済み。

## 最終結果

```
dds init    → 0
dds patch   → 0
dds validate → 0（問題なし）
CRTDSPF     → CPC7301 File AIDVAC7 created
実機で表示 → get_screen でキャプチャ
diff rendered.screen.txt actual.screen.txt → 差分なし
```

**`dds render` の出力と実機のキャプチャが完全一致。AC7 成立。**

生成された DDS:

```
     A                                      DSPSIZ(24 80 *DS3)
     A          R DEPTINQ
     A                                  1  2'部門マスタ照会'
     A                                  3  2'部門コード'
     A            DEPTCD         3S 0B  3 15
     A                                  5  2'部門名'
     A            DEPTNM        20A  O  5 11
     A                                 23  2'F3=終了'
```

## この試行から言えること

**AC7 は設計どおり機能した。** 1 回目で通っていたら、上の 4 つの穴はどれも見つかっていない。
人間が GUI で操作していたら、`decimals` は入力欄があるので埋めただろうし、
符号位置は目で見て気づいただろう。**エージェントに CLI だけで作らせたからこそ、
API とモデルの欠落として現れた。**

**実機に投げるまで気づけなかった**点も重要。`validate` が緑でも実機が拒否した。
コアの検証は実機の部分集合でしかなく、**実機との突き合わせを省くと偽の緑が残る**。
