# レビュー記録

## ラウンド 1（2026-07-20）

差分を requirement / spec / AGENTS.md の観点で点検した。
疑わしい箇所は**実際にコードを読んで**確かめた（既存規則との比較を含む）。

**判定: should 1 件 / nit 2 件 → coding へ差し戻し**

---

### [should] `severity` が 2 か所に書かれ、食い違っても誰も気付かない

`rules/index.ts` の各レイアウト規則で、`severity` が**同じ行の近くに 2 回**書かれている。

```ts
{
  id: "layout-overflow",
  rule: layoutRule("overflow", "layout-overflow", "warning"),  // ← ここと
  enabledByDefault: false,
  severity: "warning",                                          // ← ここ
}
```

前者は `LintFinding.severity`（実際に出る指摘の重大度）、
後者は `RuleSpec.severity`（SARIF の `defaultConfiguration.level` の元）になる。
**両者は別経路で使われるため、片方だけ変えても型は通り、テストも落ちない。**

`sarif.ts:45-51` は `RULE_SPECS` の `severity` を、
`sarif.ts:56` は `finding.severity` を使う。食い違えば
「規則の既定は warning と宣言しているのに、結果は error で出る」状態になる。

AGENTS.md「**同じ概念集合を複数箇所で列挙しない**（列挙の同期漏れ）」に該当する。

**なお既存 5 規則も同じ構造**（`lineLength.ts:25` が `severity: "error"` を持ち、
`RULE_SPECS` にも `severity: "error"` がある）なので、これは**この作業が持ち込んだ
欠陥ではない**。ただし今回 6 件増やして**重複を 5 → 11 に倍増させた**ので、
ここで手当てするのが妥当。

**対応（案）**: レイアウトの規則表を 1 か所に定義し、`RuleSpec` と `rule` の
両方をそこから導く。`severity` を書く場所を 1 つにする。

```ts
const LAYOUT_RULES = [
  { code: "invalid-position", id: "layout-invalid-position",
    severity: "error", enabledByDefault: true, description: "…" },
  …
] as const;

// RULE_SPECS はこれを map して作る（rule も severity もここから）。
```

既存 5 規則には**触れない**（振る舞い不変の原則。別途 issue 候補）。

**追加すべきテスト**: 全規則について
`RULE_SPECS.severity` と、その規則が実際に出す `LintFinding.severity` が一致すること。
レイアウト規則は実際に発火させて確かめられる。

---

### [nit] `SPAN_BY_CODE` に到達しない項目がある

`rules/layout.ts:65-72` の `SPAN_BY_CODE` に `"out-of-range"` があるが、
この診断コードには `RuleId` を割り当てていない（spec の「採らなかった診断」）。
`layoutRule` は `RuleId` を持つコードにしか作られないので、この項目は**到達しない**。

害は無いが、「対応済みに見える」ので読み手を誤らせる。
消すか、コメントで「将来 `RuleId` を足すとき用」と明示するのが良い。

---

### [nit] モジュール変数のキャッシュが `lint` core に状態を持ち込む

`rules/layout.ts:38-40` の `cachedLines` / `cachedType` / `cachedResult` は
モジュール変数で、**呼び出しをまたいで残る**。

正しさに問題は無い（`lintFile` は 1 ファイルを同期的に処理し切り、
キーは `lines` 配列の同一性で、内容の変化を取り違える経路が無い）。
また保持するのは直前 1 件だけなのでメモリも問題にならない。

ただし `lint` core は「vscode にも実機にも依存しない」純粋な層として設計されており
（`types.ts` の冒頭コメント）、そこに可変の状態が入るのは設計の一貫性を欠く。

**代替案**: `FileRuleContext` に解決済みレイアウトを載せ、`engine.ts` が
1 度だけ解決して渡す。ただし `engine.ts` が DDS の知識を持つことになるので、
どちらが良いかは判断が要る。**現状のままでも可**とし、意図をコメントに残せば十分。

---

### 指摘に至らなかった確認事項（記録）

点検して**問題なし**と判断したもの。

- **種別の振り分け**（R1）。`ddsType` で弾いており、`.pf` / `.lf` / `.dds` で
  0 件になることをテストが固定している。**振り分けを外すと 3 件落ちる**ことも確認済み。
- **桁の直書きなし**（R6）。`DDS_COLUMNS.position` / `DDS_KEYWORD_AREA_START` から導出。
  grep でコメント以外に数値が無いことを確認。
- **純粋性**（R5）。`verify-lint-core.mjs` 通過。`src/lint` → `src/core` の import のみ。
- **既存規則の実装に触れていない**（R4）。`kind: "line"` を定義に足しただけ。
  判別子の追加で `engine.ts` が型エラーになり、**型が配線漏れを先に捕まえた**のは良い挙動。
- **既定 ON の 4 件はすべて原典の裏がある**。`types.ts` に引用つきで記録されている。
- **到達性**。`package.json` への露出をテストが機械で突き合わせており、
  エディタ経路（`lintDocument`）まで届くことも test 工程で追加確認した。
- **CLI の実行結果**。SARIF に 11 規則すべてが出て、OFF は `level: "none"`。
  実サンプルで 0 件・`exit=0`、壊したソースで 2 件・`exit=1`。
- **`decisions.md` D1・D2** は妥当。特に D1 は「テストが意図した変更を検出したのは
  正しい振る舞い」として値を更新しており、緩めていない。

---

## ラウンド 2（2026-07-20）

ラウンド 1 の should 1 件 / nit 2 件に対応し、再点検した。

**判定: 指摘なし → deliver へ**

### 対応内容

**[should] `severity` の二重定義** → 解消済み

`rules/index.ts` に `LAYOUT_RULES` の表を置き、`RULE_SPECS` をそこから導くようにした。
**`severity` を書く場所が 1 か所になり、`RuleSpec.severity` と `LintFinding.severity` に
同じ値が配られる**ので、構造的に食い違えない。

`as const satisfies` で表の型（`id: RuleId` / `severity: Severity`）を縛っており、
`RuleId` に無い ID を書けば型エラーになる。

既存 5 規則には**触れていない**（振る舞い不変の原則）。同じ重複は残るので、
retro の issue 候補に回す。

**[nit] 到達しない `SPAN_BY_CODE` の項目** → 削除済み

`"out-of-range"` を消し、「ここに載せるのは `RuleId` を持つ診断コードだけ」
という意図をコメントに書いた。

**[nit] モジュール変数のキャッシュ** → 現状のまま（ラウンド 1 の判断どおり）

正しさに問題は無く、保持は直前 1 件のみ。意図はコード内のコメントに記載済み。

### 追加したテスト

**宣言した severity と実際に出る severity の一致**を全レイアウト規則で縛る（6 件）。

**このテストは書いた時点では通る**（当時すでに値が一致していたため）。
そこで **`layout-overflow` の severity を片方だけ `error` に変えて落ちることを確認**した:

```
AssertionError: layout-overflow: 宣言（warning）と実際（error）が食い違う
→ 416 passing / 1 failing
```

「落ちることの確認は期待値の正しさを保証しない」（AGENTS.md）とは別に、
**そもそもテストが検出力を持つか**をこの手順で確かめている。

### 検証結果

- `npm test`: **417 passing / 0 failing**（ラウンド 1 時点 411 → +6）
- `npm run compile`: 通過
- `npm run verify:defs`: 10 項目通過
- CLI の実行結果はラウンド 1 から変わらず（実サンプル 0 件 / 壊したソース 2 件・exit=1）

### 残る既知の制約（deliver に引き継ぐ）

- **VS Code 実機での目視が未実施**。ただし殻（`lintDiagnostics.ts` / `cli/lint.ts`）は
  変更しておらず、`lintDocument` の戻り値まで検証済み。
- **`.mnudds` の実物サンプルが無い**（issue 候補 5 と重複）。
- **母数が 2 ファイル**。既定 ON の判断は実測ではなく原典に基づく（spec の方針 1）。
- **既存 5 規則にも `severity` の重複が残る**。今回は触れないと決めた（retro へ）。
