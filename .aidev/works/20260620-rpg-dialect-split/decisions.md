# 自律実行中の重要判断（decisions）

autonomous モードで人間ゲートを介さず行った判断の記録（protocol §10「逸脱記録」）。

## D1: spec 後に design(任意) を挟まない
- 判断: スキップ。
- 理由: spec でインターフェース・データ構造・唯一のアーキ判断（dialect を `ResolvedPosition` に載せる）を
  根拠つきで確定済み。plan で直接分解できる粒度に達している。横断はするが新規アーキ判断は残っていない。

## D2: 方言は `ResolvedPosition.dialect` に載せる（呼出側受け渡しではない）
- 判断: `resolvePosition` 内で document から dialect を導出し `ResolvedPosition` に格納。
- 理由: 導出ロジックを1箇所に閉じ、消費側（showPrompter / rpgTabNavigation）の重複を避ける。research 申し送り #4。

## D3: 旧 `.rpg-cl/rpg/`（dialect 無し）上書きを ile でフォールバック読込
- 判断: ile 方言時のみ旧パスも低優先で keyword マージ。
- 理由: 既存4定義を `ile/` 移設すると既存ユーザーのワークスペース上書きが読まれなくなる回帰を防ぐ。research リスク／申し送り #3。

## D4: 設定キーは拡張子単位の map `rpgClSupport.rpgDialectByExtension`
- 判断: `{ ".rpgle":"ile", ".rpg":"rpg3" }` を既定とする object 設定。ファイル単位の粒度は設けない。
- 理由: VSCode 標準スコープでフォルダ別上書き可能。`.rpg` を ILE 扱いする要件を最小構成で満たす。research 申し送り #2。

## D6: ビルド検証は `tsc`、mocha は当環境で未配線
- 背景: `package.json` の `test` スクリプトはプレースホルダ（echo）で、test 用 tsconfig も `.mocharc` も無い。
  既存 `test/**/*.test.ts` は本 tsconfig（`include: ["src"]`）の対象外で、当環境では mocha 実行不可。
- 決定: coding の検証は `tsc -p ./`（src 型チェック・EXIT 0）を正とする。`dialect.test.ts` は既存テスト規約に
  合わせて追加（将来テストハーネス配線時に走る）。test 工程では rpg3 `C-SPEC.json` の桁を原典(research F5)と
  直接照合し、受け入れ基準をトレースする。
- 理由 / 代替案: 当環境にmochaを新規配線するのは本作業スコープ外。型チェック＋定義直読で実効的に検証できる。
- 影響: test 工程は「自動テスト実行」ではなく「tsc＋成果物の原典照合＋手順トレース」で受け入れ判定する。

## D5: タブナビ／ルーラーの桁マップは方言非対応のまま（対象外）
- 判断: `rpgTabNavigation` / ルーラーは変更しない（ILE 桁マップを使用）。
- 理由: requirement 対象外「編集キーバインドの方言対応」。ただし `.rpg` の C 行 keyword が C-NEW 判定→`C-SPEC`
  固定に変わる副作用は RPG III に C-NEW が無いため正方向で回帰ではない（review で確認）。
