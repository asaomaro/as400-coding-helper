# タスク: lint core（桁位置検査）

全 22 タスク。**T1-T8 は振る舞い不変**（既存テストが通ることが受け入れ）。

## ① src/core/ の切り出し（振る舞い不変）

- [x] T1: `src/core/dialect.ts` を新設し、`DEFAULT_DIALECT_BY_EXTENSION` /
      `normalizeOverrides` / `resolveDialectFromPath`（`prompter/dialect.ts:15-211`）を移す。
      `prompter/dialect.ts` は re-export ＋ `resolveDialect(document)` だけの殻にする。
      **受け入れ**: `dialect.test.ts` が import パスそのままで通る
- [x] T2: `src/core/rpgSpec.ts` を新設し、`classifyRpgSpecKeyword` の純粋部と
      `DEFAULT_C_NEW_OPCODES` を移す。options オブジェクト版の API にする。
      `prompter/specClassifier.ts` は**既存の位置引数シグネチャのまま**
      `getCNewOpcodes()` を注入して core を呼ぶ殻にする（`getCNewOpcodes` の export も維持）。
      **受け入れ**: `ruler.ts` / `positionResolver.ts` / `rpgCompletion.ts` を変更せずに
      `npm test` と `npm run verify` が通る（依存: T1）
- [x] T3: `src/core/sourceKind.ts` を新設し、`resolveSourceKind(fsPath, overrides)` と
      `LINTABLE_EXTENSIONS` を置く。`positionResolver.ts:104-122` の拡張子判定と
      `ddsKeywordCompletion.ts:91-97` の `resolveDdsType` をこれに寄せる
      （`ddsKeywordCompletion` は re-export）。
      **`.dds` が種別未決定のままである現状の挙動を変えない**。
      **受け入れ**: 既存テストが通る（依存: T1）
- [x] T4: `src/core/definitionLayout.ts` を新設し、`definitionFileName` と
      `definitionSubPath(language, dialect, uiLanguage)` を置く（表示言語を引数に外出し）。
      `jsonDefinitions.ts` はこれを使い、`resolveDefinitionLanguage()` の結果を渡す。
      **受け入れ**: `verify-prompter-roundtrip.mjs` と `npm test` が通る
- [x] T5: **純粋性の検査**を `scripts/verify-lint-core.mjs` に実装する。
      TypeScript の `ts.preProcessFile()` で import を構文的に取り出し、
      `src/core` / `src/lint` / `src/cli` の `"vscode"` import を弾く。
      ※当初の `tsconfig.core.json` 案は**効かないことを実測で確認**したため変更した（`decisions.md` D1）
      **受け入れ**: 検査が通る／`src/core` に `import * as vscode` を足すと落ちる／
      コメント中の `vscode` を誤検出しない（依存: T1-T4）
- [x] T6: 同スクリプトに `LINTABLE_EXTENSIONS` ⊆ `fileScope.ts` の `TARGET_EXTENSIONS`
      の検査を足し、`npm run verify:defs` から呼ぶ。
      **受け入れ**: 検査が通る／`LINTABLE_EXTENSIONS` に架空の拡張子を足すと落ちる（依存: T3）

## ② RpgSpecContext（振る舞い不変・O(n) 化）

- [x] T7: `core/rpgSpec.ts` に `createRpgSpecContext(cNewOpcodes?)` と
      `RpgSpecContext.classify(text, dialect?)` を追加する。内部状態は
      `fileDescription`（**既出の名前は上書きしない**）と
      `lastRecordName`（**毎回上書きする**）の 2 つ。
      既存の `classifyRpgSpecKeyword(text, {precedingLines})` は、その場で
      コンテキストを作って先行行を流し込む**ラッパー**に置き換える（実装は 1 つだけ）。
      **受け入れ**: `verify-rpg-roundtrip.mjs` の 11 サンプルと `npm test` が不変（依存: T2）
- [x] T8: `test/unit/rpgSpecContext.test.ts` を追加し、**蓄積版と `precedingLines` 版が
      全ての I/O 仕様書変種で同じ結果を返す**ことを検査する。
      F 仕様書が同名で複数あるケース（先勝ち）とレコード識別行が複数あるケース（後勝ち）を含める。
      **受け入れ**: 非対称を逆にすると落ちる（依存: T7）

## ③ lint core 本体

- [x] T9: `src/lint/types.ts` に `RuleId` / `Severity` / `LintFinding` / `LintOptions` /
      `RuleContext` / `Rule` を定義する
- [x] T10: `src/lint/defsLoader.ts` を追加する。`node:fs` で同梱定義のみを読み、
      `core/definitionLayout` に従う。表示言語は **`ja` 固定**。
      利用者の上書き（`.rpg-cl/`）は**読まない**。
      **受け入れ**: DDS 3 種と RPG（ile / rpg3）の定義が引ける単体テスト（依存: T4, T9）
- [x] T11: `src/lint/preprocess.ts` に `classifyLine` を実装する。
      DDS = 7 桁目 `*` または **7-80 桁が全て空白**／
      RPG = 7 桁目 `*` または行全体が空／
      RPG の F・D 仕様は **7-16 桁が空なら継続行**。
      **受け入れ**: 各分類の単体テスト。DDS のブランク行が `comment` になること（依存: T9）
- [x] T12: `src/lint/rules/lineLength.ts` に `line-length` を実装する。
      **100 桁超過のみ**を指摘（80 桁超過は指摘しない）。
      **受け入れ**: 100 桁ちょうどは指摘なし・101 桁で指摘（依存: T9）
- [x] T13: `src/lint/rules/numericField.ts` に `numeric-field`（非数字）と
      `numeric-alignment`（右寄せでない）を実装する。空欄は指摘しない。
      **受け入れ**: DDS の長さ欄（30-34）と RPG の `numericOnly` 欄で正例・負例（依存: T9）
- [x] T14: `src/lint/rules/index.ts` に RuleId → 実装・既定 ON/OFF・既定 severity の表を置く。
      `required-field` / `restricted-value` は**枠だけ・既定 OFF**で実装する。
      `restricted-value` は有効化しても `attributes.restricted === true` の欄に限る。
      **受け入れ**: 既定で有効なのが 3 規則であること・OFF の 2 規則を有効にしても
      検証済みコーパスで `restricted-value` が 0 件であること（依存: T12, T13）
- [x] T15: `src/lint/engine.ts` に `lintFile(request)` を実装する。
      1 走査で「種別判定 → 行分類 → 規則適用」。DDS はファイル単位で種別が決まるため
      行ごとの判定をしない。RPG のみ `RpgSpecContext` を通す。
      対象外の拡張子は空配列を返す（エラーにしない）。結果は行・桁の昇順。
      **受け入れ**: 結合テスト（依存: T7, T10, T11, T14）
- [x] T16: `test/unit/lintCorpus.test.ts` を追加し、**`docs/src/` の実機コンパイル
      確認済み 6 ファイル**（`CUSTMST.pf` / `CUSTLF1.lf` / `CUSTMNT.dspf` /
      `CUSTRPT.prtf` / `DBCSSAMP.pf` / `IOSAMP.rpgle`）で**指摘ゼロ**を検査する。
      未検証 3 ファイルは対象にしない。
      **受け入れ**: 指摘ゼロ。1 件でも出たら規則か前処理の欠陥として扱う（依存: T15）

## ④ SARIF と CLI

- [x] T17: `src/lint/sarif.ts` に SARIF 2.1.0 への変換を実装する。
      `tool.driver.rules[]` に**無効なものも含めた全 RuleId** を
      `defaultConfiguration.level` 付きで出す。
      **受け入れ**: 必須プロパティの存在と型を検査する単体テスト（依存: T9）
- [x] T18: `src/cli/lint.ts` を実装し、`package.json` に `"lint": "node out/cli/lint.js"` を足す。
      `--format` / `--output` / `--rule` / `--no-rule` / `--fail-on` を解析する。
      **受け入れ**: `npm run compile && node out/cli/lint.js docs/src/CUSTMST.pf` が
      SARIF を出し exit 0（依存: T15, T17）
- [x] T19: CLI の単体テストを追加する。終了コード 0（指摘なし）/ 1（error あり）/
      2（ファイル未指定・定義が読めない）と `--fail-on never` の挙動。
      **受け入れ**: 3 つの終了コードすべてを踏む（依存: T18）

## ⑤ VS Code 接続

- [x] T20: `src/language/diagnostics.ts` の `refresh()` に RPG / DDS の分岐を足し、
      lint core を呼ぶ。**既存の CL 分岐と登録するイベントは変えない**
      （`onDidOpen` / `onDidChange` / `onDidClose`）。定義は一度読んで再利用する。
      severity を `vscode.DiagnosticSeverity` に写す。
      **受け入れ**: 単体テスト（vscode-stub 上）で RPG / DDS の診断が作られる（依存: T15）
- [x] T21: `package.json` の `contributes.configuration` に
      `rpgClSupport.lint.enable`（boolean・既定 `true`）と
      `rpgClSupport.lint.rules`（object・既定 `{}`）を足し、`diagnostics.ts` で読む。
      `enable: false` のとき診断を出さず既存の収集を消す。
      **受け入れ**: 設定 OFF で診断が消える単体テスト（依存: T20）

## ⑥ CI

- [x] T22: `.github/workflows/prompter-definitions.yml` に lint の実行を足す。
      境界の検査（純粋性＋拡張子）は `verify-lint-core.mjs` が `npm run verify` から
      呼ばれるので、CI に足すのは lint の実行のみ（`decisions.md` D1）。
      **受け入れ**: クリーンビルドからローカルで再現でき、exit 0（依存: T6, T18, T21）
