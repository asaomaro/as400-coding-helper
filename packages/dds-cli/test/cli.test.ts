import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const BIN = join(__dirname, "..", "..", "bin", "dds.js");

let work: string;

before(() => {
  work = mkdtempSync(join(tmpdir(), "dds-cli-"));
});

after(() => {
  rmSync(work, { recursive: true, force: true });
});

/** CLI を実行し、終了コードと出力を返す。 */
function run(
  args: readonly string[],
  input?: string
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], {
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return {
      code: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? ""
    };
  }
}

function fixture(name: string, body: string): string {
  const path = join(work, name);
  writeFileSync(path, body, "utf8");
  return path;
}

const SAMPLE = [
  "     A                                      DSPSIZ(24 80 *DS3)",
  "     A          R REC1",
  "     A                                  3  2'CODE'",
  "     A            FLD1           5A  O  3  8",
  ""
].join("\n");

describe("終了コードの規約", () => {
  test("--help は 0", () => {
    assert.equal(run(["--help"]).code, 0);
  });

  test("引数なしは 1（使用法）", () => {
    assert.equal(run([]).code, 1);
  });

  test("未知のコマンドは 1", () => {
    assert.equal(run(["nope"]).code, 1);
  });

  test("存在しないファイルは 1", () => {
    assert.equal(run(["parse", join(work, "missing.dspf")]).code, 1);
  });

  test("検証違反があると 3", () => {
    // 70 桁から 20 桁 → 89 桁で画面を越える
    const path = fixture(
      "overflow.dspf",
      [
        "     A          R REC1",
        "     A            BAD           20A  O  3 70",
        ""
      ].join("\n")
    );
    const result = run(["validate", path]);
    assert.equal(result.code, 3);
    assert.ok(result.stdout.includes("DDS7101"));
  });

  test("警告だけなら 0（実機もコンパイルを通すため）", () => {
    const path = fixture(
      "adjacent.dspf",
      [
        "     A          R REC1",
        "     A                                  3  2'ABCDE'",
        "     A            FLD1           5A  O  3  7",
        ""
      ].join("\n")
    );
    const result = run(["validate", path]);
    assert.equal(result.code, 0, "警告で落としている");
    assert.ok(result.stdout.includes("DDS7103"));
  });
});

describe("parse", () => {
  test("--json にアイテム ID が含まれる（patch の対象指定に要る）", () => {
    const path = fixture("parse.dspf", SAMPLE);
    const result = run(["parse", path, "--json"]);
    assert.equal(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(
      parsed.items.map((i: { id: string }) => i.id),
      ["REC1#1", "REC1#2"]
    );
    assert.equal(parsed.items[1].name, "FLD1");
    assert.equal(parsed.items[1].pos, 8);
  });

  test("人が読む形でも ID を出す", () => {
    const path = fixture("parse2.dspf", SAMPLE);
    const result = run(["parse", path]);
    assert.ok(result.stdout.includes("REC1#1"));
  });
});

describe("render", () => {
  test("コアと同じ出力になる", () => {
    const path = fixture("render.dspf", SAMPLE);
    const result = run(["render", path, "--record", "REC1"]);
    assert.equal(result.code, 0);
    const rows = result.stdout.split("\n");
    assert.equal(rows[2].slice(1, 5), "CODE");
    assert.equal(rows[2].slice(7, 12), "XXXXX");
    assert.equal(rows[0].length, 80);
  });
});

describe("patch", () => {
  const ops = JSON.stringify([
    { op: "moveItem", id: "REC1#2", line: 5, pos: 30 }
  ]);

  test("既定は --stdout でファイルを書き換えない", () => {
    const path = fixture("patch1.dspf", SAMPLE);
    const before = readFileSync(path, "utf8");
    const result = run(["patch", path, "--ops", "-"], ops);
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes("  5 30"));
    assert.equal(readFileSync(path, "utf8"), before, "書き換えている");
  });

  test("--write でファイルを書き換える", () => {
    const path = fixture("patch2.dspf", SAMPLE);
    const result = run(["patch", path, "--ops", "-", "--write"], ops);
    assert.equal(result.code, 0);
    assert.ok(readFileSync(path, "utf8").includes("  5 30"));
  });

  test("対象行以外がバイト不変", () => {
    const path = fixture("patch3.dspf", SAMPLE);
    run(["patch", path, "--ops", "-", "--write"], ops);
    const after = readFileSync(path, "utf8").split("\n");
    const before = SAMPLE.split("\n");
    const changed = before
      .map((line, index) => (line === after[index] ? -1 : index))
      .filter(index => index >= 0);
    assert.deepEqual(changed, [3]);
  });

  test("エラー級の違反は 3 で拒否する", () => {
    const path = fixture("patch4.dspf", SAMPLE);
    const bad = JSON.stringify([
      { op: "moveItem", id: "REC1#2", line: 3, pos: 78 }
    ]);
    const result = run(["patch", path, "--ops", "-", "--write"], bad);
    assert.equal(result.code, 3);
    assert.equal(readFileSync(path, "utf8"), SAMPLE, "拒否したのに書き換えている");
  });

  test("--ops を省略すると 1", () => {
    const path = fixture("patch5.dspf", SAMPLE);
    assert.equal(run(["patch", path]).code, 1);
  });
});

describe("init（AC7 に必要な足場作り）", () => {
  test("作った DDS が validate を通り parse できる", () => {
    const path = join(work, "new.dspf");
    assert.equal(run(["init", path, "--record", "NEWREC"]).code, 0);
    assert.equal(run(["validate", path]).code, 0);

    const parsed = JSON.parse(run(["parse", path, "--json"]).stdout);
    assert.deepEqual(
      parsed.records.map((r: { name: string }) => r.name),
      ["NEWREC"]
    );
  });

  test("不正な様式名は 1 で弾く", () => {
    const path = join(work, "bad.dspf");
    assert.equal(run(["init", path, "--record", "1BAD"]).code, 1);
  });

  test("--record を省略すると 1", () => {
    const path = join(work, "norec.dspf");
    assert.equal(run(["init", path]).code, 1);
  });
});

describe("Shift_JIS の読み書き（03 からの申し送り）", () => {
  const japanese = [
    "     A          R REC1",
    "     A                                  3  2'部門名'",
    "     A            FLD1           5A  O  3 11",
    ""
  ].join("\n");

  test("Shift_JIS で読み書きして往復する", () => {
    const path = join(work, "sjis.dspf");
    // Shift_JIS で書き出す（Node には encoder が無いので CLI と同じ手法で用意）
    writeFileSync(path, sjisBytes(japanese));

    const parsed = JSON.parse(run(["parse", path, "--json"]).stdout);
    assert.equal(parsed.encoding, "shift_jis");
    assert.equal(parsed.items[0].text, "部門名");

    const result = run(
      ["patch", path, "--ops", "-", "--write"],
      JSON.stringify([{ op: "moveItem", id: "REC1#2", line: 5, pos: 20 }])
    );
    assert.equal(result.code, 0);

    // 書き戻したファイルが**まだ Shift_JIS**であること（勝手に UTF-8 化しない）
    const again = JSON.parse(run(["parse", path, "--json"]).stdout);
    assert.equal(again.encoding, "shift_jis", "エンコーディングが変わっている");
    assert.equal(again.items[0].text, "部門名");
    assert.equal(again.items[1].pos, 20);
  });
});

/** テスト用の Shift_JIS エンコーダ（CLI と同じく TextDecoder から逆引きする）。 */
function sjisBytes(text: string): Buffer {
  const decoder = new TextDecoder("shift_jis", { fatal: true });
  const table = new Map<string, number[]>();
  for (let b = 0; b < 0x80; b += 1) {
    try {
      table.set(decoder.decode(new Uint8Array([b])), [b]);
    } catch {
      /* 不正なバイト */
    }
  }
  for (const [from, to] of [
    [0x81, 0x9f],
    [0xe0, 0xfc]
  ] as const) {
    for (let lead = from; lead <= to; lead += 1) {
      for (let trail = 0x40; trail <= 0xfc; trail += 1) {
        try {
          const ch = decoder.decode(new Uint8Array([lead, trail]));
          if (!table.has(ch)) table.set(ch, [lead, trail]);
        } catch {
          /* 不正な組み合わせ */
        }
      }
    }
  }
  const bytes: number[] = [];
  for (const ch of text) {
    const encoded = table.get(ch);
    assert.ok(encoded, `Shift_JIS で表せない: ${ch}`);
    bytes.push(...encoded!);
  }
  return Buffer.from(bytes);
}

describe("CLI 経路でも実世界の DDS が壊れない", () => {
  const REAL = join(
    __dirname, "..", "..", "..", "dds-core", "test", "fixtures", "real-gridtst3.dspf"
  );
  const GOLDEN_SRC = join(
    __dirname, "..", "..", "..", "dds-core", "test", "fixtures", "golden-a.dspf"
  );
  const GOLDEN = join(
    __dirname, "..", "..", "..", "dds-core", "test", "golden", "golden-a.screen.txt"
  );

  test("実機由来の 86 行 DDS を CLI で patch しても、対象行以外がバイト不変", () => {
    const path = join(work, "real.dspf");
    const original = readFileSync(REAL);
    writeFileSync(path, original);

    // 'GRIDTST3' の定数（MAIN#1）を 1 行 10 桁へ動かす
    const result = run(
      ["patch", path, "--ops", "-", "--write"],
      JSON.stringify([{ op: "moveItem", id: "MAIN#1", line: 1, pos: 10 }])
    );
    assert.equal(result.code, 0, result.stderr);

    const after = readFileSync(path);
    assert.equal(after.length, original.length, "バイト長が変わっている");

    const before = original.toString("utf8").split("\r\n");
    const now = after.toString("utf8").split("\r\n");
    const changed = before
      .map((line, index) => (line === now[index] ? -1 : index))
      .filter(index => index >= 0);
    assert.deepEqual(changed, [2], "変わった行が対象行だけではない");
  });

  test("CLI の render が実機ゴールデンと一致する", () => {
    const result = run(["render", GOLDEN_SRC, "--record", "GA"]);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, readFileSync(GOLDEN, "utf8"));
  });

  test("--all で全様式を重ねる / 省略時は最初の様式", () => {
    const path = fixture(
      "multi.dspf",
      [
        "     A          R R1",
        "     A                                  3  2'AAAAAAAAAA'",
        "     A          R R2",
        "     A                                  3  2'BBB'",
        ""
      ].join("\n")
    );
    const first = run(["render", path]).stdout.split("\n")[2];
    const all = run(["render", path, "--all"]).stdout.split("\n")[2];
    assert.equal(first.slice(1, 11), "AAAAAAAAAA");
    assert.ok(all.startsWith(" BBB"), "--all で重なっていない");
  });

  test("--rows / --cols で画面の大きさを変えられる", () => {
    const path = fixture("wide.dspf", SAMPLE);
    const rows = run(["render", path, "--rows", "27", "--cols", "132"]).stdout.split("\n");
    assert.equal(rows[0].length, 132);
    assert.equal(rows.length, 28);
  });
});

describe("矛盾する指定と、解釈できないファイル（review should-1 / should-2）", () => {
  test("--write と --stdout の同時指定は 1 で拒否し、書き換えない", () => {
    const path = fixture("conflict.dspf", SAMPLE);
    const result = run(
      ["patch", path, "--ops", "-", "--write", "--stdout"],
      JSON.stringify([{ op: "moveItem", id: "REC1#2", line: 5, pos: 30 }])
    );
    assert.equal(result.code, 1);
    assert.equal(readFileSync(path, "utf8"), SAMPLE, "拒否したのに書き換えている");
  });

  test("DDS でないファイルは 2（パース失敗）で落ちる", () => {
    const path = fixture("notdds.txt", "これは DDS ではありません\n");
    for (const cmd of ["parse", "validate", "render"]) {
      const result = run([cmd, path]);
      assert.equal(result.code, 2, `${cmd} が 2 を返していない`);
      assert.ok(result.stderr.includes("解釈できる内容がありません"));
    }
  });

  test("様式はあるがアイテムが無い DDS は成功する（init 直後の状態）", () => {
    const path = join(work, "empty-rec.dspf");
    assert.equal(run(["init", path, "--record", "REC9"]).code, 0);
    assert.equal(run(["parse", path]).code, 0);
    assert.equal(run(["validate", path]).code, 0);
  });

  test("空ファイルは 0（内容が無いだけで、解釈の失敗ではない）", () => {
    const path = fixture("empty.dspf", "");
    assert.equal(run(["parse", path]).code, 0);
  });
});
