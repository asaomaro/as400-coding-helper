# タスク: RPG 仕様書の定義の不足をまとめて直す

## タスク
- [x] T1: 桁ごとのページを取得し、選択欄の値を生成する（ja / en）。`--check` を CI に足す。
      対象: `docs/origin/{sources.mjs,manifest.yml,generate-rpg-position-values.mjs,rpg-spec-en-strings.json}` / `docs/origin/ilerpg{,-en}/*-POS-*.html` / `.github/workflows/prompter-definitions.yml`
      依存: なし
      AC: AC1
- [x] T2: 必須・表示・見出し・説明・O ＋ F を直し、英語版を作り直す。見出しの桁の検査を足す。md の表を直す。単体テスト。
      対象: `resources/prompter/rpg/ile/{ja,en}/*.json` / `docs/origin/verify-rpg-definitions.mjs` / `docs/ILE_RPG_Fixed_Format_Reference.md` / テスト
      依存: T1
      AC: AC2, AC3, AC4, AC5
- [x] T3: 実機で確かめる。
      対象: `verify/`
      依存: T2
      AC: AC6
