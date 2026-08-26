import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parse, applyOps, type PatchOp } from "@as400/dds-core";

const BIN = join(__dirname, "..", "..", "bin", "dds.js");

let work: string;
before(() => {
  work = mkdtempSync(join(tmpdir(), "dds-parity-"));
});
after(() => {
  rmSync(work, { recursive: true, force: true });
});

const SOURCE = [
  "     A                                      DSPSIZ(24 80 *DS3)",
  "     A          R REC1",
  "     A                                  3  2'CODE'",
  "     A            FLD1           5A  O  3  8",
  "     A            FLD2           6S 0B  5  8",
  ""
].join("\n");

/** CLI の patch を --stdout で実行して結果テキストを得る。 */
function viaCli(ops: readonly PatchOp[]): string {
  const path = join(work, `p${Math.abs(hash(JSON.stringify(ops)))}.dspf`);
  writeFileSync(path, SOURCE, "utf8");
  return execFileSync(process.execPath, [BIN, "patch", path, "--ops", "-"], {
    encoding: "utf8",
    input: JSON.stringify(ops)
  });
}

/** コアの applyOps を直接呼んで結果テキストを得る。 */
function viaCore(ops: readonly PatchOp[]): string {
  return applyOps(parse(SOURCE), ops).text;
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * **AC4（CLI が GUI の L1 と同等）の実証。**
 *
 * 「同等にする」のではなく「**同等であることを示す**」のがここの仕事。
 * GUI も CLI も同じ `applyOps` を呼ぶ構造にしてあるので（spec「パッチ操作」）、
 * 両者の結果が一致することを示せば、GUI 側で別途確かめる必要がない。
 *
 * **一致しなければ、CLI がコアを迂回して独自の編集経路を持っているということ。**
 */
describe("AC4: CLI とコアが同じ経路を通ることの実証", () => {
  const cases: ReadonlyArray<readonly [string, PatchOp[]]> = [
    ["moveItem", [{ op: "moveItem", id: "REC1#2", line: 7, pos: 30 }]],
    ["resizeItem", [{ op: "resizeItem", id: "REC1#2", length: 12 }]],
    [
      "addItem（フィールド）",
      [
        {
          op: "addItem",
          record: "REC1",
          item: {
            kind: "field",
            name: "FLD3",
            length: 4,
            dataType: "S",
            decimals: 0,
            usage: "O",
            line: 9,
            pos: 8
          }
        }
      ]
    ],
    [
      "addItem（定数・日本語）",
      [
        {
          op: "addItem",
          record: "REC1",
          item: { kind: "constant", text: "部門名", line: 11, pos: 2 }
        }
      ]
    ],
    ["removeItem", [{ op: "removeItem", id: "REC1#1" }]],
    [
      "複数操作",
      [
        { op: "moveItem", id: "REC1#2", line: 7, pos: 30 },
        { op: "resizeItem", id: "REC1#3", length: 8 }
      ]
    ]
  ];

  for (const [label, ops] of cases) {
    test(`${label} — CLI とコアの結果が一致する`, () => {
      assert.equal(
        viaCli(ops),
        viaCore(ops),
        "CLI がコアを迂回した独自経路を持っている可能性がある"
      );
    });
  }

  test("L1 の 4 操作すべてが CLI から使える", () => {
    // requirement AC4 の「GUI の L1 と同等」は、この 4 種が揃っていることを指す。
    const used = new Set(cases.flatMap(([, ops]) => ops.map(o => o.op)));
    assert.deepEqual(
      [...used].sort(),
      ["addItem", "moveItem", "removeItem", "resizeItem"]
    );
  });
});
