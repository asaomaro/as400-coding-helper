import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrompterDefinition } from "../../src/prompter/types";

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
