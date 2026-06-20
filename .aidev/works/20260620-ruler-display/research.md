# 調査: ルーラー表示機能の実現性と既存資産

対応 issue: #2 / 前提: requirement.md

## 調査の問い

- Q1: VSCode で「フォーカス行の**上側**に水平ルーラー行」を、ソース非破壊・桁を保ったまま表示する手段は何か。実現可能か。
- Q2: フィールド境界段（スペック種別ごとの区切り）の素になる既存資産は何か。そのまま使えるか。
- Q3: 既存の桁位置定義 JSON は、境界段の描画にどの粒度で使えるか。ラベルは取れるか。
- Q4: ステータスバーのオンオフ切替（3 状態）と状態保持はどう実現するか。既存実装はあるか。
- Q5: DBCS（SOSI）を含む行でのルーラー桁合わせはどうなるか。

## 判明した事実

### F1: 上側ルーラーの描画手段（Q1）

- 既存 SOSI 表示 `src/language/dbcsShiftMarkers.ts` は
  `vscode.window.createTextEditorDecorationType({ before: { contentText, color } })` を使い、
  `editor.setDecorations()` で**ソース非破壊**にマーカーを描画している。
  `before`/`after` の `contentText` は**エディタフォント（等幅）でインライン描画**されるため、桁が保たれる。
- ただし `before`/`after` は**同一行内インライン**で、改行を含められない。
  → 「行の“上側”に独立した行」を素の API だけで出すことはできない。
- 候補機構の比較（engine は `package.json` `engines.vscode: ^1.90.0`）：
  | 手段 | 上に出せるか | 等幅・桁整合 | 配布可否 | 評価 |
  |------|------------|------------|---------|------|
  | TextEditorDecoration `before/after` | △（同一行のみ。CSS 注入で浮かせる必要） | ◯ 等幅 | ◯ | 桁整合は最良。上配置はCSS工夫が要る |
  | CodeLens（行上に表示） | ◯ 行の真上 | ✕ UIフォントで桁が合わない | ◯ | ルーラー用途には不適（桁ズレ） |
  | `window.createWebviewTextEditorInset`（行間に webview） | ◯ | ◯（CSS で等幅化可） | ✕ **proposed API**（`enabledApiProposals` 必須・Marketplace 配布不可） | 配布前提（.vsix 配布物あり）では採用不可 |
- 現実的に「上側・等幅・配布可」を満たすのは **decoration の `before` content を CSS（`textDecoration` への CSS 注入手法）で
  フォーカス行の上に浮かせる**方法。等幅は保てる。2 段（目盛り＋境界）は擬似要素を2つ重ねる等の工夫が要る。
  **既知リスク**：浮かせた要素は直上の行に**視覚的に重なる**可能性がある（spec で UX を要検討）。

### F2: フォーカス行の検知（Q1 付随）

- 既存 SOSI は `onDidChangeActiveTextEditor` ＋ `onDidChangeTextDocument` で**全行**を再装飾している
  （カーソル行の検知はしていない）。
- ルーラーは**フォーカス（カーソル）行のみ**が対象なので、`onDidChangeTextEditorSelection` の購読を
  追加してカーソル行変化を拾う必要がある（既存にはこの購読は無い）。

### F3: スペック種別の判定資産（Q2）

- `src/prompter/positionResolver.ts` の `resolvePosition(document, position)` が
  行頭6桁目のスペック文字等から `keyword`（`"C-SPEC"` / `"C-NEW"` / `"D-SPEC"`、CL は先頭トークン）を返す。
- `src/language/rpgTabNavigation.ts` の `getRpgKeywordColumns()` が
  `resources/navigation/rpg-fixed-keyword-columns.json` を読み、`keyword → 桁配列(0-indexed)` の Map を返す。
  CL は `getClKeywordColumns()` が `cl-keyword-columns.json`（`[14,25]`）を返す。
- **重要な制約（ギャップ）**：`resolvePosition` は **C-SPEC / C-NEW / D-SPEC（＋CL）しか判定しない**。
  JSON には `H-SPEC / F-SPEC / O-SPEC / P-SPEC` 定義もあるが、`resolvePosition` がこれらの keyword を返さないため、
  **現状の判定ロジックでは H/F/O/P 仕様の境界段は出せない**（フォーカス行が H/F/O/P だと境界段は空になる）。

### F4: 桁定義 JSON の粒度とラベル（Q3）

- JSON 値は**フィールドの開始桁（1始まり）**の羅列。`parseColumnsValue` で `-1` して 0-indexed の境界配列になる。
  例 C-SPEC: `1,6,7,9,12,26,36,50,64,69,71,73,75,77,81`。
- **境界（区切り位置）は取れるが、フィールド名ラベル（Factor1 / OpCode / Result 等）は JSON に含まれない**。
  → 境界段にラベルを出すなら、別途「スペック種別×区間→ラベル」の対応表を新設する必要がある
    （ラベル無しで縦線/目盛りだけなら新設不要）。

### F5: ステータスバーと状態保持（Q4）

- `grep statusBar` → **既存実装は無い**。新規に `vscode.window.createStatusBarItem()` で追加する。
- トグルは `vscode.commands.registerCommand` でコマンドを作り、StatusBarItem.command に割り当て、
  クリックで 3 状態（非表示→ルーラーのみ→ルーラー＋境界）を循環させる。
- 状態保持は SOSI 同様のモジュール内変数（セッション内）か、`ExtensionContext.globalState/workspaceState` で永続化が可能。
  設定として持つなら `package.json` `contributes.configuration` に `rpgClSupport.ruler.*` を追加（既存は `rpgClSupport.*` 名前空間）。
- 機能登録は `src/language/registration.ts` の `registerLanguageFeatures()` に `registerRuler(context)` を追加する流儀。

### F6: DBCS（SOSI）との桁整合（Q5）

- ルーラーは**論理的な文字カラム**（コードユニット位置）に整合する。固定長の構造カラム（1〜80 の桁割り）は
  基本 SBCS 領域なので問題ない。
- 一方、データ部に DBCS（全角）がある行では、全角は**2 セル幅**で描画され、さらに SOSI 表示の `{` `}` 装飾が
  視覚幅を足すため、**データ部ではルーラー（単幅）と見かけ位置がズレる**。
  → 構造カラムの把握という主目的は満たすが、DBCS データ部での厳密一致は本質的に困難。spec で「論理カラム整合」とする方針が妥当。

## 影響範囲

- 追加: `src/language/ruler.ts`（新規）。`registration.ts` に登録 1 行追加。
- 参照（変更なしで再利用）: `utils/fileScope.ts`（対象判定）、`prompter/positionResolver.ts`（種別判定）、
  `rpgTabNavigation.ts` の桁ロード（※ロード関数は現状 `rpgTabNavigation.ts` 内に閉じている。ルーラーから使うなら
  共通化＝桁ロードの抽出を検討）。
- `package.json`: `commands`（トグル用）と必要なら `configuration` に `rpgClSupport.ruler.*` を追加。
- H/F/O/P 仕様の境界段まで出すなら `positionResolver.ts` の種別判定拡張が必要（影響は限定的だが既存挙動に触れる）。

## 実現性 / リスク

- **実現可能**。ただし「上側・等幅・配布可」を同時に満たすには decoration への CSS 注入が必要で、
  直上行への視覚的重なりという UX リスクがある（要 spec 判断 / 動作確認）。
- フィールド境界段は **C/D/CL は即対応可**、**H/F/O/P は判定拡張が前提**。
- ラベル付き境界段にする場合のみ「区間→ラベル」表の新設コストが発生する。
- 桁ロード関数が `rpgTabNavigation.ts` 内に閉じているため、再利用には軽いリファクタ（共通化）が望ましい。

## spec への申し送り

1. **描画機構の決定**：decoration＋CSS 注入で上側に浮かせる案を基本線とし、直上行への重なり UX を具体化
   （フォーカス行のみ表示／半透明／表示位置）。CodeLens・webview inset は不採用理由を記録済み。
2. **2 段表示の実現**：目盛り段とフィールド境界段の重ね方（擬似要素2つ／decoration2種）を決める。
3. **境界段のラベル有無**：ラベルを出すか（→対応表新設）、区切り＋目盛りのみか。requirement のサンプルはラベル付き。
4. **スペック種別カバレッジ**：H/F/O/P-SPEC を対象に含めるか。含めるなら `resolvePosition` の判定拡張を plan に積む。
   含めないなら「C/D/CL 対象、他は目盛り段のみ」と完了条件を明確化。
5. **フォーカス行検知**：`onDidChangeTextEditorSelection` の購読追加を前提にする。
6. **3 状態の保持**：セッション内保持か永続化（globalState/設定）か。ステータスバー文言・アイコン・配置を決める。
7. **DBCS 整合**：ルーラーは論理カラム整合とし、DBCS データ部のズレは既知の制約として明記する。
8. **桁ロードの共通化**：`rpgTabNavigation.ts` の桁ロードをルーラーから使うための抽出可否を plan で判断。
