import * as assert from "assert";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { lintFile } from "../../src/lint/engine";
import { defaultResourcesDir, loadDefinitions } from "../../src/lint/defsLoader";
import { RULE_SPECS } from "../../src/lint/rules";
import type { LintFinding, RuleId } from "../../src/lint/types";

/**
 * レイアウト診断が lint に届いているか。
 *
 * 診断そのものの正しさは `dspfLayout.test.ts` / `prtfLayout.test.ts` が見ている。
 * ここで見るのは**届いているか**と、**届いてはいけないところに届いていないか**。
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const SRC_DIR = join(ROOT, "docs", "src");
const definitions = loadDefinitions(defaultResourcesDir(join(__dirname, "..", "..", "src", "lint")));

/** DDS の 1 行を組み立てる。桁を間違えないようにヘルパーを通す。 */
function ddsLine(options: {
  nameType?: string;
  name?: string;
  length?: string;
  dataType?: string;
  usage?: string;
  row?: string;
  column?: string;
  keywords?: string;
}): string {
  const cells = " ".repeat(90).split("");
  const put = (start: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) cells[start - 1 + i] = text[i]!;
  };
  put(6, "A");
  if (options.nameType) put(17, options.nameType);
  if (options.name) put(19, options.name);
  if (options.length) put(35 - options.length.length, options.length);
  if (options.dataType) put(35, options.dataType);
  if (options.usage) put(38, options.usage);
  // 位置欄は右詰め（行 39-41 / 桁 42-44）。
  if (options.row) put(42 - options.row.length, options.row);
  if (options.column) put(45 - options.column.length, options.column);
  if (options.keywords) put(45, options.keywords);
  return cells.join("").trimEnd();
}

function lint(
  fsPath: string,
  lines: readonly string[],
  enabledRules?: readonly RuleId[]
): readonly LintFinding[] {
  return lintFile({
    fsPath,
    lines,
    definitions,
    ...(enabledRules ? { options: { enabledRules } } : {})
  });
}

function ruleIds(findings: readonly LintFinding[]): string[] {
  return findings.map(finding => finding.ruleId);
}

suite("lint: レイアウト診断が届く", () => {
  test("1 桁目に置いた項目が指摘される（既定で有効）", () => {
    const findings = lint("/tmp/X.dspf", [
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F", length: "5", dataType: "A", usage: "O", row: "1", column: "1" })
    ]);
    assert.ok(
      ruleIds(findings).includes("layout-column-one-reserved"),
      "1 桁目の指摘が届いていない"
    );
  });

  test("位置欄が数字でない項目が指摘される（既定で有効）", () => {
    const findings = lint("/tmp/X.dspf", [
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F", length: "5", dataType: "A", usage: "O", row: "AB", column: "10" })
    ]);
    assert.ok(ruleIds(findings).includes("layout-invalid-position"));
  });

  test("DSPSIZ の値が原典外なら指摘される（既定で有効）", () => {
    const findings = lint("/tmp/X.dspf", [
      ddsLine({ keywords: "DSPSIZ(25 80)" }),
      ddsLine({ nameType: "R", name: "REC" })
    ]);
    assert.ok(ruleIds(findings).includes("layout-invalid-screen-size"));
  });

  test("印刷装置ファイルの行番号＋SPACE/SKIP が指摘される（既定で有効）", () => {
    const findings = lint("/tmp/X.prtf", [
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({
        name: "F",
        length: "5",
        dataType: "A",
        row: "3",
        column: "10",
        keywords: "SPACEA(2)"
      })
    ]);
    assert.ok(ruleIds(findings).includes("layout-spacing-with-line-number"));
  });

  test("指摘は位置欄（39-44 桁）を指す", () => {
    const findings = lint("/tmp/X.dspf", [
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F", length: "5", dataType: "A", usage: "O", row: "1", column: "1" })
    ]);
    const finding = findings.find(f => f.ruleId === "layout-column-one-reserved");
    assert.strictEqual(finding?.startColumn, 39);
    // endColumn は終端を含まないので 44 桁の次。
    assert.strictEqual(finding?.endColumn, 45);
  });

  test("DSPSIZ の指摘はキーワード欄（45 桁以降）を指す", () => {
    const findings = lint("/tmp/X.dspf", [
      ddsLine({ keywords: "DSPSIZ(25 80)" }),
      ddsLine({ nameType: "R", name: "REC" })
    ]);
    const finding = findings.find(f => f.ruleId === "layout-invalid-screen-size");
    assert.strictEqual(finding?.startColumn, 45);
  });
});

suite("lint: 届いてはいけないところに届かない", () => {
  /**
   * 調査中に実際に踏んだ。物理／論理ファイルに位置欄は無いので、
   * DSPF のリゾルバを当てると**全フィールドに missing-position が出る**（実測 15 件）。
   * 種別の振り分けは仕様であって最適化ではない。
   */
  test("物理・論理ファイルにはレイアウト規則を回さない", () => {
    for (const name of ["CUSTMST.pf", "CUSTLF1.lf", "DBCSSAMP.pf"]) {
      const path = join(SRC_DIR, name);
      const lines = readFileSync(path, "utf8").split(/\r?\n/u);
      const layout = lint(path, lines).filter(f => f.ruleId.startsWith("layout-"));
      assert.deepStrictEqual(layout, [], `${name} にレイアウトの指摘が出ている`);
    }
  });

  test("種別が決まらない .dds では何も出ない", () => {
    const findings = lint("/tmp/X.dds", [
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F", length: "5", dataType: "A", usage: "O", row: "1", column: "1" })
    ]);
    assert.deepStrictEqual(findings, []);
  });

  test("既定 OFF の規則は、明示的に有効化したときだけ出る", () => {
    // 76 桁目・幅 10 → データが 85 桁目まで届き 80 桁画面をはみ出す。
    const lines = [
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F", length: "10", dataType: "A", usage: "O", row: "1", column: "76" })
    ];
    assert.ok(
      !ruleIds(lint("/tmp/X.dspf", lines)).includes("layout-overflow"),
      "既定 OFF のはずが出ている"
    );
    assert.ok(
      ruleIds(lint("/tmp/X.dspf", lines, ["layout-overflow"])).includes("layout-overflow"),
      "有効化しても出ない"
    );
  });

  test("採らなかった診断は lint に流さない", () => {
    // +n は原典が認める書き方（プラス機能）。実装が未対応なだけで誤りではない。
    const relative = lint("/tmp/X.dspf", [
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "A", length: "5", dataType: "A", usage: "O", row: "1", column: "10" }),
      ddsLine({ name: "B", length: "5", dataType: "A", usage: "O", column: "+10" })
    ]);
    for (const id of ruleIds(relative)) {
      assert.ok(!id.includes("relative"), `${id} が流れている`);
    }

    // 位置欄が空の項目（missing-position）も初版では流さない。
    const missing = lint("/tmp/X.dspf", [
      ddsLine({ nameType: "R", name: "REC" }),
      ddsLine({ name: "F", length: "5", dataType: "A", usage: "O" })
    ]);
    for (const id of ruleIds(missing)) {
      assert.ok(!id.includes("missing"), `${id} が流れている`);
    }
  });
});

suite("lint: 実機コンパイル確認済みのサンプルで指摘 0 件", () => {
  /**
   * `docs/src/` のソースは実機（pub400 / IBM i 7.5）でコンパイルが通る。
   * 既定で有効な規則が、そこに指摘を出してはいけない。
   */
  test("docs/src の DDS 全部で、レイアウトの指摘が 0 件", () => {
    const targets = readdirSync(SRC_DIR).filter(name =>
      [".pf", ".lf", ".dspf", ".prtf", ".mnudds", ".dds"].includes(
        extname(name).toLowerCase()
      )
    );
    assert.ok(targets.length > 0, "対象のサンプルが 1 本も無い");

    for (const name of targets) {
      const path = join(SRC_DIR, name);
      const lines = readFileSync(path, "utf8").split(/\r?\n/u);
      const layout = lint(path, lines).filter(f => f.ruleId.startsWith("layout-"));
      assert.deepStrictEqual(
        layout.map(f => `${f.ruleId}@${f.line}`),
        [],
        `${name} に偽陽性が出ている`
      );
    }
  });
});

suite("lint: 宣言した severity と、実際に出る severity が一致する", () => {
  /**
   * `RuleSpec.severity` は SARIF の `defaultConfiguration.level` の元になり、
   * `LintFinding.severity` は結果の `level` になる。**別経路**なので、
   * 片方だけ変えても型は通りテストも落ちない。ここで縛る。
   */
  const CASES: readonly { readonly id: RuleId; readonly lines: readonly string[] }[] = [
    {
      id: "layout-column-one-reserved",
      lines: [
        ddsLine({ nameType: "R", name: "REC" }),
        ddsLine({ name: "F", length: "5", dataType: "A", usage: "O", row: "1", column: "1" })
      ]
    },
    {
      id: "layout-invalid-position",
      lines: [
        ddsLine({ nameType: "R", name: "REC" }),
        ddsLine({ name: "F", length: "5", dataType: "A", usage: "O", row: "AB", column: "10" })
      ]
    },
    {
      id: "layout-invalid-screen-size",
      lines: [ddsLine({ keywords: "DSPSIZ(25 80)" }), ddsLine({ nameType: "R", name: "REC" })]
    },
    {
      id: "layout-overflow",
      lines: [
        ddsLine({ nameType: "R", name: "REC" }),
        ddsLine({ name: "F", length: "10", dataType: "A", usage: "O", row: "1", column: "76" })
      ]
    },
    {
      id: "layout-overlap",
      lines: [
        ddsLine({ nameType: "R", name: "REC" }),
        ddsLine({ name: "A", length: "5", dataType: "A", usage: "O", row: "1", column: "10" }),
        ddsLine({ name: "B", length: "5", dataType: "A", usage: "O", row: "1", column: "12" })
      ]
    }
  ];

  for (const { id, lines } of CASES) {
    test(`${id} の severity が宣言と一致する`, () => {
      const spec = RULE_SPECS.find(s => s.id === id);
      assert.ok(spec, `${id} が RULE_SPECS に無い`);
      const findings = lint("/tmp/X.dspf", lines, [id]).filter(f => f.ruleId === id);
      assert.ok(findings.length > 0, `${id} が発火していない（テストの入力が悪い）`);
      assert.strictEqual(
        findings[0]!.severity,
        spec.severity,
        `${id}: 宣言（${spec.severity}）と実際（${findings[0]!.severity}）が食い違う`
      );
    });
  }

  test("印刷装置ファイルの規則も一致する", () => {
    const id: RuleId = "layout-spacing-with-line-number";
    const spec = RULE_SPECS.find(s => s.id === id);
    const findings = lint(
      "/tmp/X.prtf",
      [
        ddsLine({ nameType: "R", name: "REC" }),
        ddsLine({
          name: "F",
          length: "5",
          dataType: "A",
          row: "3",
          column: "10",
          keywords: "SPACEA(2)"
        })
      ],
      [id]
    ).filter(f => f.ruleId === id);
    assert.ok(findings.length > 0);
    assert.strictEqual(findings[0]!.severity, spec?.severity);
  });
});

suite("lint: 設定への露出（到達性）", () => {
  /**
   * AGENTS.md「追加したリソースは『到達可能』になって初めて完了」。
   * RuleId を足しただけでは利用者が設定で切り替えられず死蔵になる。
   */
  test("すべての規則が package.json の lint.rules に載っている", () => {
    const manifest = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "..", "package.json"), "utf8")
    ) as {
      contributes: {
        configuration: {
          properties: Record<string, { properties?: Record<string, unknown> }>;
        };
      };
    };
    const exposed = Object.keys(
      manifest.contributes.configuration.properties["rpgClSupport.lint.rules"]
        ?.properties ?? {}
    );
    assert.deepStrictEqual(
      RULE_SPECS.map(spec => spec.id).filter(id => !exposed.includes(id)),
      [],
      "package.json に載っていない規則がある（設定で切り替えられない）"
    );
  });
});
