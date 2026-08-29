import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrompterDefinition } from "../../src/prompter/types";
import { lintFile } from "../../src/lint/engine";
import { defaultResourcesDir, loadDefinitions } from "../../src/lint/defsLoader";
import { defaultEnabledRules } from "../../src/lint/rules/index";

/**
 * **DDS の定位置欄の「有効な値」。**
 *
 * 生成器（`docs/origin/generate-dds-prompter.mjs`）が原典から作る。
 * ここで見るのは**出来上がった値集合**——生成器を直しても、値が落ちれば落ちる。
 *
 * 直す前は 3 か所で値が落ちていた。いずれも**黙って落ちる**形:
 *
 * | 欄 | 落ちていた理由 |
 * |---|---|
 * | 表示装置 35 桁 | 値の一覧が**子ページ**にあり、親ページにはリンクしか無かった（選択肢が空） |
 * | 物理/論理 35 桁 | DBCS のデータ・タイプが**一覧の直後の「注」**にしか無かった |
 * | 表示装置 38 桁 | 先頭が「**ブランクまたは 0**」で 1 文字の正規表現に合わなかった |
 */
const load = (lang: string, type: string): PrompterDefinition =>
  JSON.parse(
    readFileSync(join(__dirname, "../../../resources/prompter/dds", lang, `${type}.json`), "utf8")
  ) as PrompterDefinition;

const valuesAt = (lang: string, type: string, column: number): string[] => {
  const parameter = load(lang, type).parameters.find(
    p => p.sourceStart === column && p.sourceLength === 1
  );
  return (parameter?.options ?? []).map(o => o.value);
};

suite("DDS 定位置欄の有効な値", () => {
  suite("表示装置ファイルの 35 桁目（データ・タイプ／キーボード・シフト）", () => {
    // 親ページ（rzakcmstdfdt）は「有効な項目」への**リンクだけ**を持つ。
    // 追わないと選択肢が空になり、この欄は自由入力のままだった。
    test("子ページの値が入っている", () => {
      for (const lang of ["ja", "en"]) {
        const values = valuesAt(lang, "DDS-DSPF", 35);
        assert.deepEqual(
          values,
          ["", "X", "A", "N", "S", "Y", "W", "I", "D", "M", "F", "L", "T", "Z", "J", "E", "O", "G"],
          `${lang}: 35 桁目`
        );
      }
    });

    test("**注にしか無い DBCS のデータ・タイプ**も入っている", () => {
      for (const lang of ["ja", "en"]) {
        for (const value of ["J", "E", "O", "G"]) {
          assert.ok(valuesAt(lang, "DDS-DSPF", 35).includes(value), `${lang}: ${value}`);
        }
      }
    });
  });

  suite("物理/論理ファイルの 35 桁目（データ・タイプ）", () => {
    test("一覧の値と、注が足す DBCS のデータ・タイプが両方ある", () => {
      for (const lang of ["ja", "en"]) {
        assert.deepEqual(
          valuesAt(lang, "DDS-PF", 35),
          ["P", "S", "B", "F", "A", "H", "L", "T", "Z", "5", "J", "E", "O", "G"],
          `${lang}: 35 桁目`
        );
      }
    });
  });

  suite("表示装置ファイルの 38 桁目（使用目的）", () => {
    /**
     * **日本語版の原典が誤っている。** ja は「ブランクまたは 0」（数字のゼロ）、
     * en は「Blank or O」（英字のオー）。実機（IBM i 7.3 / CRTDSPF）で確かめると
     * **0 は CPD7410『示されたフィールドに文字を使用することはできない』で弾かれ、
     * O は通る**（対照 B=通る / Q=弾かれる は 4/4 一致）。
     * 実サンプル `docs/src/CUSTMNT.dspf` も 38 桁目に O を使っている。
     */
    test("日英で同じ値集合になる（日本語版の誤植を直してある）", () => {
      assert.deepEqual(valuesAt("ja", "DDS-DSPF", 38), valuesAt("en", "DDS-DSPF", 38));
    });

    test("実機が受ける値がそろっている", () => {
      // H / M / P は実機が「認識した上で」文脈違いを指摘する（CPD7443 / CPD7436）。
      // **弾かれた＝無効な値ではない**ので、集合から外さない。
      assert.deepEqual(valuesAt("ja", "DDS-DSPF", 38), ["", "O", "I", "B", "H", "M", "P"]);
    });

    test("**実機が弾く 0 は入っていない**", () => {
      for (const lang of ["ja", "en"]) {
        assert.ok(!valuesAt(lang, "DDS-DSPF", 38).includes("0"), `${lang}: 0 が残っている`);
      }
    });
  });

  test("ブランクを選べる欄では先頭にある（値を入れたあと元へ戻せる）", () => {
    for (const [type, column] of [["DDS-DSPF", 35], ["DDS-DSPF", 38], ["DDS-PF", 38]] as const) {
      assert.equal(valuesAt("ja", type, column)[0], "", `${type} ${column} 桁目`);
    }
  });
});

/**
 * **`restricted-value` は「網羅で確かめた欄」だけを見る。**
 *
 * `restricted: true` が付くのは、**実機で全空間（1 文字なら 37 通り）を試して
 * 原典と一致した欄だけ**。列挙された値だけ試しても「漏れが無い」ことは分からない。
 *
 * 確かめずに立てると**正しいソースを弾く**——実際、印刷装置の 35 桁は原典に無い
 * `G` / `O` を実機が受ける（`20260829-dds-restricted-enable/verify/probe-confirm.mjs`）。
 */
suite("DDS の restricted-value", () => {
  const RESOURCES = defaultResourcesDir(__dirname);
  const put = (line: string, column: number, value: string): string => {
    const chars = line.padEnd(80, " ").split("");
    for (let i = 0; i < value.length; i += 1) chars[column - 1 + i] = value[i];
    return chars.join("").replace(/ +$/u, "");
  };
  const field = (name: string, usage: string, row: number): string =>
    put(put(put(put(put(put(" ".repeat(80), 6, "A"), 19, name), 30, "   10"), 35, "A"), 38, usage),
      39, `  ${row}`.slice(-3));

  const lint = (lines: readonly string[]) =>
    lintFile({
      fsPath: "/x/T.dspf",
      lines,
      definitions: loadDefinitions(RESOURCES)
    }).filter(f => f.ruleId === "restricted-value");

  test("既定で有効", () => {
    assert.ok(defaultEnabledRules().includes("restricted-value"));
  });

  test("**確かめた欄だけに restricted: true が付く**", () => {
    const flags: string[] = [];
    for (const type of ["DDS-PF", "DDS-DSPF", "DDS-PRTF"]) {
      for (const parameter of load("ja", type).parameters) {
        if (!parameter.options?.length) continue;
        if (parameter.attributes?.restricted === true) {
          flags.push(`${type}:${parameter.sourceStart}`);
        }
      }
    }
    // 増やすときは**実機で全空間を試してから**。原典を読んだだけで足さない。
    assert.deepEqual(flags, ["DDS-DSPF:38"]);
  });

  test("確かめていない欄は restricted: false（列挙は候補にすぎない）", () => {
    for (const [type, column] of [["DDS-PRTF", 35], ["DDS-PF", 35], ["DDS-DSPF", 35]] as const) {
      const parameter = load("ja", type).parameters.find(p => p.sourceStart === column);
      assert.equal(parameter?.attributes?.restricted, false, `${type} ${column} 桁目`);
    }
  });

  suite("実機が弾く値を指摘する", () => {
    const record = put(put(" ".repeat(80), 6, "A"), 17, "R");
    const header = put(record, 19, "REC1");

    test("有効な値は指摘しない", () => {
      assert.deepEqual(lint([header, field("GOOD", "B", 1)]), []);
    });

    test("**原典に無い値を指摘する**", () => {
      const found = lint([header, field("BAD1", "Z", 2)]);
      assert.equal(found.length, 1);
      assert.equal(found[0].startColumn, 38);
      assert.match(found[0].message, /"Z" は指定できません/u);
    });

    /**
     * `0` は**日本語版の原典が誤って挙げていた値**。実機は CPD7410 で弾く。
     * 直す前は定義に入っていたので、この規則があっても素通りしていた。
     */
    test("日本語版の原典の誤植（0）も指摘する", () => {
      const found = lint([header, field("BAD2", "0", 3)]);
      assert.equal(found.length, 1);
      assert.match(found[0].message, /"0" は指定できません/u);
    });
  });
});
