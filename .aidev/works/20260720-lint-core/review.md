# レビュー記録

## ラウンド 1（2026-07-20）

対象: `origin/main..HEAD`（7 コミット `3148ec5..840261e`）
41 ファイル / +3998 −251。うち成果物 md 10 ファイル、実装 21 ファイル、テスト 5 ファイル。

判定: **must 1 件により coding へ差し戻す。**

---

### [must] `src/language/lintDiagnostics.ts:81-84` — 設定 `cNewOpcodes` を lint core に渡しておらず、ルーラーと分類が食い違って偽陽性が出る

`lintDocument` は `dialectOverrides` を渡しているが **`cNewOpcodes` を渡していない**。
その結果、利用者が `rpgClSupport.cNewOpcodes` にオペコードを足すと:

- ルーラー / プロンプター … `getCNewOpcodes()` 経由で設定が効き **C-NEW**
- lint … `DEFAULT_C_NEW_OPCODES` のみで **C-SPEC**

C-SPEC は `FIELDLEN`(64-68) / `DECPOS`(69-70) を `numericOnly` の欄として持つが
C-NEW は持たない。拡張演算項目 2 は原典どおり 80 桁まで伸ばせるので、
**その桁に式が伸びている正しい行が数値欄違反として指摘される**。

実証（`cNewOpcodes` に `MONITOR` を足した想定）:

```
     C                   MONITOR   TOTAL = AMOUNT + TAX + FREIGHT + X

現状の VSCode 経路: ★ numeric-field FIELDLEN(64-68) "HT +" が入っています
                    ★ numeric-field DECPOS(69-69)   "X" が入っています
設定を渡した場合  : 指摘なし
```

この作業の最上位の制約は「**偽陽性ゼロを優先する**」であり、それを設定 1 つで
破れる状態になっている。AGENTS.md「ルーラーとプロンプターで桁を食い違わせない」にも反する。

さらに **`LintOptions.cNewOpcodes` という受け口は既に用意されていて、殻が埋めていない
だけ**という形になっている。AGENTS.md が繰り返し記録している
「プロンプターは『モデルまで』では届いていない」と同じ型の見落とし。

**対応**: `lintDiagnostics.ts` で `prompter/specClassifier` の `getCNewOpcodes()` を
呼んで渡す。あわせて「設定を変えるとルーラーと lint が食い違う」ことを検出する
テストを足す（この欠陥は動かすまで分からない種類）。

---

### [should] `src/lint/engine.ts:6` — `ruleSpec` が完全な死蔵

`import { RULE_SPECS, defaultEnabledRules, ruleSpec }` の `ruleSpec` は
engine 内で使われておらず、リポジトリ全体でも定義以外の参照がこの import 行 1 つだけ。
`tsconfig` に `noUnusedLocals` が無いためコンパイルでは落ちない。

**対応**: 未使用 import を外し、`rules/index.ts` の `ruleSpec()` も利用者が現れるまで削る。

---

### [should] `src/core/dialect.ts:32` — `normalizeOverrides` を不要に export した

元の `prompter/dialect.ts` では**非 export の内部関数**だった（`git show origin/main` で確認）。
core への移設時に `export` を付けたが、外部からの参照は無い（内部の 1 箇所のみ）。

殻化は「振る舞いも公開面も変えない最小差分」であるべきで、公開面だけ広がっている。

**対応**: `export` を外す。

---

### [should] `src/lint/rules/index.ts:93` — 意味のない再エクスポート

```ts
export type { LintFinding };
```

`LintFinding` の出所は `lint/types.ts` で、この再エクスポートを経由している利用者は
いない。しかも `rules/index.ts` 内で `LintFinding` は型として使われておらず、
1 行目の import も実質未使用。出所が 2 つあるように見えて紛らわしい。

**対応**: 再エクスポートと未使用 import を削る。

---

### [nit] `src/lint/preprocess.ts:53` — 死んだ nullish 分岐

```ts
const nameType = text.charAt(16) ?? " ";
```

`String.prototype.charAt` は範囲外で `""` を返し `undefined` にはならないので、
`?? " "` は決して評価されない。直後に `.trim().length === 0` で判定しているため
挙動は正しいが、「範囲外を守っている」ように読めてしまう。

---

### [nit] `src/lint/sarif.ts:88-94` — `toUri` の baseDir 判定が境界を見ていない

```ts
if (baseDir && path.startsWith(baseDir)) {
```

`/repo` を baseDir としたとき `/repository/x.pf` にも一致して先頭を削ってしまう。
また baseDir の外にあるファイルは先頭の `/` だけ落ちて、絶対パスなのに相対パスに
見える uri になる。CLI は常に `cwd` を baseDir にするので実害は出にくいが、
区切り文字の境界を見るのが正しい。

---

### [nit] `src/cli/lint.ts:191` — `--output` の書き込み失敗を捕まえていない

読み込み側（`readFileSync`）は try/catch して exit 2 にしているのに、
書き込みは素通しで例外がそのまま出る。終了コードの規約（0/1/2）から外れる。

---

### [nit] CLI に `cNewOpcodes` を渡す口が無い

must を直しても、CLI は VSCode 設定を読めないため、`cNewOpcodes` を設定している
利用者はエディタと CI で C 仕様の分類が食い違ったままになる。
構造的な差なので本作業で塞ぐ必要は無いが、**既知の制約として記録**しておきたい
（`--c-new-opcode` を足すか、README に書くかは別途）。

---

## 良かった点（記録）

規約の遵守は確認できた。

- **桁定義を作り直していない**。規則は定義 JSON の `sourceStart` / `sourceLength` /
  `attributes` を直接読み、独自の桁表を持たない。
- **`characterSet: "upper"` を検査に使っていない**。原典由来でないことを
  `numericField.ts` の冒頭コメントに理由付きで残してある。
- **`fileScope.ts` に触れていない**。`verify-contributes.mjs` がソース解析している
  という理由が `design.md` D1 に残り、代わりに `LINTABLE_EXTENSIONS ⊆ TARGET_EXTENSIONS`
  を機械検査している。
- **落ちないテストを書いていない**。`RpgSpecContext` の 2 つの非対称、行長の適用範囲、
  純粋性検査のいずれも「戻すと落ちる」ことを実際に確認した記録がある。
- **設計の誤りが追える形で残っている**。`design.md` D6（tsconfig で純粋性を担保）は
  誤りで、`decisions.md` D1 が実測に基づいて訂正し、D6 を参照する際は D1 を優先せよと
  明記してある。
- **要件からの逸脱が明示されている**。4 検査項目のうち 2 つを初版で見送った判断が
  `spec.md`「requirement からの意図的な逸脱」に理由付きで書かれている。
- 型は `any` ゼロ。既存 4 ファイルの殻化で import パス・公開シグネチャ・挙動は
  変わっていない（`normalizeOverrides` の export だけが例外＝should 指摘）。

---

## ラウンド 2（2026-07-20）

ラウンド 1 の指摘 8 件（must 1 / should 3 / nit 4）を**すべて対応**した。

| # | 重大度 | 指摘 | 対応 |
|---|---|---|---|
| 1 | must | `cNewOpcodes` を lint core に渡しておらず偽陽性 | **修正済**。`lintDiagnostics.ts` が `getCNewOpcodes()` を渡す。回帰テスト 2 件を追加し、**戻すと落ちる**ことを確認 |
| 2 | should | `ruleSpec` が死蔵 | **修正済**。未使用 import と関数本体を削除 |
| 3 | should | `normalizeOverrides` を不要に export | **修正済**。非 export に戻した（元の実装と一致） |
| 4 | should | 意味のない `export type { LintFinding }` | **修正済**。再エクスポートと未使用 import を削除 |
| 5 | nit | `charAt(16) ?? " "` の死んだ分岐 | **修正済**。`??` を外し、範囲外が `""` である旨をコメントに |
| 6 | nit | `toUri` が baseDir の境界を見ていない | **修正済**。区切りまで見る実装に。境界と baseDir 外の 2 ケースをテスト追加 |
| 7 | nit | CLI の `--output` 書き込み失敗が終了コード規約から外れる | **修正済**。try/catch して exit 2 |
| 8 | nit | CLI に `cNewOpcodes` を渡す口が無い | **修正済**。`--c-new-opcode` を追加。使用法に「設定を使っているなら同じ値を渡す」旨を明記 |

### 再検証

| 実行したもの | 結果 |
|---|---|
| `npm test` | **144 passing / 0 failing**（ラウンド 1 時点 140） |
| `npm run verify` | **13 項目すべて ✓**（クリーンビルドから） |
| CLI の終了コード | 0 / 1 / 2（書き込み失敗・引数不足を含む）すべて期待どおり |
| CI の lint ステップ | exit 0（検証済み 6 ファイルで指摘ゼロ） |

must の修正は `cNewOpcodes: undefined` に戻すとテストが 1 件落ちることを確認済み。

判定: **指摘なし。deliver へ進める。**

### 残る既知の制約（deliver に引き継ぐ）

- 拡張機能ホストでの目視確認が未実施
- 桁を文字数で数えており、DBCS を含む行で `line-length` が過小評価になる（`spec.md` の意図的な決定）
- 偽陽性ゼロの根拠となるコーパスが 6 ファイルと小さい
- RPG III には `numericOnly` の欄が定義に無く、届くのは `line-length` だけ（定義側のギャップ。follow-up）
- `docs/src/CHECKLIST.md` の「すべてコンパイル確認済み」という記述と、表の「作成物」欄が 6 件しか
  埋まっていない実態が食い違う。lint が検出した `EMPMNT01` / `SLSENT01` の桁ずれが真陽性かは実機でしか確定できない
