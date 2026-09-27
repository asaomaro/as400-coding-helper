# 設計: 検証を実機の誤りに揃える

## 方針
- 判定は新しい `core/dds/ddsSourceDiagnostics.ts` に集め、`dspfLayout` / `prtfLayout` の両方から呼ぶ（画面・帳票で同じ判定）。
  診断は layout の診断に混ぜるので、検証タブ（`RenderModel.diagnostics`）と lint（`layoutRule`）の両方に届く。
- **条件が必須のキーワードは原典から生成する。** `generate-dds-conditioning.mjs` に「無条件の要求」の文（`場合` を含まない）を読む規則を足し、
  `dds-conditioning.json` の `required` に出す。`verify-dds-conditioning.mjs` が実機で確かめた 3 件と完全一致を見る。
- 閉じないリテラルは「80 桁目までで閉じず、次の非注記行がキーワードだけの行（7-44 桁が空白）でない」ときだけ。
  継続記号なしでも続く規則は実機で確認済み（`20260827-dds-keyword-continuation`）。行の長さそのもの（81-100 桁は注記域）は咎めない。
- lint は 4 規則を足して既定 ON（実機で作成できない形でしか出ない）。`package.json` の設定にも載せる（`lintSettings` の到達性テスト）。

## 受け入れ基準との対応
- AC1: `keywordsRequiringConditioning`（`ddsConditionable.ts`）＋生成・検査スクリプト。`ddsSourceDiagnostics.test.ts`。
- AC2: `ddsSourceDiagnostics`（位置）。`ddsSourceDiagnostics.test.ts`。
- AC3: `ddsSourceDiagnostics`（帳票の使用）。同上。
- AC4: `ddsSourceDiagnostics`（`unclosedLiterals`）。同上。
- AC5: `dev/standalone.ts` の見本 `machine-errors.dspf` と `dev/e2e.mjs`（22b）。`lint/rules/index.ts`・`lint/types.ts`・`package.json`・`lintRules.test.ts`。
- AC6: リポジトリ内の全 `.dspf` / `.prtf`（`.vscode-test` を除く 33 件）に当てた集計（test-result.md）。
