# タスク: IBM i ソースメンバーの手動同期と可視 SEU 色属性

## 実装方針

architecture の4層を下から順に実装する。まず manifest・テスト基盤を整え、VS Code に依存しない target と marker の純粋ロジックを table-driven test とともに固定する。その後に `ssh2` transport、VS Code command、色装飾を接続する。最後に unit / integration / 実機プローブを同じ受け入れ基準に対して実行する。

この work は subtask に分割しない。transport、command、marker decoration は公開 API と end-to-end の往復で強く結合し、個別に deliver しても要件を満たせない一方、1 PR に収まる規模である。順序は下の `依存:` を正本とする。

## 作業順序と依存関係

T1 と T2 は土台として先に完了させる。T3 で IBM i との境界・cleanup の不変条件を固定し、T4 がそれを document 操作へ組み込む。T5 は marker domain と command の登録後に extension へ結線する。T6 は全タスクの後に回し、単体テストの緑だけで実機往復や extension host の起動を代弁しない。

T1〜T7 は完了済み（US1〜US3、AC1〜AC11・AC-I1〜AC-I5）。T8〜T11 は US4（AC12〜AC18: アップロード時のファイル名からのテキスト記述・SRCTYPE 反映）を追加する。T8（target 解決の純粋ロジック）が土台で、T9（transport の CHGPFM 追加）と T10（command の通知分岐）がそれぞれ独立した層を触るため T8 完了後に着手できる。T11（実機検証）は T9・T10 の両方を終えてから行う。

## リスク / 留意点

- `ssh2` の SFTP subsystem を閉じてから同一 SSH client 上で `CPYFRMSTMF` を実行する順序は、実機で `CPFA09E` を避けるための必須条件である。T3 の facade test と T6 の実機 probe の両方で固定する。
- source PF の CCSID は settings に追加しない。`STMFCCSID(1208) DBFCCSID(*FILE)` を使い、65535 等の変換不能を成功扱いにしない。
- password/passphrase、秘密鍵本文、raw command は通知・ログ・settings JSON に残さない。private key path だけを非機密設定として transport adapter が読み込む。
- 7基底色以外の修飾属性は初期 UI の対象外である。未知 wire control を削除・丸めず無変換通過させ、基底7色だけを marker と decoration にする。
- `package.json` の menu `when` は静的列挙であるため、`TARGET_EXTENSIONS` と一致する検証を `verify-contributes.mjs` に追加して配線漏れを防ぐ。
- `CHGPFM ... TEXT('...')` へ埋め込む `textDescription` は、ファイル名由来の未加工文字列を CL コマンド文字列へ埋め込む初めての経路である。アポストロフィのエスケープを怠ると CL 構文が壊れる（T9 で対応、研究 F12）。
- 全角文字を含む `textDescription` が `CHGPFM` 経由で正しく往復するかは design 時点で未検証（研究の未確定事項）。T11 の実機検証で確認し、問題があれば設計へ差し戻す。
- `-`（ハイフン）区切りの導入で、既存のアンダースコア入りメンバー名の解決結果を変えないこと（decisions.md D7）を T8 の回帰テストで固定する。

## テスト方針

- T2 は extension host を起動しない pure unit、T3 は injectable SSH facade の unit、T4/T5 は `vscode` stub を使う unit を追加する。
- T5 は SOSI decoration と色 decoration が同一対象文書で共存する integration test を追加する。
- T6 は `npm run compile:all`、`npm test`、寄与検証、integration test と既存の IBM i probe を実行し、7基底色、`Ŕ`、DBCS、IFS cleanup を確認する。実機に接続できない検証は成功扱いにせず test-result へ未検証として残す。

## タスク

- [x] T1: 同期機能の manifest、設定、コマンド導線、テスト基盤を追加する。
      対象: `vscode-extension/package.json` `vscode-extension/package-lock.json` `vscode-extension/test/support/vscode-stub.js` `docs/origin/verify-contributes.mjs` / 根拠: design「対象範囲」「コマンドとメニュー」、architecture「設定・寄与・activation」
      依存: なし
      AC: AC4, AC5, AC-I1, AC-I3, AC-I5

- [x] T2: workspace 相対パスの member target 解決と、7基底色 marker/wire/範囲算出の純粋ロジックを table-driven tests とともに実装する。
      対象: `vscode-extension/src/sync/memberTarget.ts`（新規） `vscode-extension/src/sync/visibleColorMarkers.ts`（新規） `vscode-extension/test/unit/memberSync.test.ts`（新規） / 根拠: research F3-F4、design「target と marker」、architecture「domain 層」
      依存: なし
      AC: AC1, AC8, AC9, AC10, AC11

- [x] T3: SSH/SFTP transport adapter を実装し、host-key 検証、認証、UTF-8 の temporary IFS transfer、`CPYTOSTMF`/`CPYFRMSTMF`、cleanup と安全なエラー分類を検証する。
      対象: `vscode-extension/src/sync/ibmiSourceTransport.ts`（新規） `vscode-extension/test/unit/memberSync.test.ts` `vscode-extension/package.json` / 根拠: research F1/F3/F5/F6、design「transport」「エラー処理」、architecture「transport adapter 層」
      依存: T1, T2
      AC: AC2, AC3, AC4, AC6, AC8, AC10, AC11

- [x] T4: 同期 command を実装し、settings/SecretStorage validation、URI 単位の排他、upload/download の文書更新・保存・通知・フォーカス復帰を fake transport で検証する。
      対象: `vscode-extension/src/extension/commands/memberSync.ts`（新規） `vscode-extension/src/extension/extension.ts` `vscode-extension/test/unit/memberSync.test.ts` / 根拠: design「ダウンロード」「アップロード」「コマンドとメニュー」、architecture「application command 層」
      依存: T1, T2, T3
      AC: AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC-I1, AC-I2, AC-I3, AC-I4, AC-I5

- [x] T5: 可視 SEU 色の decoration 登録を実装し、対象範囲、再計算、無効時の解除、SOSI との共存を extension host まで結線して検証する。
      対象: `vscode-extension/src/language/seuColorMarkers.ts`（新規） `vscode-extension/src/extension/extension.ts` `vscode-extension/test/unit/seuColorMarkers.test.ts`（新規） `vscode-extension/test/integration/seuColorMarkers.test.ts`（新規） / 根拠: research F4/F7、design「marker 表示」、architecture「presentation 層」「テスト境界」
      依存: T1, T2, T4
      AC: AC9, AC-I3, AC-I5

- [x] T6: 検証の全経路を test 工程で実行できるよう、実機 probe を7基底色・`Ŕ`・DBCS・IFS cleanup の回帰検査へ拡張し、実行手順と期待値を固定する。
      対象: `.aidev/works/20260910-ibmi-source-member-sync/verify/probe-seu-source-color.mjs` `vscode-extension/package.json`（test scripts の実行） `vscode-extension/test/unit/memberSync.test.ts` `vscode-extension/test/unit/seuColorMarkers.test.ts` / 根拠: research F3/F5、design「テスト方針」、architecture「テスト境界」
      依存: T1, T2, T3, T4, T5
      AC: AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC-I1, AC-I2, AC-I3, AC-I4, AC-I5

- [x] T7: review 指摘に従い、SSH host-key fingerprint の hex と Base64 の比較規則を分離し、Base64 の大文字・小文字違いを拒否する回帰テストを追加する。
      対象: `vscode-extension/src/sync/ibmiSourceTransport.ts` `vscode-extension/test/unit/memberSync.test.ts` / 根拠: review.md「レビュー ラウンド 1」
      依存: T3
      AC: AC4, AC6

- [x] T8: `resolveMemberTarget` を判別共用体（`ok:true/target` / `ok:false/reason`）へ変更し、ファイル名を最初の `-` で分割してメンバー名・テキスト記述を抽出・検証する。`deriveSourceType`（拡張子の一様大文字化、特例なし）を追加する。既存のアンダースコア入りメンバー名（例: `MY_PGM.rpg`）が分割されず従来どおり解決されることを回帰テストで固定する。
      対象: `vscode-extension/src/sync/memberTarget.ts` `vscode-extension/test/unit/memberSync.test.ts` / 根拠: design「アップロード属性の抽出と target 解決」「target 解決」、decisions.md D7・D8
      依存: T2
      AC: AC12, AC13, AC14, AC15, AC16

- [x] T9: `ibmiSourceTransport` の `upload` を「`CPYFRMSTMF`（内容コピー・宛先メンバー未存在なら自動作成） → `CHGPFM FILE(...) MBR(...) SRCTYPE(...) [TEXT('...')]`（属性反映）」の2段に拡張する。CL 文字列リテラルのアポストロフィをエスケープする専用関数を追加し、`textDescription` を含むテキストを安全に組み立てる。内容コピー成功後に属性コマンドだけ失敗した場合は `kind: "attributes"` として区別する。宛先ライブラリー／ソース物理ファイルが存在しない場合に既存の `kind: "copy"` 失敗として扱われることを fake ssh client で確認する。
      対象: `vscode-extension/src/sync/ibmiSourceTransport.ts` `vscode-extension/test/unit/memberSync.test.ts` / 根拠: design「transport」「アップロード」「エラー処理」、research F8・F9・F12
      依存: T3, T8
      AC: AC14, AC17, AC18

- [x] T10: アップロード command ハンドラーを、`resolveMemberTarget` の新しい失敗理由（`pathShape`/`memberName`/`textDescription`）ごとに IBM i 接続前の具体的な通知を出すよう変更する。`transport.upload` へ `deriveSourceType`/`textDescription` を渡し、`kind: "attributes"` 失敗時は「内容は反映済みだが属性反映に失敗した」ことが伝わる通知にする。
      対象: `vscode-extension/src/extension/commands/memberSync.ts` `vscode-extension/test/unit/memberSync.test.ts` / 根拠: design「アップロード」「エラー処理」
      依存: T4, T8, T9
      AC: AC12, AC13, AC14, AC15, AC16, AC17, AC18

- [ ] T11: 実機検証を追加する。テキスト記述に全角文字（日本語）を含む場合の `CHGPFM ... TEXT('...')` 往復（design 時点で未検証・ユーザー承認済み）、宛先メンバー未存在時の `CPYFRMSTMF` 自動作成（AC17）、宛先ライブラリー／ソース物理ファイル未存在時の失敗（AC18）を確認する。実機に接続できない場合は test-result へ未検証として明記し、成功扱いにしない。
      対象: `.aidev/works/20260910-ibmi-source-member-sync/verify/probe-seu-source-color.mjs`（拡張、または新規 probe スクリプト） / 根拠: design「テスト方針」、ibmi-remote skill
      依存: T9, T10
      AC: AC12, AC17, AC18
