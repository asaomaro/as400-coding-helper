# 設計: RPG 仕様書の定義の不足をまとめて直す

## 方針
- **値は生成する**（AGENTS.md「原典から機械的に決まる成果物は、LLM に書かせずスクリプトで生成する」）。
  原典の桁ごとのページ（`f17.htm` … `d40.htm`）を `sources.mjs` に足して取得し（ja / en）、`generate-rpg-position-values.mjs` が
  「記入 / 説明」の定義リストから options を入れる。英語版のラベルは訳文ファイル（`rpg-spec-en-strings.json`）の options に英語の原典から入れる。
  `--check` を CI（`prompter-definitions.yml`）で流す。
- 必須・表示・見出し・説明は日本語版の JSON を直し、英語版は `generate-rpg-spec-definitions.mjs` で作り直す。
  見出しの桁番号は `verify-rpg-definitions.mjs` に検査を足して見張る（書き戻す桁が正しくても見出しが誤っていれば利用者は誤る）。
- O ＋ F は既存の `dependsOn`（`effect: "allowedValues"`）で表す（FILETYPE が O なら FILEDESG はブランクだけ）。

## 受け入れ基準との対応
- AC1: `docs/origin/generate-rpg-position-values.mjs`・`sources.mjs`・`ilerpg{,-en}/{F,D}-POS-*.html`・CI の手順。
- AC2: `resources/prompter/rpg/ile/ja/{D,F,P,C-NEW}.json` の `required`。`prompterRegressions.test.ts`・`lintDiagnostics.test.ts`。
- AC3: 同 JSON の `visibleByDefault`。`prompterRegressions.test.ts`。
- AC4: `verify-rpg-definitions.mjs`・`docs/ILE_RPG_Fixed_Format_Reference.md`。
- AC5: `F-SPEC.json` の `FILEDESG.dependsOn`。`prompterRegressions.test.ts`。
- AC6: `verify/make-gaps.mjs` → `GAPS.rpgle`。
