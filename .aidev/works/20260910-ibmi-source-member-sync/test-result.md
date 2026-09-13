# テスト結果: IBM i ソースメンバー同期と可視 SEU 色属性

## 実行したもの

- `cd vscode-extension && npm test` — 1,234 passed / 0 failed / 0 skipped
- `cd vscode-extension && npm run compile:all` — pass
- `cd vscode-extension && node ../docs/origin/verify-contributes.mjs` — pass（対象拡張子13件）
- `node --check .aidev/works/20260910-ibmi-source-member-sync/verify/probe-seu-source-color.mjs` — pass
- `cd vscode-extension && npm run test:integration` — 4 passed / 0 failed / 0 skipped
- `SEU_PROBE_MODE=map|red|dbcs ... probe-seu-source-color.mjs` — 3 passed / 0 failed / 0 skipped

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

## 失敗の証跡

製品の assertion failure は発生していない。最初の sandbox 環境では以下の環境依存失敗が発生したが、フルアクセス環境へ切り替え後に同一の integration / probe を再実行し、いずれも成功した。

レビュー修正の回帰テストは、比較を旧実装へ一時的に戻した場合に意図どおり失敗し、修正版へ戻した後の `npm test` では 1,234 件すべて成功した。

```text
$ cd vscode-extension && npm test  # Base64 比較を旧実装へ一時的に戻した状態
  1233 passing
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

- なし。
