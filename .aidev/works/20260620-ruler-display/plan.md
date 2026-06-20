# 計画: ルーラー表示機能

対応 issue: #2 / 前提: spec.md（research.md, requirement.md）

> パス注記: 実コードは `vscode-extension/` 配下。spec の `src/...` 表記は `vscode-extension/src/...` を指す。

## 実装方針

spec の構成を **「土台（共通化・定義ファイル・設定）→ 本体 ruler.ts を内側から外側へ→ 配線」** の順で積み上げる。
ruler.ts は責務ごとに小さく作り、最後に更新トリガで束ねる。各ステップは独立してビルド可能な単位にする。

1. **土台を先に固める**（本体が依存するため）
   - 桁ローダを `rpgTabNavigation.ts` から `keywordColumns.ts` に抽出（ロジック不変・単一真実源）。
   - ラベル定義 JSON（`*-field-labels.json`）を新設。
   - `package.json` にコマンドと設定 `rpgClSupport.ruler.defaultMode` を追加。
2. **ruler.ts を内側から構築**
   - モード管理（`off/ruler/full` 循環 + `workspaceState` 永続化）＋ステータスバー item。
   - スペック種別判定（6 桁目スペック文字 + C 新旧は `cNewOpcodes` 共有。H/F/O/P まで対応）。
   - 目盛り段文字列生成 ＋ `before`＋CSS 浮かせデコレーション（2 段の DecorationType）。
   - 境界段文字列生成（`keywordColumns` ＋ labels、種別不明は空）。
   - 更新ロジック `updateForEditor`（モード別出し分け・early-return）。
   - 更新トリガ購読（activeEditor / selection / textDocument / configuration / toggle command）。
3. **配線と検証**
   - `registration.ts` に `registerRuler(context)` を 1 行追加。
   - ビルド（tsc / lint）でコンパイルと既存機能の非回帰を確認。

## 作業順序と依存関係

1. **T1 桁ローダ抽出**（依存: なし）— `keywordColumns.ts` 新設、`rpgTabNavigation.ts` を import 置換。
2. **T2 ラベル定義 JSON**（依存: なし）— `rpg-fixed-field-labels.json` / `cl-field-labels.json`。
3. **T3 package.json**（依存: なし）— command `rpgClSupport.ruler.cycleMode`、設定 `ruler.defaultMode`。
4. **T4 モード管理＋ステータスバー**（依存: T3）— ruler.ts に骨格・`registerRuler` 雛形。
5. **T5 種別判定**（依存: なし。ruler.ts 内）— spec 文字判定＋C 新旧（`cNewOpcodes` 共有）。
6. **T6 目盛り段＋デコレーション**（依存: T4）— `tensDecoration`/`fieldsDecoration` 生成、目盛り文字列、CSS 浮かせ。
7. **T7 境界段生成**（依存: T1, T2, T5）— 境界配列＋ラベルから境界段文字列。
8. **T8 更新ロジック＋トリガ**（依存: T4, T5, T6, T7）— `updateForEditor` とイベント購読の統合。
9. **T9 登録配線**（依存: T4〜T8）— `registration.ts` に `registerRuler` 追加。
10. **T10 ビルド検証**（依存: T1〜T9）— `npm run compile`（tsc）/ lint 通過、既存機能の非回帰確認。

## リスク / 留意点

- **CSS 浮かせの重なり UX**（research F1）：`before` を `top` で上方向に浮かせると直上行へ視覚的に重なる。
  テーマ連動背景色で可読性を確保。`top` 実値は test で実機調整（spec 未確定点）。
- **C 新旧判定ロジックの共有**：`cNewOpcodes` は `positionResolver.ts` 内 private（`getCNewOpcodes`）。
  重複を避けるため、共有用に小さな分類ヘルパを export するか同等ロジックを共通化する（T5 で判断・最小変更を優先）。
- **種別判定の拡張**：ruler は `resolvePosition` に依存せず独自判定（H/F/O/P まで）。既存挙動（タブナビ）には触れない。
- **抽出の非回帰**：T1 は純粋リファクタ。`parseColumnsValue` 等も含め移設し、`rpgTabNavigation.ts` の挙動を変えない。
- **ラベル要素数の整合**：labels は keyword-columns の同種別桁数と一致させる。不一致／欠落はラベル空でフォールバック。
- **論理カラム整合**：DBCS データ部の見かけズレは既知制約（research F6）。構造カラム把握が主目的。

## テスト方針（test 工程の確認観点）

- 対象拡張子（rpg/rpgle/clp/dds/dspf/prtf/cmd）でフォーカス行上に目盛り段が出る／対象外では出ない。
- スペック種別（C/D/F/O/P/H, CL）ごとに境界段が切替わる。種別不明・空行・コメント行は目盛り段のみ。
- ステータスバークリックで `off → ruler → full → off` が循環し、現状が文言で判別できる。
- モードが `workspaceState` に永続化される（再オープンで保持）。
- ソース非書換（保存・コピー・差分に影響なし）。SOSI・タブナビと併用で破綻しない。
- `npm run compile` / lint がエラーなく通る（既存テストがあれば green）。
