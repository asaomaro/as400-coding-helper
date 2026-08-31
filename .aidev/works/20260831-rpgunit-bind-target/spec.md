# 仕様: テスト対象のバインド

## 概要

`tools/run-rpgunit.mjs` に `--bnd <lib/name>`（繰り返し可）を足し、
`RUCRTRPG` の `BNDSRVPGM` に渡す。併せて**動く実例**を `tools/example/` に置く。

## 設計方針

### 1. 対象のビルドは道具の外

テスト対象は**利用者の資産**で、そのビルド手順は PJ ごとに違う。
道具は「テストを作って回す」までに責任を持ち、**束ねる指定を受け取るだけ**にする。
実例の README で対象のビルド手順を示す（`SBMJOB` ＋ `INLLIBL` ＋ `EXPORT(*ALL)`）。

### 2. `BNDSRVPGM` の書式は原典に合わせる

`MAX(50)` のリスト、修飾は **`library/name`**（`QUAL` が 2 段）。
空白区切りにすると 2 要素として読まれるので**スラッシュを保つ**。
ライブラリーを省いた指定は `AS400_LIB` で補う。

```
--bnd CALCSRV              → BNDSRVPGM(ASAOLIB/CALCSRV)
--bnd A --bnd MYLIB/B      → BNDSRVPGM(ASAOLIB/A MYLIB/B)
（指定なし）               → BNDSRVPGM を付けない（既定 *NONE）
```

### 3. 投入の失敗を握り潰さない

`SBMJOB` の戻りを**見る**。見ないと、走らなかったものを「ビルド失敗」と報告して
**本当の理由（コマンドの書式など）が消える**。実際、`BNDSRVPGM` の書式を間違えたとき、
これが無いせいで原因が分からなかった。実行側も同じ穴を塞ぐ。

### 4. 実例は「壊すと落ちる」ところまで含める

通っている実例だけでは、**バインドが効いていなくても緑になる**（テストが自己完結なら
対象を見ていなくても通る）。README に**対象を壊して落とす手順**を載せる。

## 対象範囲

| ファイル | 変更 |
|---|---|
| `tools/run-rpgunit.mjs` | `--bnd` の解析・`BNDSRVPGM` の組み立て・`SBMJOB` の成否確認・`--self-test` 追加 |
| `tools/example/` | 新規（`CALCPR` / `CALCSRV` / `CALCTST` / `README.md`） |
| `tools/README.md` | `--bnd` の案内 |
| `.claude/skills/rpgunit-test/SKILL.md` | 実例への案内 |

## 振る舞いの詳細

- `--bnd` を省略すると `BNDSRVPGM` を付けない（従来と同一の動き）。
- 形式が不正（`a/b/c` など）なら `UsageError` で終了 2。
- 転送の表示に `bind: …` を出す（何を束ねたかが記録に残る）。

## エラー処理 / 異常系

| 事象 | 扱い |
|---|---|
| `--bnd` の形式が不正 | 終了 2（使い方を表示） |
| `SBMJOB` が投入に失敗 | 終了 2。**そのメッセージを出す**（設計方針 3） |
| バインド先が存在しない | ビルドが失敗 → 終了 2 ＋ スプール名（既存の経路） |

## 受け入れ基準との対応

| AC | 満たし方 |
|---|---|
| AC1 | `--bnd` を `BNDSRVPGM` に渡す。実例で実機確認 |
| AC2 | 正しい対象に対して `SUCCESS 2 tests, 0 failure` |
| AC3 | **対象を壊して `FAILURE 2 tests, 2 failure`**（テストは不変） |
| AC4 | `tools/example/` に 3 本 ＋ README。手順どおりに再現できる |
| AC5 | `--bnd` 省略時は `BNDSRVPGM` を付けない。既存の実例で確認 |
| AC6 | `--self-test` に 5 件追加（既定・大文字化・繰り返し・不正形式） |
