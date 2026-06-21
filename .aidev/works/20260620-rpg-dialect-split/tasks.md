# タスク: RPG方言(ILE / RPG III)対応の基盤整備

- [x] T1: `src/prompter/types.ts` に `export type Dialect = "ile" | "rpg3"` を追加
- [x] T2: `src/prompter/dialect.ts` を新規作成（既定マップ・`resolveDialectFromPath` 純関数・`resolveDialect(document)` vscode ラッパ）（依存: T1）
- [x] T3: `src/prompter/positionResolver.ts` に `ResolvedPosition.dialect?` を追加し、rpg-fixed で `resolveDialect` を設定。rpg3 のとき `C`→`C-SPEC` 固定（C-NEW 判定をスキップ）（依存: T2）
- [x] T4: `src/prompter/jsonDefinitions.ts` の `loadForLanguage` に `dialect` 引数を追加。rpg は `rpg/{dialect}/`＋`.rpg-cl/rpg/{dialect}/`、ile は旧 `.rpg-cl/rpg/` も低優先フォールバックで keyword マージ（依存: T1, T5, T7）
- [x] T5: 既存4定義（D-SPEC/C-SPEC/C-NEW/H-SPEC.json）を `resources/prompter/rpg/` から `resources/prompter/rpg/ile/` へ移設
- [x] T6: `src/extension/commands/showPrompter.ts` で `loadForLanguage` に `resolved.dialect` を受け渡し（依存: T3, T4）
- [x] T7: `resources/prompter/rpg/rpg3/C-SPEC.json` を新規作成（FACTOR1 18/10・OPCODE 28/5・FACTOR2 33/10・RESULT 43/6・COMMENT 60/15、research F5 照合）
- [x] T8: `package.json` に `rpgClSupport.rpgDialectByExtension` 設定プロパティを追加（既定 `{".rpgle":"ile",".rpg":"rpg3"}`）（依存: T2）
- [x] T9: バックログ整備 — `.aidev/backlog/rpg-spec.md` を ILE スコープと明記、`.aidev/backlog/rpg3-spec.md` を新規（RPG III 枠）
- [x] T10: テスト追加/追従＋ビルド — `test/unit/dialect.test.ts`（`resolveDialectFromPath`）追加、全 `loadForLanguage` 呼出は追従済み、`tsc -p ./` 緑（EXIT 0）
