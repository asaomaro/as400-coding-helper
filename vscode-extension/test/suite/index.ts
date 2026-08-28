import { resolve } from "node:path";
import Mocha from "mocha";
import { glob } from "glob";

/**
 * 拡張ホストの中で走らせる統合テストの入口。
 *
 * ## 見ているのは「VSCode が要るもの」だけ
 *
 * 対象は `test/integration` **だけ**。以前は 1 つ上（`..`）を見ており、
 * 単体テストまで拡張ホストの中で走っていた——何が VSCode を要るテストなのかが
 * 分からなくなるうえ、単体は `npm test` の方が速い。
 *
 * ## `tdd`
 *
 * テストは `suite` / `test` で書かれている。`bdd` ではどちらも未定義になる。
 */
export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 20000 });
  const testsRoot = resolve(__dirname, "../integration");

  for (const file of await glob("**/*.test.js", { cwd: testsRoot })) {
    mocha.addFile(resolve(testsRoot, file));
  }

  await new Promise<void>((resolvePromise, reject) => {
    mocha.run(failures => {
      if (failures > 0) reject(new Error(`${failures} tests failed.`));
      else resolvePromise();
    });
  });
}
