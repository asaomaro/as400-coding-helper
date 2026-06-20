# タスク: ルーラー/制御コード表示の対象拡張子の拡張

関連 issue: #4

- [x] T1: `fileScope.ts` に `TARGET_EXTENSIONS` 定数と `hasTargetExtension` を導入し、`isInScopeDocument` / `isInScopeUri` を書き換える
- [x] ~~T2: `package.json` で `.rpg/.dds/.dspf/.prtf` を `rpg-fixed`、`.cmd` を `cl` に関連付ける~~（D1 により見直し → T5/T6 で置換）
- [x] T3: `test/unit/` に scope 判定のユニットテストを追加（7拡張子真・大文字真・対象外偽・既存維持）（依存: T1）
- [x] T4: `npm run compile` が通ることを確認する

## review 差し戻し対応（D1）

- [x] T5: `package.json` の言語登録を見直す（`.rpg` のみ `rpg-fixed` 同居、`.dds/.dspf/.prtf/.cmd` は言語登録しない）
- [x] T6: `activationEvents` に `onStartupFinished` を追加し、拡張子ベースで表示系を起動させる
- [x] T7: コンパイル＋受け入れ基準＋副作用解消（.cmd に CL 診断が走らない / .dds に RPG 編集機能が付かない）を確認する
