# 仕様: レイアウト診断を lint / エディタ診断に届ける

外部チケット: #105

## 概要

`dspfLayout` / `prtfLayout` が既に出しているレイアウト診断を、
**`lint` エンジン経由でエディタ診断と `lint` CLI に届ける**。

診断のロジックは**一切変えない**。届いていないだけなので、届ける経路を作る。

## 設計方針

### 方針 1: 既定 ON の根拠を「実測 0 件」から「原典判断」に切り替える

requirement は「実機コンパイル確認済みのサンプルに当てて偽陽性 0 のものだけ既定 ON」と
書いたが、research で**この基準が成り立たない**ことが分かった（F1・F4）。

- 母数が `CUSTMNT.dspf` / `CUSTRPT.prtf` の **2 本しかない**
- **原典上、有効なソースでも出る診断がある**（性質の問題なので母数を増やしても解決しない）

そこで判断基準を次に置き換える。

> **既定 ON にするのは、「実機で作成できないソースでしか出ない」と
> 原典で言い切れる診断だけ**。実測 0 件は**必要条件であって十分条件ではない**。

既存の `required-field` / `restricted-value` が「材料が不足しているから既定 OFF」と
判断されているのと同じ精神で、**判断できないものは OFF に倒す**。

### 方針 2: `relative-position-unresolved` は lint に流さない

原典（`DSPSIZ` 例 4）が認める正式な書き方（`+n` の「プラス機能」）であり、
**ソースの誤りではない**。この診断は「本 PJ が解決しない」という実装都合の通知なので、
lint に出すと確実に誤報になる。**プレビューの注記に留める**（現状のまま）。

### 方針 3: 診断は 1 か所のまま。lint は「読んで写す」だけ

`dspfLayout` / `prtfLayout` は**変更しない**。lint 側は解決結果の
`diagnostics` を `LintFinding` に写すだけにする。同じ計算を 2 つ持たない。

### 方針 4: ファイル単位の規則を足す（既存の行単位規則は触らない）

`lintFile` は既にファイル単位で、行ごとの `forEach` は内部の都合（research F3）。
`Rule`（行単位）の型は**変えず**、`FileRule`（ファイル単位）を並立させる。

## 対象範囲

### 変更するファイル

| ファイル | 変更 |
|---|---|
| `src/lint/types.ts` | `RuleId` に 6 件追加、`FileRule` / `FileRuleContext` を追加 |
| `src/lint/rules/layout.ts` | **新規**。レイアウト解決の結果を `LintFinding` に写す |
| `src/lint/rules/index.ts` | `RULE_SPECS` に 6 件追加（`kind` で行/ファイルを判別） |
| `src/lint/engine.ts` | ファイル単位の規則を 1 度だけ回す口を足す |
| `package.json` | `rpgClSupport.lint.rules` の `properties` に 6 件追記 |
| `test/unit/lintLayout.test.ts` | **新規** |

### 変更しないファイル

- `src/core/dds/dspfLayout.ts` / `prtfLayout.ts`（診断のロジック）
- `src/language/lintDiagnostics.ts`（エディタの殻）— `lintFile` の戻り値を写すだけなので変更不要
- `src/cli/lint.ts`（CLI）— 同上
- 既存 5 規則の実装

## インターフェース / データ構造

### `RuleId` の粒度

**診断コードごとに 1 規則**とする。理由: 既定 ON/OFF が診断ごとに違う（方針 1）ため、
まとめると細かい制御ができない。

PRTF と DSPF で同名の診断（`overlap` / `overflow` / `invalid-position`）は
**種別が違えば同時に発火しない**ので **1 つの ID にまとめる**。既定も一致させられる。

```ts
export type RuleId =
  | "line-length" | "numeric-field" | "numeric-alignment"
  | "required-field" | "restricted-value"
  // --- レイアウト（ここから追加）---
  /** 既定 ON（error）。位置欄が数字でない。実機で作成できない。 */
  | "layout-invalid-position"
  /** 既定 ON（error）。1 桁目に項目を置いた。原典: 最初の桁は属性文字の予約。 */
  | "layout-column-one-reserved"
  /** 既定 ON（error）。DSPSIZ の書式・値が不正。実機で作成できない。 */
  | "layout-invalid-screen-size"
  /** 既定 ON（error）。行番号のある様式で SPACE/SKIP。実機で CPD7860。 */
  | "layout-spacing-with-line-number"
  /** 既定 OFF（warning）。画面／紙面をはみ出す。原典: *NOLOC で作成はされる。 */
  | "layout-overflow"
  /** 既定 OFF（warning）。項目の重なり。原典: 重複の定義は合法。 */
  | "layout-overlap";
```

**採らなかった診断コード**（`RuleId` を割り当てない）:

| 診断コード | 理由 |
|---|---|
| `relative-position-unresolved`（DSPF） | 原典が認める書き方。実装都合の通知（方針 2） |
| `missing-position`（DSPF） | 位置欄が空。除外（潜在/メッセージ/プログラム間）の漏れが**母数 2 では検証できない**。振り分けを誤ると全フィールドで出る（research F2 の実測 15 件）。**初版では出さない** |
| `possible-overprint`（PRTF） | 原典は 2 重印刷になり得ると述べるがエラーではない。ノイズが多い見込み |
| `spacing-with-conflicting-keyword`（PRTF） | 原典は「SPACE/SKIP は**無効**」と述べるだけで作成はされる。警告として有用だが母数不足 |
| `out-of-range`（PRTF） | 行・桁が 255 超。`invalid-position` と重なる領域で、母数 2 では区別を検証できない |

**採らなかったものは将来足せる**。`RuleId` を増やすだけで枠組みは変わらない。
初版で絞るのは「**出すべきものを隠すより、誤報で信用を失う方が高くつく**」ため
（既存 `required-field` / `restricted-value` が OFF に倒されているのと同じ判断）。

### ファイル単位の規則

```ts
/** ファイル全体を見る規則の文脈。行単位の Rule とは別立て。 */
export interface FileRuleContext {
  readonly fsPath: string;
  readonly lines: readonly string[];
  /** DDS の種別。レイアウト規則はこれで振り分ける。 */
  readonly ddsType: DdsType | undefined;
}

export type FileRule = (context: FileRuleContext) => readonly LintFinding[];
```

`RuleSpec` に判別子を足す（既存 5 件は `kind: "line"`）。

```ts
export type RuleSpec =
  | { kind: "line"; id: RuleId; rule: Rule; positional: boolean; /* …共通欄 */ }
  | { kind: "file"; id: RuleId; rule: FileRule; /* …共通欄 */ };
```

`positional` は行単位にしか意味が無いので、ファイル単位側には持たせない。

### `engine.ts` の変更

```ts
export function lintFile(request: LintRequest): readonly LintFinding[] {
  // …既存の kind 解決・enabled 解決はそのまま…

  const findings: LintFinding[] = [];

  // ファイル単位の規則を 1 度だけ回す（行の走査より前）。
  for (const spec of enabled) {
    if (spec.kind !== "file") continue;
    findings.push(...spec.rule({ fsPath: request.fsPath, lines: request.lines, ddsType: kind.ddsType }));
  }

  request.lines.forEach((line, index) => { /* …既存のまま（kind: "line" だけ回す）… */ });

  findings.sort((a, b) => a.line - b.line || a.startColumn - b.startColumn);
  return findings;
}
```

並べ替えが最後にあるので、**ファイル単位の規則を先に回しても出力順は変わらない**。

## 振る舞いの詳細

### 1. 種別による振り分け（必須）

`layout` 規則は `ddsType` を見て呼び分ける。

| `ddsType` | 呼ぶもの |
|---|---|
| `DDS-DSPF` | `resolveDspfLayout(lines)` |
| `DDS-PRTF` | `resolvePrtfLayout(lines)` |
| `DDS-PF` / `undefined` | **何もしない**（指摘 0 件） |

**PF/LF に DSPF リゾルバを当てると全フィールドに `missing-position` が出る**
（research F2 の実測: 15 件）。振り分けは仕様であって最適化ではない。

`lintFile` は `kind.language !== "dds"` を既に弾いている（`engine.ts:31`）ので、
RPG ソースには最初から回らない。

### 2. レイアウト解決は 1 ファイルにつき 1 回

6 つの規則が個別に `resolveDspfLayout` を呼ぶと、同じ解決を 6 回行うことになる。
**規則の実体は 1 つ**にし、`RuleSpec` 側で診断コードを絞る形にする。

```
layoutRule(code)  →  FileRule
  ・ddsType で振り分けて解決
  ・解決結果を（ファイル単位で）memo する
  ・自分が担当する code の診断だけを LintFinding に写す
```

memo は `WeakMap` ではなく **`lines` 配列の同一性で判定する単純なキャッシュ 1 件**で足りる
（`lintFile` は 1 ファイルを同期的に処理し切るため）。

### 3. 診断コード → `LintFinding` の写し方

```
line        = diagnostic.sourceLine
message     = diagnostic.message（既存の日本語をそのまま使う）
ruleId      = 対応する RuleId
severity    = RuleSpec の severity
startColumn / endColumn = 下表
```

**桁の割り当て**（research F5）:

| 診断 | 指す範囲 | 理由 |
|---|---|---|
| `invalid-position` / `column-one-reserved` / `overflow` / `overlap` | **位置欄 39-44 桁** | 誤りは位置欄にあり、そこを直せば解決する |
| `invalid-screen-size` | **キーワード欄 45 桁〜行末** | `DSPSIZ` の記述を指す |
| `spacing-with-line-number` | **位置欄 39-44 桁** | 行番号を消すのが対処 |

桁は `DDS_COLUMNS.position` / `DDS_KEYWORD_AREA_START` から導出し、**数値を直書きしない**。
行が短くて欄が無い場合は `startColumn = 1` / `endColumn = 行長 + 1`（行全体）に落とす。

### 4. 既定 ON / OFF の根拠

| RuleId | 既定 | severity | 原典・実機の根拠 |
|---|---|---|---|
| `layout-invalid-position` | **ON** | error | 位置欄が数字でないソースは実機で作成できない |
| `layout-column-one-reserved` | **ON** | error | 原典「フィールドは、表示画面の最初の桁を占めることはできません。最初の桁は属性文字のために予約されています」 |
| `layout-invalid-screen-size` | **ON** | error | `DSPSIZ` の値は原典で 24×80 / 27×132 のみ。外れると作成できない |
| `layout-spacing-with-line-number` | **ON** | error | 実機で `CPD7860`（`docs/src/CHECKLIST.md` に実例） |
| `layout-overflow` | **OFF** | warning | 原典（`DSPSIZ` 例 1）「…拡張ソース印刷出力で `*NOLOC` の位置をこの 2 つのフィールドに割り当てます」＝**作成はされる** |
| `layout-overlap` | **OFF** | warning | 原典（`位置 (39 - 44 桁目)`）「フィールドを他のフィールドまたは属性文字とオーバーラップするように**定義することができます**」＝合法 |

OFF の 2 件は**理由を型のコメントに残す**（既存 `required-field` / `restricted-value` と同じ流儀）。

### 5. 重複表示について

プレビューを開いた状態で編集すると、同じ問題がプレビュー内とエディタの両方に出る。
**これは許容する**。出どころは同じ解決結果で内容が食い違うことは無く、
プレビューを閉じている利用者に届けることがこの作業の目的のため。

## ドメイン固有の考慮

### AGENTS.md 由来

- **`lint` core の純粋性を保つ**。`src/lint/rules/layout.ts` は vscode を import しない。
  `src/core/dds/*` は既に純粋性検査の対象（research F5）なので import してよい。
  `verify-lint-core.mjs` を通す。
- **同じ概念を複数箇所で列挙しない**。桁は `DDS_COLUMNS` から導出する。
  種別の振り分けは `resolveSourceKind` / `ddsType` を使い、拡張子を書かない。
- **追加したリソースは到達可能になって初めて完了**。`RuleId` を足すだけでは届かない。
  **`package.json` の `lint.rules` に載せ、エディタと CLI の両方に出ることをテストで見る**。
- **エディタと CLI で同じロジックが動く**（既存方針）。`lintFile` の 1 経路に集約する。

### 既定を増やすことの重さ

既定 ON の規則を増やすと、**既存の利用者のソースに新しい指摘が出る**。
今回 ON にする 4 件はいずれも「実機で作成できない」ものなので、
**出たなら直すべきもの**であり、ノイズにはならない。

## エラー処理 / 異常系

| 事象 | 扱い |
|---|---|
| レイアウト解決が例外を投げる | **起きない**（`resolveDspfLayout` / `resolvePrtfLayout` は例外を投げない設計）。ただし lint 全体を落とさないため、規則の実行は既存と同じく素通しにする |
| `ddsType` が `undefined`（`.dds`） | 指摘 0 件（`engine.ts:33` が既に弾いている） |
| 位置欄より短い行 | 桁は行全体に落とす（「振る舞い 3」） |
| 同じ行に複数の診断 | すべて出す（既存規則も同様） |

## テスト

**(a) 純粋関数の単位テスト** — `test/unit/lintLayout.test.ts`
- `.dspf` の 1 桁目配置で `layout-column-one-reserved` が出る
- `.prtf` の行番号＋`SPACEA` で `layout-spacing-with-line-number` が出る
- **`.pf` / `.lf` では 1 件も出ない**（research F2 の再発防止）
- 既定 OFF の規則は、明示的に有効化したときだけ出る
- 桁が位置欄（39-44）を指している
- `relative-position-unresolved` / `missing-position` は**出ない**（方針 2・採らなかった診断）

**(b) 実サンプルに対する結合テスト**
- `docs/src/` の DDS 全部（`.pf` / `.lf` / `.dspf` / `.prtf`）に**既定の規則**を当てて
  **指摘 0 件**（research F1 の実測を固定する）

**(c) 配線の到達性**
- `lintFile` の戻り値に含まれることを確認（エディタ・CLI は `lintFile` を呼ぶだけなので、
  ここが通れば両方に届く）
- `package.json` の `lint.rules` の `properties` に 6 件が載っていること

**(d) 退行なし**
- `npm test` 全体、`npm run verify:defs`（`verify-lint-core.mjs` を含む）

## 受け入れ基準との対応

| requirement の完了条件 | 満たし方 |
|---|---|
| `.dspf` の 1 桁目でエディタに指摘が出る | `layout-column-one-reserved` を既定 ON。テスト (a)(c) |
| 同じ指摘が `npm run lint` にも出る | `lintFile` の 1 経路に集約。CLI は同じ関数を呼ぶ |
| `.prtf` のレイアウト診断も出る | `ddsType` で振り分け。テスト (a) |
| 実機確認済みサンプルで既定 ON の偽陽性 0 | テスト (b) |
| 偽陽性が出た診断は既定 OFF・理由が型のコメントに | 「振る舞い 4」の表を型のコメントに落とす |
| 診断ごとに設定で ON/OFF | `RuleId` を診断ごとに分け、`package.json` に載せる |
| `verify-lint-core.mjs` が通る | `src/lint` から `src/core` の import のみ。テスト (d) |
| 既存 4 規則の挙動が変わらない | `Rule` の型・実装に触れない。テスト (d) |
| プレビューに退行がない | `dspfLayout` / `prtfLayout` を変更しない。テスト (d) |

## 初版で扱わないもの

| 項目 | 理由 |
|---|---|
| `missing-position` / `possible-overprint` / `spacing-with-conflicting-keyword` / `out-of-range` | 母数 2 では既定を判断できない。枠組みは同じなので後から `RuleId` を足せる |
| `relative-position-unresolved` | 原典が認める書き方。lint に出すべきでない（方針 2） |
| 診断そのものの精度向上（`overlap` の条件同値判定など） | requirement の対象外。別課題 |
| サンプルの追加（実機コンパイル） | retro の issue 候補 5 と重なる。別立て |
