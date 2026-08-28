# 調査: サンプルの桁

## 判明した事実

### F1: **真陽性だった**（サンプルの方が誤り）

実機（IBM i 7.3 / `CRTBNDRPG`）に判定させた（`verify/probe-dspec.mjs`）:

| 形 | 実機 |
|---|---|
| **原典どおり**（長さ 33-39 右寄せ / 型 40 / 小数 41-42） | 通る |
| **サンプルの形**（長さ 32 / 型 33 / 小数 35） | **通らない** |
| サンプルの実物 2 行をそのまま | **通らない** |
| 原典どおり ＋ `OVERLAY` | 通る |

### F2: 誤っているのは **DS の下位フィールドだけ**

桁ごとに読み直したところ、**独立した `S` 定義（`D RRN S 4S 0` など）は正しい**。
誤りは DS の下位フィールドで、長さが 7 桁ぶん左に寄っている。
EMPMNT01 に 7 行・SLSENT01 に 11 行。

### F3: 直したら **1 件だけ残り、それは偽陽性**だった

`EMPMNT01.rpgle:147`
`     C                   DOU       %EOF(EMPMSTR) OR RRN >= SFLSIZ`

`DOU` は**拡張演算項目 2**を採る命令なので、64-68 桁に「フィールド長」は無い。
lint が固定欄の桁（`C-SPEC`）を当てていた。

原因は `DEFAULT_C_NEW_OPCODES` が**手で並べた 10 件**で、`DOU` が抜けていたこと。
原典から生成した補完データ（`rpg-completion.json`）の `fixedForm.columns` に
**「拡張演算項目 2」**と書かれているものが **17 件**ある。

### F4: 既存のテスト 4 件が「サンプルが壊れていること」に寄りかかっていた

`lintCorpus` / `lintDiagnostics` の 4 件が `EMPMNT01.rpgle` を
「桁ずれのある材料」として使っていた。**サンプルを直した瞬間に証明が消える。**

## 影響範囲

- `docs/src/EMPMNT01.rpgle` / `SLSENT01.rpgle`（18 行）
- `docs/src/CHECKLIST.md`
- `src/core/rpgSpec.ts`（`DEFAULT_C_NEW_OPCODES`）
- `test/unit/lintCorpus.test.ts` / `lintDiagnostics.test.ts`
- `.github/workflows/prompter-definitions.yml`
