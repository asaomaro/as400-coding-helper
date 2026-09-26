import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * RPGUnit の共通部品は `tools/run-rpgunit.mjs`（素の Node）からも読まれる。`vscode` を import すると
 * 道具が読み込みの時点で落ちる。単体テストは `vscode` をスタブに差し替えて走るので、動かして確かめても
 * 気づけない——ソースの文面で見張る。
 */
const CORE_FILES = [
  "src/testing/rpgunitCommands.ts",
  "src/testing/resultParser.ts",
  "src/testing/testingConfigCore.ts",
  "src/testing/suiteRunner.ts",
  "src/sync/memberTarget.ts"
];

// out-test/test/unit から見た拡張機能のルート
const ROOT = join(__dirname, "..", "..", "..");

suite("RPGUnit の共通部品は vscode に依存しない", () => {
  for (const file of CORE_FILES) {
    test(file, () => {
      const source = readFileSync(join(ROOT, file), "utf8");
      assert.doesNotMatch(source, /(?:from|import)\s*\(?\s*["']vscode["']|require\(\s*["']vscode["']\s*\)/, `${file} が vscode を import している`);
      // 共通部品どうしの import（`from` の無い `import "./x"`・動的 `import("./x")` を含む）は、共通部品のファイルだけを指すこと（間接的に vscode を引き込まない）
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
        const target = join(file, "..", match[1]).replace(/\\/g, "/") + ".ts";
        assert.ok(CORE_FILES.includes(target), `${file} が共通部品でない ${target} を import している`);
      }
    });
  }
});
