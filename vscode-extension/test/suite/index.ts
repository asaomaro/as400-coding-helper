import * as path from "node:path";
import * as Mocha from "mocha";
import * as glob from "glob";

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "bdd",
    color: true
  });

  const testsRoot = path.resolve(__dirname, "..");

  return new Promise((resolve, reject) => {
    glob("**/*.test.js", { cwd: testsRoot }, (err, files) => {
      if (err) {
        reject(err);
        return;
      }

      for (const file of files) {
        mocha.addFile(path.resolve(testsRoot, file));
      }

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
  });
}

