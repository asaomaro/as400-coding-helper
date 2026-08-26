import { strict as assert } from "node:assert";
import { resolveDialectFromPath } from "../../src/prompter/dialect";

suite("RPG dialect resolution", () => {
  test("derives ile from .rpgle and rpg3 from .rpg by default", () => {
    assert.equal(resolveDialectFromPath("/src/PGM.rpgle"), "ile");
    assert.equal(resolveDialectFromPath("/src/PGM.rpg"), "rpg3");
  });

  test("is case-insensitive on the path extension", () => {
    assert.equal(resolveDialectFromPath("C:/SRC/PGM.RPGLE"), "ile");
    assert.equal(resolveDialectFromPath("C:/SRC/PGM.RPG"), "rpg3");
  });

  test("prefers the longer extension (.rpgle over .rpg)", () => {
    // ".rpgle" must not be matched as ".rpg".
    assert.equal(resolveDialectFromPath("/a/b/order.rpgle"), "ile");
  });

  test("falls back to ile for unknown extensions", () => {
    assert.equal(resolveDialectFromPath("/src/notes.txt"), "ile");
    assert.equal(resolveDialectFromPath("/src/noext"), "ile");
  });

  test("honors overrides (treat .rpg as ile)", () => {
    assert.equal(
      resolveDialectFromPath("/src/PGM.rpg", { ".rpg": "ile" }),
      "ile"
    );
  });

  test("normalizes override keys (missing dot, casing, whitespace)", () => {
    assert.equal(
      resolveDialectFromPath("/src/PGM.rpg", { "RPG": "ile" }),
      "ile"
    );
    assert.equal(
      resolveDialectFromPath("/src/PGM.rpg", { " .RPG ": "ILE" }),
      "ile"
    );
  });

  test("ignores invalid override values and keeps defaults", () => {
    assert.equal(
      resolveDialectFromPath("/src/PGM.rpg", { ".rpg": "bogus" }),
      "rpg3"
    );
    assert.equal(
      resolveDialectFromPath("/src/PGM.rpg", { ".rpg": 42 as unknown as string }),
      "rpg3"
    );
  });

  test("supports adding a new extension via override", () => {
    assert.equal(
      resolveDialectFromPath("/src/PGM.rpg36", { ".rpg36": "rpg3" }),
      "rpg3"
    );
  });
});
