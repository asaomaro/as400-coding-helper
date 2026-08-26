import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DDS_CORE_VERSION } from "../src/index.js";

test("dds-core をビルド成果物として読み込める", () => {
  assert.equal(typeof DDS_CORE_VERSION, "string");
});
