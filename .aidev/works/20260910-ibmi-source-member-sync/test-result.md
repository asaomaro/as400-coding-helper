# テスト結果: IBM i ソースメンバー同期と可視 SEU 色属性

## 実行したもの

- `cd vscode-extension && npm test` — 1,263 passed / 0 failed / 0 skipped
- `cd vscode-extension && npm run compile:all` — pass
- `cd vscode-extension && node ../docs/origin/verify-contributes.mjs` — pass（対象拡張子13件）
- `node --check .aidev/works/20260910-ibmi-source-member-sync/verify/probe-seu-source-color.mjs` — pass
- `cd vscode-extension && npm run test:integration` — 4 passed / 0 failed / 0 skipped
- `SEU_PROBE_MODE=map|red|dbcs ... probe-seu-source-color.mjs` — 3 passed / 0 failed / 0 skipped

### US4（AC12〜AC18: アップロード時のファイル名からのテキスト記述・SRCTYPE 反映）追加分

- `rm -rf vscode-extension/out vscode-extension/out-test && cd vscode-extension && npm run compile` — pass（改名・型変更直後のクリーン実行。AGENTS.md の規約どおり）
- `cd vscode-extension && npm test` — **1,279 passed / 0 failed / 0 skipped**（既存 1,263 件 + 追加 16 件。全件緑で AC1〜AC11・AC-I1〜AC-I5 の回帰も確認）
- `cd vscode-extension && npm run compile:all` — pass
- `aidev smoke` — pass（exit 0, 2 本）。本機能は VS Code command の変更のみで新しい CLI 入口を追加していないため `smokeCommands` への追加は不要（既存2経路のまま）
- 実機での `CHGPFM`/新規メンバー作成/全角テキスト記述の確認 — **未実施**（後述「未検証の穴」）

### review ラウンド3 の指摘修正後の再検証

- `rm -rf vscode-extension/out vscode-extension/out-test && cd vscode-extension && npm run compile` — pass
- `cd vscode-extension && npm test` — **1,280 passed / 0 failed / 0 skipped**（`escapeForRemoteShellDoubleQuoted` 追加分のテスト1件を含む）
- `aidev smoke` — pass (exit 0, 2 本)
- 修正前（`escapeForRemoteShellDoubleQuoted` の適用を一時的に外した状態）で新規テストが実際に fail することを確認してから元に戻した（AGENTS.md の「テストを足したら、直す前の状態に戻して落ちることを確かめる」規約に従う）。

## 受け入れ基準ごとの判定

- AC1: pass — target の4 segment/IBM i object name 検証と workspace 内外の command 分岐を unit test。
- AC2: pass — marker→wire、LF 正規化、SFTP close→`CPYFRMSTMF` の順序は fake transport test、実機 red/map probe で確認。
- AC3: pass — wire→marker、EOL 正規化、`WorkspaceEdit.replace`、save 成否は fake transport test、実機 map/dbcs probe で確認。
- AC4: pass — `ssh2` のみを runtime dependency とし、SecretStorage と host-key validation を unit/static check。SHA-256 hex は大小文字非区別、`SHA256:` Base64 は完全一致で照合する回帰を追加。
- AC5: pass — 4 command と対象拡張子13件の editor/context 導線を `verify-contributes.mjs` で検証。
- AC6: pass — settings/secret の不足時に transport を開始しないこと、Base64 fingerprint の大小文字だけが異なる値を host-key として拒否することを unit test。
- AC7: pass — `memberSync.ts` / sync / 色装飾から save listener が無いことを静的検査。
- AC8: pass — marker 変換が DBCS を変更しない unit test と、`DBFCCSID(*FILE)` の実機 DBCS 往復を確認。
- AC9: pass — `U+0088 ⇄ Ŕ`、red decoration range、SOSI 共存を unit / extension host integration で確認。
- AC10: pass — `Ŕ → U+0088` と upload payload を unit test、IBM i source byte x'28' の実機復元を red probe で確認。
- AC11: pass — 7基底色の table-driven round trip と、実機 `map` probe の source byte/wire 値を比較。
- AC-I1: pass — command palette / editor context の明示 command のみを登録し、処理成功後の通知を unit test。
- AC-I2: pass — confirmation dialog と save listener を追加せず、command 実行だけが transfer を開始することを static/unit check。
- AC-I3: pass — manifest command と文書中 marker の双方を unit test。
- AC-I4: pass — 開始時 snapshot document を再表示することを fake transport test。
- AC-I5: pass — 対象 scope、対象外解除、設定無効化を unit test、SOSI 共存を extension host integration で確認。
- AC12: pass — `resolveMemberTarget` が最初の `-` でメンバー名とテキスト記述を分割し、`transport.upload` の `attributes.textDescription` へ渡ることを unit test で確認（`memberTarget.test` の分割系テスト、command 層の「ファイル名のテキスト記述と拡張子由来の SRCTYPE を transport へ渡す」テスト）。`CHGPFM` へ渡す際の CL 文字列リテラル（アポストロフィ）と remote shell 二重引用符（`\` `"` `$` `` ` ``）の両層のエスケープ・往復も unit test で確認（review ラウンド3・decisions.md D10）。IBM i 側で正しく反映されるかは実機未検証（後述）。
- AC13: pass — `-` 区切りが無いファイル名では `textDescription` が `undefined` になり、`CHGPFM` の `TEXT(...)` を省略することを unit test で確認（transport 層「テキスト記述が無ければ CHGPFM に TEXT(...) を付けない」テスト）。
- AC14: pass — `deriveSourceType` が `TARGET_EXTENSIONS` 全拡張子を大文字化し、`textDescription` の有無に関わらず `CHGPFM ... SRCTYPE(...)` を毎回呼ぶことを unit test で確認。
- AC15: pass — メンバー名規則違反（10文字超過・数字始まり・使用不可文字）のファイル名で `resolveMemberTarget` が `reason: "memberName"` を返し、command が接続前にエラー通知して transport factory を呼ばないことを unit test で確認。
- AC16: pass — テキスト記述が50文字を超えるファイル名で `reason: "textDescription"` を返し、同様に接続前で中止することを unit test で確認。ちょうど50文字は許容されることも確認。
- AC17: **未検証（机上のみ）** — `CPYFRMSTMF` が宛先メンバー未存在時に自動作成する挙動は IBM Documentation 原典（research.md F8）から確認済みで、既存の `MBROPT(*REPLACE)` コマンド構築自体は変更していない。しかし本 work では実機でこの経路を実行できていない。
- AC18: **未検証（机上のみ）** — ライブラリー／ソース物理ファイル未存在時に `CPYFRMSTMF` が失敗し既存の `kind: "copy"` 分類・通知経路に乗ることは fake ssh client の unit test（コマンド呼び出し順序）で確認したが、実機が実際にどのメッセージで失敗するかは確認できていない。

## 失敗の証跡

### US4（AC12〜AC18）追加分

このラウンドでは、実装した `resolveMemberTarget` / `deriveSourceType` / `ibmiSourceTransport.upload` / command ハンドラーの変更に対する assertion failure は発生していない。実装過程で1件、既存テストの分類が実装後の実際の挙動（`memberName` 理由）と食い違っていたため、テスト側の期待値を修正した（`TEST.RPG.EXTRA` のような余分な `.` を含むファイル名は `pathShape` ではなく `memberName` として拒否される——`.` がメンバー名部分に残り IBM i object name 規則に違反するため）。これはテストの誤りであり実装の欠陥ではない。

製品の assertion failure は発生していない。最初の sandbox 環境では以下の環境依存失敗が発生したが、フルアクセス環境へ切り替え後に同一の integration / probe を再実行し、いずれも成功した。

レビュー修正の回帰テストは、比較を旧実装へ一時的に戻した場合に意図どおり失敗し、修正版へ戻した後の `npm test` では 1,263 件すべて成功した。

```text
$ cd vscode-extension && npm test  # Base64 比較を旧実装へ一時的に戻した状態
  1262 passing
  1 failing

  IBM i source transport
    Base64 host key fingerprint は大文字・小文字の違いを許可しない:
  AssertionError: true !== false
```

```text
$ cd vscode-extension && npm run test:integration
Error retrieving VS Code versions, using already-installed version 1.137.0 Error: getaddrinfo EAI_AGAIN update.code.visualstudio.com
✔ Validated version: 1.137.0
✔ Found existing install in /workspaces/as400-coding-helper/vscode-extension/.vscode-test/vscode-linux-x64-1.137.0
[57:0912/134519.227293:FATAL:content/browser/sandbox_host_linux.cc:41] Check failed: . shutdown: Operation not permitted (1)
Exit code:   SIGTRAP
Failed to run tests TestRunFailedError: Test run terminated with signal SIGTRAP
```

```text
$ cd /workspaces/ts5250 && SEU_PROBE_MODE=map node --env-file=.env --env-file=.env.verify /workspaces/as400-coding-helper/.aidev/works/20260910-ibmi-source-member-sync/verify/probe-seu-source-color.mjs
As400Error: host server connection failed (172.21.10.51:8476): connect EPERM 172.21.10.51:8476 - Local (undefined:undefined)
  code: 'CONNECT_FAILED',
  [cause]: Error: connect EPERM 172.21.10.51:8476 - Local (undefined:undefined)
```

## 起動確認（smoke）

同期機能は VS Code command の追加であり、新しい終了型 CLI 入口は増やしていない。そのため既存の `smokeCommands` を追加せず、ビルド済み DDS CLI の2経路を実行した。

```text
$ node vscode-extension/out/cli/dds.js parse vscode-extension/test/golden/RENDER1.dspf
$ node vscode-extension/out/cli/lint.js vscode-extension/test/golden/RENDER1.dspf
$ node vscode-extension/out/cli/dds.js render --format json vscode-extension/test/golden/GRIDSAMPLE.dspf | grep -q '"gridLines"'
$ node vscode-extension/out/cli/dds.js render --format json vscode-extension/test/golden/GRIDSAMPLE.dspf | grep -q '"gridBoxes"'
smoke: pass (exit 0)
```

## 実機・統合再実行の成功証跡

```text
$ cd /workspaces/ts5250 && SEU_PROBE_MODE=map node --env-file=.env --env-file=.env.verify /workspaces/as400-coding-helper/.aidev/works/20260910-ibmi-source-member-sync/verify/probe-seu-source-color.mjs
mode=map
source-prefix-hex=C120C222C328C430C532C638C73AC8
utf8-hex=41C28042C28243C28844C290451646C29847C29A48C28E0D0A

$ cd /workspaces/ts5250 && SEU_PROBE_MODE=red node --env-file=.env --env-file=.env.verify /workspaces/as400-coding-helper/.aidev/works/20260910-ibmi-source-member-sync/verify/probe-seu-source-color.mjs
mode=red
source-prefix-hex=C1C2C328C4C5C6
utf8-hex=414243C2884445460D0A

$ cd /workspaces/ts5250 && SEU_PROBE_MODE=dbcs node --env-file=.env --env-file=.env.verify /workspaces/as400-coding-helper/.aidev/works/20260910-ibmi-source-member-sync/verify/probe-seu-source-color.mjs
mode=dbcs
utf8-hex=41C288E9A1A7E5AEA2420D0A

$ cd /workspaces/as400-coding-helper/vscode-extension && npm run test:integration
  SEU 色 marker Integration
    ✔ 色 marker と SOSI を同じ対象文書で有効にしても本文を変更しない
  Sample Integration Test Suite
    ✔ integration placeholder
  F4 Prompter Integration
    ✔ F4 プロンプターが例外なく起動する（CL）
    ✔ 定義の無い行でも例外にならない
  4 passing (3s)
Exit code: 0
```

## 未検証の穴（skip / 環境不足）

- なし（AC1〜AC11, AC-I1〜AC-I5。初回 delivery 時点）。

### US4（AC12〜AC18）追加分

現セッションは IBM i 実機に到達する手段が無い（`PUB400_USER`/`PUB400_PASSWORD` 未設定、`sshpass` 未導入、`ts5250` MCP は `CONNECT_TIMEOUT` で接続失敗）。そのため次の3点は fake ssh client による机上検証（コマンド文字列・呼び出し順序・エスケープの unit test）までで、**実機での動作確認ができていない**（decisions.md D9）。

- **AC17**: `CPYFRMSTMF` が宛先メンバー未存在時に自動作成する挙動（IBM Documentation 原典で確認済み、research.md F8）を、実機で実際に新規メンバーが作成されることまでは確認していない。
- **AC18**: ライブラリー／ソース物理ファイル未存在時に実機がどのメッセージ番号で失敗するか、既存の `kind: "copy"` 分類がそのまま「理由の通知」として十分かを未確認。
- **全角文字を含むテキスト記述**（AC12 の一部）: `CHGPFM ... TEXT('...')` は内容コピーが使う `STMFCCSID`/`DBFCCSID` の CCSID 変換を経由しないため、日本語等の全角文字が正しく往復するかは design 時点から未検証（ユーザー承認済みで許容範囲は「全角も許容し実装時に実機検証する」）。

deliver の PR 本文の「既知の制約」へ引き継ぎ、実機に到達できるセッションで確認してから review/deliver 判断を最終化することを推奨する。
