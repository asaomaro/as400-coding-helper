# 仕様: RPGUnit テストにテスト対象のサービスプログラムをバインドする

## 概要

テストファイルごとに `testing.json` を探して `rpgunit.rucrtrpg.bndSrvPgm` / `bndDir` を読み、
`RUCRTRPG` に `BNDSRVPGM(...)` / `BNDDIR(...)` として渡す。**探し方**は IBM i Testing と同じにし、
**合成**はキー単位の置き換えにする（IBM i Testing の要素ごとの合成とは意図して変える。D5）。設定の誤りはコンパイル前に見つけ、そのファイルのテストを errored にする。

## 設計方針

- **読み取り（I/O）と解釈（純粋ロジック）を分ける**（`20260922-rpgunit-vscode-testing` と同じ方針）。
  - `src/testing/testingConfig.ts`（新規）: `testing.json` の文字列を受け取り、バインド指定を解釈・検証・合成する
    **純粋関数**と、VS Code の `workspace.fs` で探して読む**薄い I/O 関数**。
  - `src/testing/rpgunitCommands.ts`: `BNDDIR` を足し、`BNDSRVPGM` の自動修飾をやめる。
  - `src/testing/testController.ts`: コンパイル前にバインド指定を解決し、誤りなら errored にして戻る。
- **修飾の無い名前は修飾しない**（decisions.md D4）。`RUCRTRPG` のコマンド定義で既定のライブラリーが
  `*LIBL` なので、CL にそのまま書けば `*LIBL` で解決される。テストのライブラリー・リストには既に
  `RPGUNIT`・テストのライブラリー・利用者のリストが並ぶ（`vscode-extension/src/testing/testController.ts` の
  `testLibraryList`）。
- **合成はキー単位の置き換え**（decisions.md D5）。IBM i Testing は `lodash.merge` で、配列を**要素ごと**に
  混ぜる（`.vscode` が `[A,B]`、最寄りが `[C]` なら `[C,B]`）。これは利用者が意図しない結果になりやすいので
  採らず、最寄りに同じキーがあれば配列ごと置き換える。

## 対象範囲

- 新規: `vscode-extension/src/testing/testingConfig.ts`
- 変更: `vscode-extension/src/testing/rpgunitCommands.ts`（`bindingDirectories` を追加、`BNDSRVPGM` の修飾をやめる）
- 変更: `vscode-extension/src/testing/testController.ts`（`runFile` でバインド指定を解決して渡す）
- 新規: `vscode-extension/test/unit/testingConfig.test.ts`
- 変更: `vscode-extension/test/unit/rpgunitCommands.test.ts`、`testController.test.ts`、`test/support/vscode-stub.js`（`getWorkspaceFolder`・`fs.stat` で足りない分）
- 変更: `vscode-extension/dev/rpgunit-e2e.mjs`（バインドのシナリオを追加）

## 依拠する既存の事実

- `RUCRTRPG` の `BNDSRVPGM` は `MAX(50)`、`BNDDIR` は `MAX(10)`。どちらも修飾名で、ライブラリーの既定は
  `*LIBL`。特殊値は `BNDSRVPGM` が `*LIBL`、`BNDDIR` が `*LIBL`・`*CURLIB`・`*USRLIBL`
  ——実機（SR-OSAKA）の `RPGUNIT/QCMD(RUCRTRPG)` のコマンド定義ソースを 2026-09-26 に直読。
- IBM i Testing の `testing.json`: `rpgunit.rucrtrpg.bndSrvPgm` / `bndDir` は文字列の配列
  （`IBM/vscode-ibmi-testing` の `schemas/testing.json`）。探し方はテストファイルのディレクトリから親へ
  ワークスペースフォルダーまで遡った最寄りと `<ワークスペース>/.vscode/testing.json`
  （同 `api/config.ts` の `LocalConfigHandler.findConfig` / `getConfig`）。いずれも 2026-09-26 に直読。
- `buildCreateTestCommand` は現在、修飾の無い `bindServicePrograms` をテストのライブラリーで補う
  （`vscode-extension/src/testing/rpgunitCommands.ts` の `buildCreateTestCommand`）。既存の単体テストが
  その挙動を固定している（`test/unit/rpgunitCommands.test.ts`「BNDSRVPGM はライブラリー修飾の無い名前に
  library を補う」）。**この work で意図して変える**（D4）。
- テストファイル単位の処理は `runFile`（`testController.ts`）。コンパイル失敗は `erroredAll` でそのファイルの
  子テストを errored にして戻る形が既にある。
- IBM i のオブジェクト名の規則は `resolveMemberTarget` が `^[A-Z$#@][A-Z0-9_$#@]{0,9}$` で検査している
  （`vscode-extension/src/sync/memberTarget.ts` の `IBM_I_OBJECT_NAME`）。`tools/run-rpgunit.mjs` の `--bnd` は
  `.` も許している。requirements FR5 は `.` を含む規則で定義したので、こちらに合わせる。

## インターフェース / データ構造

```ts
// src/testing/testingConfig.ts
export interface BindingSpec {
  readonly servicePrograms: readonly string[];   // 大文字化済み。`NAME` または `LIB/NAME`
  readonly bindingDirectories: readonly string[];
}

export interface TestingConfigSource {
  readonly path: string;        // メッセージに出すパス（ワークスペース相対）
  readonly text?: string;       // ファイルの中身
  readonly readError?: string;  // 存在するのに読めなかった理由（text とどちらか一方）
}

export type ResolveBindingResult =
  | { readonly ok: true; readonly binding: BindingSpec }
  | { readonly ok: false; readonly path: string; readonly reason: string };

/** 純粋関数。`nearest` が最寄り、`global` が `.vscode/testing.json`。どちらも無ければ undefined。 */
export function resolveBinding(
  nearest: TestingConfigSource | undefined,
  global: TestingConfigSource | undefined
): ResolveBindingResult;

/** I/O。テストファイルの URI から最寄りと `.vscode` の `testing.json` を探して読む。 */
export async function readTestingConfigs(fileUri: vscode.Uri): Promise<{
  nearest?: TestingConfigSource; global?: TestingConfigSource;
}>;
```

```ts
// src/testing/rpgunitCommands.ts（追加・変更）
export interface CreateTestCommandOptions {
  // …既存…
  readonly bindServicePrograms?: readonly string[];   // 修飾はしない（そのまま渡す）
  readonly bindingDirectories?: readonly string[];    // 追加
}
// 出力: … SRCMBR(X) BNDSRVPGM(A LIB/B) BNDDIR(D) TGTCCSID(0)
```

## 振る舞いの詳細

1. `runFile` はアップロード前に `readTestingConfigs(fileItem.uri)` → `resolveBinding(nearest, global)` を呼ぶ。
   `ok: false` なら `erroredAll(run, children, "testing.json の設定が正しくありません: <path>\n<reason>")` で戻る
   （**アップロードもコンパイルもしない**。AC5）。
2. `ok: true` なら `buildCreateTestCommand({ …, bindServicePrograms, bindingDirectories })`。空配列なら
   `BNDSRVPGM` / `BNDDIR` を付けない（AC9）。
3. 探し方（`readTestingConfigs`）:
   - `vscode.workspace.getWorkspaceFolder(fileUri)` が無ければ何も読まない（両方 undefined。FR1）。
   - テストファイルごとに呼ぶので、別の最寄りを持つファイルの値は混ざらない（AC1）。誤りで errored になるのも
     その `testing.json` を使うファイルだけ（AC5）。
   - テストファイルのディレクトリから始めて、`testing.json` があればそれを最寄りとして止まる。無ければ親へ。
     **ワークスペースフォルダーのルートまで**見て、その外には出ない（AC1）。
   - `<ワークスペース>/.vscode/testing.json` を別に読む。
   - 存在しないファイルは undefined。存在するのに読めない（ディレクトリである・読み取りエラー）ときは、
     中身の代わりに読めなかった理由を持たせ、`resolveBinding` が errored の理由として返す。
     存在して中身が不正なら `resolveBinding` が理由を返す。
4. `resolveBinding` の検証（FR5）。**合成の前に、渡された各ファイルに対して**行い、最初に見つかった誤りを
   そのファイルのパスとともに返す（D6。上書きされる `.vscode` 側の誤りも返す）。検査は最寄り→`.vscode` の順:
   - (a) 読めない・`JSON.parse` 失敗 → `JSON として読めません: <例外の文>`
   - (b) 最上位・`rpgunit`・`rpgunit.rucrtrpg` が存在してオブジェクトでない（配列・文字列・数値・null を含む）→
     `<キーのパス> はオブジェクトにしてください`。`bndSrvPgm` / `bndDir` が存在して文字列の配列でない →
     `<キー> は文字列の配列にしてください`
   - (c) 要素を前後の空白を除いて大文字にし、`^(?:(LIB)\/)?(NAME)$` に合わない。`NAME` = `[A-Z$#@][A-Z0-9$#@_.]{0,9}`。
     合格した要素は**大文字にした形**で `BindingSpec` に入れる（AC4）。
     `LIB` は `NAME` か特殊値（`bndSrvPgm`: `*LIBL`／`bndDir`: `*LIBL` `*CURLIB` `*USRLIBL`）。
   - (d) 件数が 50（`bndSrvPgm`）／10（`bndDir`）を超える。
   - ほかのキー（`rucalltst` など）は見ない（AC8）。`rpgunit` や `rucrtrpg` が無ければ、そのファイルは
     指定無しとして扱う。
   - 合成（FR3）: 両方が検査に通ったあと、キーごとに、最寄りにあれば最寄り、無ければ `.vscode` の値。

## ドメイン固有の考慮

- CL の修飾名のリストは空白区切り（`BNDSRVPGM(A B)`）。`tools/run-rpgunit.mjs` と同じ。
- バインドしたサービスプログラムは実行時（`RUCALLTST`）にも解決される。`RUCALLTST` も同じライブラリー・リストで
  実行している（`testController.ts` の `runFile`）ので追加の対応は不要——実機 E2E で確かめる。
- 実機の `RUCRTRPG` が作るサービスプログラムの作成オプションは `*RSLVREF`
  （`20260922-rpgunit-vscode-testing` の T1 実機確認で読んだ `T1PROBE2` のコンパイル・リスト「Creation options」）。
  バインドが無いと未解決の参照でサービスプログラムの作成が失敗するはずで、E2E の対照（AC7）に使う。
- **`BNDDIR` が 7.3 ＋ v6.0.2.r で効かなかった場合**（requirements「未確定事項」）: `bndDir` をこの work の
  対象から外し（読み取り・`BNDDIR` の付与を消す）、理由を decisions.md に残して requirements を差し戻す。
  壊れたまま出さない。

## エラー処理 / 異常系

| 状況 | 扱い |
|---|---|
| `testing.json` が無い | 指定無し（従来どおり） |
| JSON として読めない／形が不正／名前が不正／件数超過 | そのファイルのテストを errored（パスと理由）。コンパイルしない |
| `testing.json` が存在するのに読めない | そのファイルのテストを errored（パスと理由） |
| 指定したサービスプログラムが実機に無い | `RUCRTRPG` が失敗し、既存のコンパイル失敗の扱い（ジョブログ付きで errored） |
| ワークスペース外のファイル | `testing.json` を読まない |

## 受け入れ基準との対応

- AC1: `readTestingConfigs` が同じディレクトリ→親→ワークスペースのルートまで探し、`.vscode/testing.json` も読む。
  入力はテストファイルの URI とワークスペースフォルダー。`resolveBinding` → `buildCreateTestCommand` で `BNDSRVPGM` に入る。
- AC2: 同じ経路で `bndDir` が `BNDDIR` に入る。
- AC3: `resolveBinding` がキーごとに最寄りを優先する。入力は 2 つの `TestingConfigSource`。
- AC4: `resolveBinding` が要素を大文字にし（4(c)）、`buildCreateTestCommand` が修飾せずに渡す（D4）。
- AC5: `resolveBinding` が (a)〜(d) で `ok: false` を返し、`runFile` がアップロード前に errored にする。
- AC6: `testing.json` が無ければ `BindingSpec` は空で、コマンドは従来どおり。
- AC7: `dev/rpgunit-e2e.mjs` に対照（指定無し）と `bndSrvPgm`・`bndDir` のシナリオを足す。
  `bndDir` のシナリオが通らなければ上記「ドメイン固有の考慮」の分岐に従う。
  テスト対象のサービスプログラムとバインディング・ディレクトリは E2E が実機に作り、終わったら消す。
- AC8: `resolveBinding` は `rpgunit.rucrtrpg.bndSrvPgm` / `bndDir` 以外を見ない。
- AC9: 空配列・キー無しでは `buildCreateTestCommand` が `BNDSRVPGM` / `BNDDIR` を付けない。
