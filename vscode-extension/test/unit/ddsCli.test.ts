import * as assert from "assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/cli/dds";

/**
 * DDS の CLI（`parse` / `render` / `patch`）。
 *
 * `run()` を直接呼ぶ（プロセスを起こさない）。標準出力は差し替えて捕まえる。
 *
 * **CLI に規則は無い**ので、ここで見るのは「コアの結果が形になって出るか」と
 * 「当てられないものを当てないか」だけ。桁の規則そのものはコア側のテストが見る。
 */

const GOLDEN = join(__dirname, "..", "..", "..", "test", "golden", "RENDER1.dspf");
const REPORT = join(__dirname, "..", "..", "..", "..", "docs", "src", "CUSTRPT.prtf");

/** 標準出力・標準エラーを捕まえて `run()` を回す。 */
function invoke(argv: readonly string[]): { code: number; out: string; err: string } {
  const stdout = process.stdout.write.bind(process.stdout);
  const error = console.error;
  let out = "";
  let err = "";
  (process.stdout as { write: unknown }).write = (chunk: string): boolean => {
    out += chunk;
    return true;
  };
  console.error = (...args: unknown[]): void => {
    err += `${args.join(" ")}\n`;
  };
  try {
    return { code: run(argv), out, err };
  } finally {
    (process.stdout as { write: unknown }).write = stdout;
    console.error = error;
  }
}

function tempCopy(source: string, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "dds-cli-"));
  const path = join(dir, name);
  writeFileSync(path, readFileSync(source, "utf8"), "utf8");
  return path;
}

function writeEdits(dir: string, edits: unknown): string {
  const path = join(dir, "edits.json");
  writeFileSync(path, JSON.stringify(edits), "utf8");
  return path;
}

suite("DDS CLI: 使い方", () => {
  test("引数なしは使い方を出して 0", () => {
    const result = invoke([]);
    assert.strictEqual(result.code, 0);
    assert.ok(result.err.includes("使い方"), "使い方が出ていない");
  });

  test("知らないコマンドは 2", () => {
    assert.strictEqual(invoke(["frobnicate", GOLDEN]).code, 2);
  });

  test("DDS でないファイルは 2（.pf は配置の概念が無い）", () => {
    const result = invoke(["render", "sample.pf"]);
    assert.strictEqual(result.code, 2);
    assert.ok(result.err.includes(".dspf"), "理由が読めない");
  });

  test("--write は patch だけ", () => {
    assert.strictEqual(invoke(["render", "--write", GOLDEN]).code, 2);
  });

  test("patch には --edits が要る", () => {
    assert.strictEqual(invoke(["patch", GOLDEN]).code, 2);
  });

  /**
   * `validate` は**作らない**。桁位置と配置の検査は lint が同じ判定を出しており
   * （`src/lint/rules/layout.ts` が `resolveDspfLayout` を包んでいる）、
   * 2 つ目の入口を作るとどちらが正か分からなくなる。
   */
  test("validate は無く、使い方が lint を案内する", () => {
    assert.strictEqual(invoke(["validate", GOLDEN]).code, 2);
    assert.ok(invoke([]).err.includes("lint.js"), "lint への案内が無い");
  });
});

suite("DDS CLI: parse", () => {
  test("様式と項目が JSON で出る", () => {
    const result = invoke(["parse", GOLDEN]);
    assert.strictEqual(result.code, 0);
    const parsed = JSON.parse(result.out) as {
      ddsType: string;
      records: Array<{ name: string; items: Array<{ label: string; row?: number }> }>;
    };
    assert.strictEqual(parsed.ddsType, "DDS-DSPF");
    const record = parsed.records.find(candidate => candidate.name === "RENDERR");
    assert.ok(record, "様式が無い");
    assert.ok(
      record.items.some(item => item.label === "顧客保守"),
      "DBCS の定数が一覧に無い"
    );
    assert.ok(
      record.items.some(item => item.label === "COND50"),
      "条件付きの項目が一覧に無い（条件で消してはいけない）"
    );
  });

  test("parse は text を受け付けない", () => {
    assert.strictEqual(invoke(["parse", "--format", "text", GOLDEN]).code, 2);
  });
});

suite("DDS CLI: render", () => {
  test("描画モデルが JSON で出る", () => {
    const result = invoke(["render", GOLDEN]);
    assert.strictEqual(result.code, 0);
    const parsed = JSON.parse(result.out) as {
      model: { canvas: { rows: number; columns: number }; items: unknown[] };
    };
    assert.strictEqual(parsed.model.canvas.rows, 24);
    assert.strictEqual(parsed.model.canvas.columns, 80);
    assert.strictEqual(parsed.model.items.length, 21);
  });

  test("絵の桁が合う（DBCS を含む）", () => {
    const result = invoke(["render", "--format", "text", GOLDEN]);
    assert.strictEqual(result.code, 0);
    const lines = result.out.split("\n");

    // 目盛りは 10 桁ごとに十の位、5 桁ごとに `+`。
    assert.ok(lines[0].includes("....+....1....+....2"), `目盛りが違う: ${lines[0]}`);

    // 2 行目: '顧客保守' は 4 桁目宣言。SO が 4 桁目を食うので**文字は 5 桁目から**。
    const row2 = lines[2];
    const body2 = row2.slice(row2.indexOf("|") + 1);
    assert.strictEqual(body2.slice(0, 4), "    ", "SO までは空白");
    assert.ok(body2.startsWith("    顧客保守"), `2 行目が違う: ${body2}`);
  });

  test("非表示（DSPATR(ND)）は桁を占めるが文字を出さない", () => {
    const result = invoke(["render", "--format", "text", GOLDEN]);
    const line = result.out.split("\n").find(text => text.startsWith("14 |"));
    assert.ok(line, "14 行目が無い");
    const body = line.slice(line.indexOf("|") + 1);
    // 4 桁目から 4 桁が 'HIDE'。文字は出ないので `·` で示す。
    assert.strictEqual(body.slice(3, 7), "····", `非表示の印が違う: ${body}`);
  });

  test("帳票も描ける（既定は CRTPRTF の用紙）", () => {
    const result = invoke(["render", "--format", "text", REPORT]);
    assert.strictEqual(result.code, 0);
    assert.ok(result.out.includes("顧客一覧表"), "帳票の見出しが出ていない");
  });

  test("帳票の用紙は指定できる", () => {
    const result = invoke([
      "render", "--format", "json", "--page-rows", "20", "--page-columns", "80", REPORT
    ]);
    const parsed = JSON.parse(result.out) as { model: { canvas: { rows: number; columns: number } } };
    assert.deepStrictEqual(parsed.model.canvas, { rows: 20, columns: 80 });
  });
});

suite("DDS CLI: patch", () => {
  test("当てた結果が標準出力に出て、ファイルは変わらない", () => {
    const path = tempCopy(GOLDEN, "T.dspf");
    const before = readFileSync(path, "utf8");
    const edits = writeEdits(join(path, ".."), [
      { kind: "move", sourceLine: 5, row: 3, column: 10 }
    ]);

    const result = invoke(["patch", "--edits", edits, path]);
    assert.strictEqual(result.code, 0);
    assert.strictEqual(readFileSync(path, "utf8"), before, "--write が無いのに書いた");
    assert.ok(result.out.includes("  3 10'顧客保守'"), "位置が書き換わっていない");
  });

  test("--write は元のファイルを書き換え、触っていない行は変わらない", () => {
    const path = tempCopy(GOLDEN, "T.dspf");
    const before = readFileSync(path, "utf8").split("\n");
    const edits = writeEdits(join(path, ".."), [
      { kind: "move", sourceLine: 5, row: 3, column: 10 }
    ]);

    assert.strictEqual(invoke(["patch", "--edits", edits, "--write", path]).code, 0);

    const after = readFileSync(path, "utf8").split("\n");
    assert.strictEqual(after.length, before.length, "行数が変わった");
    after.forEach((line, index) => {
      if (index === 4) return; // 5 行目（0 始まり）だけが宛先
      assert.strictEqual(line, before[index], `${index + 1} 行目が変わっている`);
    });
  });

  test("当てられない編集は理由つきで拒否し、何も書かない", () => {
    const path = tempCopy(GOLDEN, "T.dspf");
    const before = readFileSync(path, "utf8");
    // 999 行目は存在しない。
    const edits = writeEdits(join(path, ".."), [
      { kind: "move", sourceLine: 999, row: 3, column: 10 }
    ]);

    const result = invoke(["patch", "--edits", edits, "--write", path]);
    assert.strictEqual(result.code, 1);
    assert.strictEqual(readFileSync(path, "utf8"), before, "拒否したのに書いた");
    const parsed = JSON.parse(result.out) as { rejections: Array<{ code: string }> };
    assert.strictEqual(parsed.rejections[0].code, "line-not-found");
  });

  test("1 つでも拒否があれば、当てられる編集も当てない", () => {
    const path = tempCopy(GOLDEN, "T.dspf");
    const before = readFileSync(path, "utf8");
    const edits = writeEdits(join(path, ".."), [
      { kind: "move", sourceLine: 5, row: 3, column: 10 },
      { kind: "move", sourceLine: 999, row: 3, column: 10 }
    ]);

    assert.strictEqual(invoke(["patch", "--edits", edits, "--write", path]).code, 1);
    assert.strictEqual(readFileSync(path, "utf8"), before, "一部だけ当たった");
  });

  /**
   * **「書ける」と「正しい」は別物。**
   *
   * `validateDdsEdits` が見るのは「ソースに書けるか」だけ。実機が通す形
   * （重なり・はみ出し）は拒否しないので、**画面をはみ出す位置へも動かせる**。
   * CLI は規則を写さず、**解決の指摘が増えたか**で止める。
   */
  test("配置の指摘が増える編集は書かない", () => {
    const path = tempCopy(GOLDEN, "T.dspf");
    const before = readFileSync(path, "utf8");
    // 'CUSTOMER MAINT'（14 桁）を 75 桁目へ。80 桁の画面をはみ出す。
    const edits = writeEdits(join(path, ".."), [
      { kind: "move", sourceLine: 6, row: 2, column: 75 }
    ]);

    const result = invoke(["patch", "--edits", edits, "--write", path]);
    assert.strictEqual(result.code, 1);
    assert.strictEqual(readFileSync(path, "utf8"), before, "指摘が増えるのに書いた");
    const parsed = JSON.parse(result.out) as { newIssues: Array<{ code: string }> };
    assert.strictEqual(parsed.newIssues[0].code, "overflow");
  });

  test("--allow-new-issues なら承知のうえで書ける", () => {
    const path = tempCopy(GOLDEN, "T.dspf");
    const edits = writeEdits(join(path, ".."), [
      { kind: "move", sourceLine: 6, row: 2, column: 75 }
    ]);

    assert.strictEqual(
      invoke(["patch", "--edits", edits, "--write", "--allow-new-issues", path]).code,
      0
    );
    assert.ok(readFileSync(path, "utf8").includes("  2 75'CUSTOMER"), "書けていない");
  });

  /**
   * **1 行 1 桁は「書ける」の段でもう断る**（実機が `CPF7311` で通さないため）。
   * 指摘の増分ではなく `validateDdsEdits` の拒否として出る。
   */
  test("1 行 1 桁への移動は拒否として断る", () => {
    const path = tempCopy(GOLDEN, "T.dspf");
    const before = readFileSync(path, "utf8");
    const edits = writeEdits(join(path, ".."), [
      { kind: "move", sourceLine: 5, row: 1, column: 1 }
    ]);

    const result = invoke(["patch", "--edits", edits, "--write", path]);
    assert.strictEqual(result.code, 1);
    assert.strictEqual(readFileSync(path, "utf8"), before);
    const parsed = JSON.parse(result.out) as { rejections: Array<{ code: string }> };
    assert.strictEqual(parsed.rejections[0].code, "column-one-reserved");
  });

  test("元からある指摘は増分に数えない", () => {
    // 1 桁目の項目を含むソースを作り、そこから**別の**まっとうな編集を当てる。
    const path = tempCopy(GOLDEN, "T.dspf");
    const broken = readFileSync(path, "utf8").replace("  2 20'CUSTOMER MAINT'", "  2 75'CUSTOMER MAINT'");
    writeFileSync(path, broken, "utf8");
    const edits = writeEdits(join(path, ".."), [
      { kind: "move", sourceLine: 6, row: 3, column: 30 }
    ]);

    const result = invoke(["patch", "--edits", edits, "--write", path]);
    assert.strictEqual(result.code, 0, `元からの指摘で止まった: ${result.out}`);
  });

  test("CRLF のファイルを LF で書き戻さない", () => {
    const path = tempCopy(GOLDEN, "T.dspf");
    writeFileSync(path, readFileSync(path, "utf8").replace(/\n/gu, "\r\n"), "utf8");
    const edits = writeEdits(join(path, ".."), [
      { kind: "move", sourceLine: 5, row: 3, column: 10 }
    ]);

    assert.strictEqual(invoke(["patch", "--edits", edits, "--write", path]).code, 0);
    const after = readFileSync(path, "utf8");
    assert.ok(after.includes("\r\n"), "CRLF が失われた");
    assert.ok(!/[^\r]\n/u.test(after), "LF が混ざった");
  });
});
