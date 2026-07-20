import * as assert from "assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintFile } from "../../src/lint/engine";
import { loadDefinitions } from "../../src/lint/defsLoader";

/**
 * 偽陽性ゼロの回帰。**本作業の中心的な受け入れ基準。**
 *
 * ここに並ぶソースは docs/src/CHECKLIST.md の「作成物」欄が埋まっているもの、
 * すなわち **実機（pub400 / IBM i 7.5）でコンパイルが通ることを確認済み**の
 * ソースだけ。正しいソースなので、指摘が 1 件でも出たらそれは偽陽性であり、
 * 規則か前処理の欠陥として扱う。
 *
 * SLSENT01.rpgle / EMPMNT01.rpgle / RPG3SAMP.rpg は「作成物」が `—` で
 * コンパイル確認が取れていない。しかも D 仕様書の桁がずれている疑いがある
 * （research.md F8）ため、**基準に入れない**。指摘が出るのが正しい可能性がある。
 */

// out-test/test/unit/ から見たリポジトリのルート。
const ROOT = join(__dirname, "..", "..", "..", "..");
const SRC_DIR = join(ROOT, "docs", "src");
const RESOURCES = join(ROOT, "vscode-extension", "resources");

/** 実機コンパイル確認済み（CHECKLIST.md の「作成物」欄が埋まっているもの）。 */
const VERIFIED_SOURCES = [
  { file: "CUSTMST.pf", builtWith: "CRTPF" },
  { file: "CUSTLF1.lf", builtWith: "CRTLF" },
  { file: "CUSTMNT.dspf", builtWith: "CRTDSPF" },
  { file: "CUSTRPT.prtf", builtWith: "CRTPRTF" },
  { file: "DBCSSAMP.pf", builtWith: "CRTPF" },
  { file: "IOSAMP.rpgle", builtWith: "CRTBNDRPG" }
];

function lintSource(file: string, enabledRules?: Parameters<typeof lintFile>[0]["options"]) {
  const fsPath = join(SRC_DIR, file);
  const lines = readFileSync(fsPath, "utf8").split(/\r?\n/);
  return lintFile({
    fsPath,
    lines,
    definitions: loadDefinitions(RESOURCES),
    options: enabledRules
  });
}

suite("lint: 実機コンパイル確認済みソースへの偽陽性", () => {
  for (const { file, builtWith } of VERIFIED_SOURCES) {
    test(`${file}（${builtWith} が通っている）で指摘ゼロ`, () => {
      const findings = lintSource(file);
      assert.deepStrictEqual(
        findings.map(
          f =>
            `${file}:${f.line}:${f.startColumn} [${f.ruleId}] ` +
            `${f.parameterName ?? ""} ${f.message}`
        ),
        [],
        "実機で通るソースに指摘が出ている＝偽陽性"
      );
    });
  }

  test("既定で無効な 2 規則を有効にしても restricted-value は 0 件", () => {
    // restricted は DDS/RPG の定義に設定されていないため、
    // 有効化しても何も検出しないのが意図した安全側の挙動。
    for (const { file } of VERIFIED_SOURCES) {
      const findings = lintSource(file, {
        enabledRules: ["restricted-value"]
      });
      assert.deepStrictEqual(
        findings,
        [],
        `${file}: restricted が未設定なので検出しないはず`
      );
    }
  });

  test("対象外の拡張子はエラーにせず指摘ゼロを返す", () => {
    for (const file of ["DYBAT001CL.clp", "ADDCUST.cmd"]) {
      assert.deepStrictEqual(lintSource(file), [], `${file} は検査対象外`);
    }
  });
});
