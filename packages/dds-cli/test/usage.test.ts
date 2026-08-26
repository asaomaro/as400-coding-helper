import { strict as assert } from "node:assert";
import { test } from "node:test";
import { main } from "../src/main.js";

test("--help は 0 で終わる", () => {
  assert.equal(main(["--help"]), 0);
});

test("引数なしは使用法エラー(1)", () => {
  assert.equal(main([]), 1);
});

test("未知のコマンドは 1", () => {
  assert.equal(main(["nope"]), 1);
});

test("計画済みだが未実装のコマンドは 1", () => {
  assert.equal(main(["parse"]), 1);
});
