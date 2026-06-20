# 要件: ルーラー/制御コード表示の対象拡張子の拡張

関連 issue: #4

## 背景 / 課題

AGENTS.md では、ルーラー表示・制御コード(SOSI)表示の対象拡張子として
`rpg, rpgle, clp, dds, dspf, prtf, cmd` が指定されている。
しかし現状 `src/utils/fileScope.ts` は `.rpgle` / `.clp`（および languageId `rpg-fixed` / `cl`）のみを
対象としており、仕様で求められる他の拡張子（rpg, dds, dspf, prtf, cmd）で表示系機能が有効にならない。

## 目的 / ゴール

対象拡張子を AGENTS.md の指定どおり `rpg, rpgle, clp, dds, dspf, prtf, cmd` に拡張し、
これらすべてのファイルでルーラー表示・SOSI 表示が有効になる状態にする。

## スコープ

### 対象

- `fileScope.ts` の対象拡張子判定（`isInScopeDocument` / `isInScopeUri`）の拡張
- 上記により表示系機能（ルーラー / SOSI / 関連 diagnostics）の有効範囲を拡大
- 必要に応じた `package.json` の言語登録 / 拡張子関連付けの見直し

### 対象外

- ルーラー表示機能そのものの実装（issue #2）
- ステータスバーによる ON/OFF 切替（issue #3）
- 各拡張子に固有の構文解析・桁位置定義の作り込み

## 機能要件

- `rpg, rpgle, clp, dds, dspf, prtf, cmd` の各拡張子で `isInScopeDocument` / `isInScopeUri` が真を返す。
- 拡張子の判定は大文字・小文字を区別しない（既存の `toLowerCase` 挙動を踏襲）。
- 既存の languageId（`rpg-fixed` / `cl`）による判定は維持する。

## 非機能要件 / 制約

- 既存の `.rpgle` / `.clp` の挙動を変えない（後方互換）。
- 対象拡張子の定義は一元管理し、`isInScopeDocument` と `isInScopeUri` で二重定義しない。
- 既存の利用箇所（`dbcsShiftMarkers.ts`, `diagnostics.ts`）に副作用を与えない。

## 完了条件 (受け入れ基準)

- [ ] `rpg, rpgle, clp, dds, dspf, prtf, cmd`（大文字含む）のファイルで scope 判定が真になる。
- [ ] 対象外拡張子（例: `.ts`, `.txt`）では従来どおり偽になる。
- [ ] 既存の `.rpgle` / `.clp` の挙動が維持される。
- [ ] `isInScopeDocument` / `isInScopeUri` が同一の拡張子定義を参照している。

## 未確定事項 / 確認したいこと

- `package.json` の言語登録（`.rpgle` / `.clp` のみ）を他拡張子にも広げるか。
  表示系機能は languageId 非依存（拡張子判定）でも動くため、最小実装では不要の可能性。spec で判断する。
- 新規拡張子（dds/dspf/prtf/cmd 等）に languageId を割り当てる場合、どの言語（rpg-fixed/cl/新規）に紐付けるか。spec で判断する。
