# 仕様: ルーラー表示機能

対応 issue: #2 / 前提: requirement.md, research.md

## 概要

VSCode 編集時、対象拡張子ファイルの**フォーカス（カーソル）行の上側**に、固定長フォーマットの
桁位置ルーラーをデコレーション（ソース非破壊）で表示する。表示は 2 段構成：

- **目盛り段**：桁番号の目盛り（5 桁ごと `+`、10 桁ごとに桁番号下 1 桁）。全ファイル共通。
- **境界段**：フォーカス行のスペック種別に応じたフィールド境界＋ラベル。

ステータスバーのクリックで 3 状態（`非表示 → ルーラーのみ → ルーラー＋境界 → …`）を循環させる。

## 設計方針

### 描画機構（research F1 を受けて決定）

- `vscode.window.createTextEditorDecorationType` の `before` contentText を用いる（既存 SOSI と同じ等幅描画）。
  `before` はエディタ等幅フォントで描画されるため桁整合が保てる。
- 「行の上側」表示は、`before` の擬似要素を **CSS で上方向に浮かせて**実現する。
  `DecorationRenderOptions.before` の `textDecoration` フィールドに CSS を注入する既知手法を使い、
  `position: absolute; ... ` でフォーカス行の上に配置する。
  - 視覚的に直上行へ重なるため、ルーラーには**テーマ連動の背景色**を与えて可読性を確保する
    （前面に出して直上行の文字に被さっても読めるようにする）。
  - 描画は**フォーカス行のみ**に限定し、影響範囲を最小化する。
- 不採用案（research に記録済み）：CodeLens（UI フォントで桁ズレ）、WebviewEditorInset（proposed API・配布不可）。

### 2 段の重ね方

- 2 つの DecorationType を用意する：
  - `tensDecoration`（目盛り段）：フォーカス行に対し CSS `top` をコード行の概ね 2 行上に配置。
  - `fieldsDecoration`（境界段）：同じく概ね 1 行上（コードに近い側）に配置。
- 表示モードでの出し分け：
  - `off`：両方クリア。
  - `ruler`：`tensDecoration` のみ（位置はコードの 1 行上に寄せる）。
  - `full`：`tensDecoration`（2 行上）＋`fieldsDecoration`（1 行上）。

### スペック種別の判定（research F3 のギャップを回避）

- ルーラーは `positionResolver.resolvePosition` に依存せず、**独自の種別判定**を持つ
  （`resolvePosition` は C/D/CL のみ対応のため、既存挙動を変えずに H/F/O/P まで広げる）。
- RPG 固定（`rpg-fixed`）：行 6 桁目（index 5）のスペック文字を大文字化して判定。
  `H→H-SPEC` / `F→F-SPEC` / `D→D-SPEC` / `O→O-SPEC` / `P→P-SPEC` / `C→C-SPEC または C-NEW`。
  - C の新旧判定は既存 `cNewOpcodes`（設定 `rpgClSupport.cNewOpcodes`）と同じロジックを共有する
    （7 桁目以降の先頭トークン＝オペコードが cNewOpcodes に含まれれば `C-NEW`）。
  - コメント行（6 桁目 `*`）や空行・判定不能は種別なし扱い。
- CL（`cl`）：`CL` 固定の境界（`cl-keyword-columns.json` の `[14,25]`）。
- 種別が取れない／対象外の行：**目盛り段のみ**表示（境界段は空）。

### 桁定義のロード（research F4 / 共通化）

- 桁境界の真実源は既存 `resources/navigation/rpg-fixed-keyword-columns.json` /
  `cl-keyword-columns.json`（値はフィールド開始桁、1 始まり）。
- 現在 `rpgTabNavigation.ts` 内に閉じているロード関数を **共通モジュール `src/language/keywordColumns.ts` に抽出**し、
  `rpgTabNavigation.ts` と新規ルーラーの双方から使う（重複排除・単一真実源）。
  - 公開関数：`getRpgKeywordColumns(context): Promise<Map<string, number[]>>`、
    `getClKeywordColumns(context): Promise<number[] | undefined>`（挙動は現状維持）。
  - `rpgTabNavigation.ts` は当該関数を import に置き換える（ロジック不変）。
- **ラベルは別ファイルで付与**（JSON にラベルが無いため。research F4）：
  新規 `resources/navigation/rpg-fixed-field-labels.json` /`cl-field-labels.json` を追加し、
  `スペック種別 → ラベル配列`（境界配列と同じ要素数、i 番目＝i 番目の境界から始まる区間のラベル）を定義する。
  ラベルが無い区間は空文字（＝境界線のみ）。

## 対象範囲

### 追加

- `src/language/ruler.ts`（新規・本体）：デコレーション生成、フォーカス行検知、ルーラー文字列生成、モード管理、ステータスバー。
- `src/language/keywordColumns.ts`（新規・抽出）：桁定義ロードの共通化。
- `resources/navigation/rpg-fixed-field-labels.json` / `cl-field-labels.json`（新規・ラベル定義）。
- `package.json`：`commands` にトグルコマンド、`configuration` に `rpgClSupport.ruler.*` を追加。

### 変更

- `src/language/registration.ts`：`registerRuler(context)` を 1 行追加。
- `src/language/rpgTabNavigation.ts`：桁ロードを `keywordColumns.ts` の import に置換（ロジック不変）。

## インターフェース / データ構造

### 表示モード

```ts
type RulerMode = "off" | "ruler" | "full";
const CYCLE: RulerMode[] = ["off", "ruler", "full"]; // クリックで off→ruler→full→off
```

- 既定値：設定 `rpgClSupport.ruler.defaultMode`（既定 `"full"`）。
- 保持：`ExtensionContext.workspaceState`（キー例 `rpgClSupport.ruler.mode`）にワークスペース単位で永続化。

### 公開関数

```ts
// ruler.ts
export function registerRuler(context: vscode.ExtensionContext): void;
// keywordColumns.ts
export function getRpgKeywordColumns(context): Promise<Map<string, readonly number[]>>;
export function getClKeywordColumns(context): Promise<readonly number[] | undefined>;
```

### 設定スキーマ（package.json `contributes.configuration`）

| キー | 型 | 既定 | 説明 |
|------|----|----|------|
| `rpgClSupport.ruler.defaultMode` | enum(`off`/`ruler`/`full`) | `full` | 初回／未保存時の表示モード |

### コマンド（package.json `contributes.commands`）

| command | title | 用途 |
|---------|-------|------|
| `rpgClSupport.ruler.cycleMode` | `RPG/CL: Toggle Ruler Display` | ステータスバー item に割当。クリックで 3 状態循環 |

### ラベル定義ファイル形式

```jsonc
// rpg-fixed-field-labels.json
{ "C-SPEC": ["Seq","C","Lv","Ind","Factor 1","OpCode","Factor 2","Result","Len","Dp","","Hi","Lo","Eq"], ... }
// 要素数は keyword-columns.json の同種別の桁数と一致させる（i 番目の境界から始まる区間のラベル）
```

## 振る舞いの詳細

### 更新トリガ

- `onDidChangeActiveTextEditor`（エディタ切替）
- `onDidChangeTextEditorSelection`（カーソル＝フォーカス行移動。**新規購読**。research F2）
- `onDidChangeTextDocument`（編集による行内容変化。アクティブエディタのみ）
- `onDidChangeConfiguration`（`rpgClSupport.ruler.defaultMode` 等）
- ステータスバーのトグルコマンド実行時

### 更新ロジック（`updateForEditor`）

1. エディタが無い／`isInScopeDocument(document)` が false → 両デコレーションをクリアし、ステータスバー item を非表示。
2. in-scope → ステータスバー item を表示（現モードを反映）。
3. `mode === "off"` → 両デコレーションをクリアして終了。
4. フォーカス行 `line = selection.active.line` を取得。
5. **目盛り段文字列**を生成（行の表示幅に応じ最低 80 桁、必要なら行長に合わせ延長）。
6. `mode === "full"` の場合のみ：行の種別を判定 → 桁境界（`keywordColumns`）＋ラベル（labels）から
   **境界段文字列**を生成。種別不明なら境界段は空。
7. フォーカス行（`new vscode.Range(line,0,line,0)`）に対し各デコレーションを `setDecorations` で適用。

### ルーラー文字列生成

- 目盛り段：1 始まりで `c%10===0 → (c/10)%10 の数字`、`c%5===0 → '+'`、その他 `'.'`。長さは max(80, 行長)。
- 境界段：境界配列（0-indexed 昇順）で区切られた各区間に、対応ラベルを左寄せ（区間幅で切り詰め）し、
  区間先頭に区切り（`|` 等）を置く。最終境界以降は行末/80 桁まで。
  - 桁整合は**論理文字カラム**基準（research F6）。DBCS データ部の視覚ズレは既知制約として許容。

### ステータスバー

- `vscode.window.createStatusBarItem(StatusBarAlignment.Right)`。`command = rpgClSupport.ruler.cycleMode`。
- 表示文言（例）：`$(ruler) Ruler: Full` / `Ruler: Cols` / `Ruler: Off`。tooltip にクリックで循環する旨。
- in-scope エディタがアクティブな時のみ `show()`、それ以外は `hide()`。

## ドメイン固有の考慮（AGENTS.md）

- **固定長フォーマットのみ対象**：free format には対応しない（種別判定は 6 桁目スペック文字前提）。
- **入力補助として表示（コード非書換）**：デコレーションのみ。保存・コピー・差分に影響しない。
- **対象拡張子**：`fileScope.isInScopeDocument` に一元化（rpg/rpgle/clp/dds/dspf/prtf/cmd ＋言語 ID）。
- **C 仕様の新旧**：MOVEL & EVAL 等で記述位置が異なる点は、`C-SPEC`/`C-NEW` を別定義で切り替える既存方針に従う。
- **SOSI 表示との整合**：ルーラーは論理カラム基準。DBCS/SOSI による見かけのズレは既知制約として明記。

## エラー処理 / 異常系

- 桁定義 JSON の読込失敗：`console.log` で警告し、当該種別は境界段を空に（目盛り段は出す）。既存ローダの方針を踏襲。
- ラベル定義 JSON の欠落／要素数不一致：ラベルを空扱いにして境界線のみ描画（フォールバック）。
- DDS/DSPF/PRTF/CMD 等、RPG/CL の種別判定に乗らない対象拡張子：目盛り段のみ表示。
- 空行・コメント行・行長 < 6：種別なし → 目盛り段のみ。
- デコレーションは `context.subscriptions` に登録し、dispose を保証。

## 受け入れ基準との対応

| requirement 完了条件 | 実現方法 |
|----------------------|----------|
| フォーカス行上部に目盛り段が表示 | `before`＋CSS 浮かせ、`onDidChangeTextEditorSelection` で追従 |
| 種別に応じた境界段（C/D/F/O/P, CL） | 独自種別判定＋`keywordColumns`＋labels。H/F/O/P も対象 |
| ステータスバーで 3 状態循環＋現状判別 | `cycleMode` コマンド＋StatusBarItem 文言 |
| 対象外拡張子では非表示 | `isInScopeDocument` で early-return＋item hide |
| ソース非書換 | デコレーションのみ。`TextEdit` を一切行わない |
| 既存機能と併用で破綻しない | 別 DecorationType・別購読。SOSI 等と独立 |

## 未確定（plan/coding で詰める軽微点）

- 各種別の具体ラベル文言・幅切り詰め規則（狭フィールドの省略）。
- CSS 浮かせの `top` オフセット実値（行高に対する調整。test で実機確認）。
- ステータスバーアイコン（`$(ruler)` 等）の最終選定。
