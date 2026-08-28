# 仕様: F4 の統合テストが止まる問題

## 設計方針

### 1. 待つのをやめ、「一定時間 reject しないこと」を見る

見たいのは**開けること**であって「閉じたあとどうなるか」ではない。
送信／取消は WebView の e2e が実物で確かめている。

```ts
async function settlesOrKeepsRunning(promise: Thenable<unknown>, ms: number): Promise<void>
```

解決を待たず、`ms` の間に **reject しなければ通す**。reject したら投げる。

### 2. 器を動く状態にする

| 直すもの | どう直すか |
|---|---|
| 依存 | `@vscode/test-electron` を devDependencies に |
| `runTests.ts` | 新しいパッケージ名を import |
| `suite/index.ts` | `ui: "tdd"` / 対象は `../integration` / 新しい `mocha`・`glob` の使い方 |
| 組み立て | `tsconfig.integration.json`（`out-integration/`） |
| スクリプト | `npm run test:integration` |

### 3. `mocha` に**時間切れ**を持たせる

`timeout: 20000`。**止まる形に戻しても、スイートごと死なずにその 1 本が落ちる。**
これが無いと、次に誰かが `await` を書いたときにまた全体が止まる。

### 4. CI は別ジョブ ＋ `xvfb-run`

Electron を動かすには表示装置が要る。`verify` / `gui-e2e` と並行に走らせる。

## 対象範囲

- `test/runTests.ts` / `test/suite/index.ts` / `test/integration/f4Prompter.test.ts`
- `tsconfig.integration.json`（新規）/ `package.json` / `.gitignore`
- `.github/workflows/prompter-definitions.yml`

## 受け入れ基準との対応

- AC1: 手元で緑（3 passing）。
- AC2: `settlesOrKeepsRunning`。
- AC3: `testsRoot = ../integration`。
- AC4: `timeout: 20000`。戻して確かめる。
- AC5: `integration` ジョブ。
