# 検証結果: lint の桁上限を設定化する

## 実行したもの

| 検証 | 結果 |
|---|---|
| `npm test`（単体・`rm -rf out out-test` 後） | **1167 passing / 0 failing / 0 pending** |
| `npm run verify:defs`（15 スクリプト） | 全て OK（`verify-lint-core` / `verify-contributes` を含む） |
| `npm run verify:roundtrip`（538 定義） | 全定義で往復 OK |
| `npm run compile` | OK |
| CLI の実地確認（素の node） | 既定・上限 80・不正値の 3 通りを確認 |

**skip / pending は 0 件**。環境不足で未検証になった surface は無い。

## 受け入れ基準

| AC | 結果 | 根拠 |
|---|---|---|
| **AC1** 上限 80 で 81-100 桁が指摘される | ✅ | 単体「上限 80 なら 81 桁で指摘し、範囲は 81 桁目から」「上限 80 なら 95 桁も指摘する」／CLI 実地で 85 桁が捕まる |
| **AC2** 上限 80 でも 80 桁以内は指摘されない | ✅ | 単体「上限 80 なら 80 桁ちょうどは指摘しない」（境界） |
| **AC3** メッセージに適用された上限が出る | ✅ | 実地出力 `固定長ソースは 80 桁までです（1-80 桁が仕様書。注記域は入りません）` |
| **AC4** CLI から同じ上限を指定でき同じ指摘になる | ✅ | 単体（CLI 5 件）＋実地。規則単体と同一メッセージであることを assert |
| **AC5** 設定しなければ 100 のまま既存が通る | ✅ | 1167 passing。**追加 17 件 / 削除 0 件**、既存の assertion は無変更（D2 参照） |
| **AC6** 実機の桁で数える | ✅ | 単体「全角を含む行は printWidth で判定する」（全角 41 文字＝84 桁・JS は 41 文字） |
| **AC7** `src/lint/` が vscode を import しない | ✅ | `verify-lint-core.mjs`：純粋性 42 ファイル OK |

## 追加テストが load-bearing であることの確認

AGENTS.md「テストを足したら、直す前の状態に戻して落ちることを確かめる」に従い、
**実装を戻して落ちることを 2 通り確かめた**。

| 戻した内容 | 落ちた件数 | 落ちたテスト |
|---|---|---|
| メッセージ後半を固定文言 `（1-80 桁が仕様書、81-100 桁が注記域）` に戻す | **3 件** | 上限 80 で注記域を案内しない／上限 90 で 81-90 桁と言う／CLI の `--max-column 80` |
| 規則を `context.maxColumn` ではなく既定を見るように戻す | **8 件** | 上記＋上限 80 の 81 桁・95 桁・全角・上限 103／エディタの `lint.maxColumn`／CLI |

後者は**規則・エディタ・CLI の 3 層すべてから検出**されており、
どの経路の配線が抜けても気付ける。

## CLI の実地出力

```
$ node out/cli/lint.js --rule line-length --format text SAMPLE.rpgle
指摘はありません                                          （既定 100・exit 0）

$ node out/cli/lint.js --rule line-length --format text --max-column 80 SAMPLE.rpgle
SAMPLE.rpgle:1:81: error: 行が 85 桁あります。固定長ソースは 80 桁までです
（1-80 桁が仕様書。注記域は入りません）。 [line-length]      （exit 1）

$ node out/cli/lint.js --max-column 0 SAMPLE.rpgle
✗ --max-column は 1〜32754 の整数です: 0                   （exit 2）
```

## 判定

**全 7 件の受け入れ基準を満たしている。差し戻しは無し。**
