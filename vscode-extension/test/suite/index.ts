import * as path from "node:path";
import Mocha from "mocha";
import { glob } from "glob";

export async function run(): Promise<void> {
  // テストは suite()/test() で書かれている＝mocha の tdd インターフェース。
  // ここを "bdd" にすると describe()/it() しか生えず、全テストが未定義参照で落ちる。
  const mocha = new Mocha({ ui: "tdd", color: true });

  const testsRoot = path.resolve(__dirname, "..");

  // glob は v9 でコールバック API を廃止した。v10 は Promise を返す。
  const files = await glob("**/*.test.js", { cwd: testsRoot });

  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  await new Promise<void>((resolve, reject) => {
    try {
      mocha.run(failures => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}
