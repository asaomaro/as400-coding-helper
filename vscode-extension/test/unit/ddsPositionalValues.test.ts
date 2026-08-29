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
          ["", "P", "S", "B", "F", "A", "H", "L", "T", "Z", "5", "J", "E", "O", "G"],
          `${lang}: 35 桁目`
        );
      }
    });

    /**
     * **ブランクは値の一覧ではなく本文にある。**
     *
     * > この欄がブランクであれば、定義中のフィールドのデータ・タイプは、
     * > この論理ファイルの基礎となる物理ファイル内の対応するフィールドの
     * > データ・タイプと同じものになります。
     *
     * 生成器がブランクを採るのは項目に「ブランク」と書かれているときだけなので
     * 落ちていた。実機（`CRTPF`）はブランクを受ける。
     * 落としたままだと `restricted: true` の欄が `<select>` になったとき
     * **ブランクへ戻せなくなる**。
     */
    test("**本文にしか無いブランクが入っている**", () => {
      for (const lang of ["ja", "en"]) {
        assert.equal(valuesAt(lang, "DDS-PF", 35)[0], "", `${lang}: 先頭がブランクでない`);
      }
    });
  });

  suite("印刷装置ファイルの 35 桁目（データ・タイプ）", () => {
    /**
     * **注の書き出しは種別で揺れる。**
     * 物理/論理・表示装置は「注: **データ・タイプ** J (専用)…」だが、
     * 印刷装置は「注: **O (混用) および G (グラフィック)** は…」と値から始まる。
     * 生成器が前置きの語を要求していたため、印刷装置だけ落ちていた。
     * 実機（`CRTPRTF`）は `G` `O` を受ける。
     */
    test("**注にしか無い O / G が入っている**", () => {
      for (const lang of ["ja", "en"]) {
        for (const value of ["O", "G"]) {
          assert.ok(valuesAt(lang, "DDS-PRTF", 35).includes(value), `${lang}: ${value} が無い`);
        }
      }
    });

    test("実機が受ける 9 件とそろっている", () => {
      for (const lang of ["ja", "en"]) {
        assert.deepEqual(
          valuesAt(lang, "DDS-PRTF", 35),
          ["", "S", "A", "F", "L", "T", "Z", "O", "G"],
          `${lang}: 35 桁目`
        );
      }
    });
  });

  suite("印刷装置ファイルの 38 桁目（使用目的）", () => {
    /**
     * **原典の並べ方が 3 つ目の形**だった。定義リストでも表でもなく**箇条書き**:
     *
     * > `<li><samp>O</samp> またはブランク: 出力専用</li>`
     * > `<li><samp>P</samp>: プログラム - システム間 (特殊な出力フィールド)</li>`
     *
     * 読めていなかったので**選択肢が丸ごと空**で、この欄だけ候補ゼロの自由入力だった。
     * 実機（`CRTPRTF`）の全 37 通りは**位置あり／なしとも受理が ブランク O P** の 3 件で、
     * 原典と完全一致した。
     */
    test("箇条書きから値が入っている（ブランク / O / P）", () => {
      for (const lang of ["ja", "en"]) {
        assert.deepEqual(valuesAt(lang, "DDS-PRTF", 38), ["", "O", "P"], `${lang}: 38 桁目`);
      }
    });

    test("**選択欄になっている**（以前は候補ゼロの自由入力だった）", () => {
      for (const lang of ["ja", "en"]) {
        const parameter = load(lang, "DDS-PRTF").parameters.find(p => p.sourceStart === 38);
        assert.equal(parameter?.inputType, "dropdown", `${lang}: 38 桁目`);
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
    // **`restricted: true` の欄はここが効く。** 画面が `<select>` になるので、
    // ブランクが無いと「既定に戻す」ができなくなる（`webview/ui.ts` の buildSelect）。
    for (const [type, column] of [
      ["DDS-PF", 17], ["DDS-PF", 35], ["DDS-PF", 38],
      ["DDS-DSPF", 17], ["DDS-DSPF", 35], ["DDS-DSPF", 38],
      ["DDS-PRTF", 17], ["DDS-PRTF", 35], ["DDS-PRTF", 38]
    ] as const) {
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
    // 根拠: .aidev/works/20260829-dds-restricted-expand/verify/compare.json
    assert.deepEqual(flags, [
      "DDS-PF:17", "DDS-PF:35", "DDS-PF:38",
      "DDS-DSPF:17", "DDS-DSPF:35", "DDS-DSPF:38",
      "DDS-PRTF:35", "DDS-PRTF:38"
    ]);
  });

  /**
   * **印刷装置の 17 桁目だけが `false` のまま。**
   *
   * 実機は `H` を受ける（`CPD7410@17` が出ず、35 桁と 42 桁の指摘だけが出る）が、
   * **原典は日英とも `R` とブランクだけ**を挙げる（`FIELD-PRTF-prttype.html`）。
   * 原典に無い値を足す判断は、`H`（ヘルプ仕様）が印刷装置で何を意味するのかが
   * 分からないまま行えない。`false` なら候補つきの自由入力のままで、
   * `H` を書きたい利用者を妨げない。
   */
  test("確かめて一致しなかった欄は restricted: false（列挙は候補にすぎない）", () => {
    for (const [type, column] of [["DDS-PRTF", 17]] as const) {
      const parameter = load("ja", type).parameters.find(p => p.sourceStart === column);
      assert.equal(parameter?.attributes?.restricted, false, `${type} ${column} 桁目`);
    }
  });

  /**
   * **英語版に日本語が混ざらないこと。**
   *
   * 欄の名前が桁定義（日本語）から来ていたため、以前は **146 箇所**残っていた
   * （`順序番号（1-5 桁目）` など）。英語で開いても欄の名前が日本語だった。
   * いまは `dds-field-labels.en.json`（英語原典から生成）を読む。
   */
  test("**英語版に日本語が混ざっていない**", () => {
    const japanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/u;
    for (const type of ["DDS-PF", "DDS-DSPF", "DDS-PRTF"]) {
      const found: string[] = [];
      const walk = (value: unknown, path: string): void => {
        if (typeof value === "string") {
          if (japanese.test(value)) found.push(`${path} = ${value.slice(0, 50)}`);
          return;
        }
        if (Array.isArray(value)) value.forEach(item => walk(item, path));
        else if (value && typeof value === "object") {
          for (const key of Object.keys(value)) {
            walk((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
          }
        }
      };
      walk(load("en", type), "");
      assert.deepEqual(found, [], `${type}: 日本語が混ざっている`);
    }
  });

  test("欄の名前が原典の英語の見出しどおり", () => {
    const names = (type: string) =>
      load("en", type).parameters.map(p => p.description.replace(/\s*\(position.*$/u, ""));
    assert.deepEqual(names("DDS-PRTF").slice(0, 4),
      ["Sequence number", "Form type", "Comment", "Condition"]);
    assert.equal(names("DDS-DSPF")[9], "Data type and keyboard shift");
  });

  test("ja / en で restricted がそろっている", () => {
    for (const type of ["DDS-PF", "DDS-DSPF", "DDS-PRTF"]) {
      const flags = (lang: string) =>
        load(lang, type).parameters
          .filter(p => p.options?.length)
          .map(p => `${p.sourceStart}:${p.attributes?.restricted}`);
      assert.deepEqual(flags("ja"), flags("en"), type);
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

  /**
   * **広げた 6 欄が、実機の弾いた値をそのまま指摘する。**
   *
   * 期待値は**実機の判定そのもの**で、原典の読み方から起こしたものではない
   * （`.aidev/works/20260829-dds-restricted-expand/verify/`）。
   * 各文字は全 37 通りの網羅で「値が無効」と出たもの:
   * `CPD7419 Data type not valid.` / `CPD7410 Characters in indicated field not allowed.`
   *
   * `CPD7408`（長さ・小数の咎め）と `CPD7914`（レコードが複数）は**受理**側なので、
   * ここには入れない——入れると実機が通す値を弾くことになる。
   */
  suite("広げた欄が実機の弾く値を指摘する", () => {
    const at = (fsPath: string, lines: readonly string[]) =>
      lintFile({ fsPath, lines, definitions: loadDefinitions(RESOURCES) })
        .filter(f => f.ruleId === "restricted-value");

    const rec = (name: string) => put(put(put(" ".repeat(80), 6, "A"), 17, "R"), 19, name);
    /** 物理/論理の項目行（位置欄が無い）。 */
    const pfField = (name: string, column: number, value: string) =>
      put(put(put(put(" ".repeat(80), 6, "A"), 19, name), 30, "   10"), column, value);
    /** 画面・帳票の項目行（位置欄が要る）。 */
    const posField = (name: string, column: number, value: string) =>
      put(put(pfField(name, 35, "A"), column, value), 39, "  1");

    const CASES = [
      { why: "物理/論理 17 桁: H は CPD7410@17", path: "/x/T.pf",
        lines: [rec("R1"), put(put(put(" ".repeat(80), 6, "A"), 17, "H"), 19, "F1")], column: 17, value: "H" },
      { why: "物理/論理 35 桁: Q は CPD7419@35", path: "/x/T.pf",
        lines: [rec("R1"), pfField("F1", 35, "Q")], column: 35, value: "Q" },
      { why: "物理/論理 38 桁: X は CPD7410@38（B/I/N 以外）", path: "/x/T.pf",
        lines: [rec("R1"), put(pfField("F1", 35, "A"), 38, "X")], column: 38, value: "X" },
      { why: "表示装置 17 桁: K は CPD7410@17（物理では有効）", path: "/x/T.dspf",
        lines: [rec("R1"), put(put(put(" ".repeat(80), 6, "A"), 17, "K"), 19, "F1")], column: 17, value: "K" },
      { why: "表示装置 35 桁: B は CPD7419@35", path: "/x/T.dspf",
        lines: [rec("R1"), posField("F1", 35, "B")], column: 35, value: "B" },
      { why: "印刷装置 35 桁: B は CPD7419@35", path: "/x/T.prtf",
        lines: [rec("R1"), posField("F1", 35, "B")], column: 35, value: "B" },
      { why: "印刷装置 38 桁: I は CPD7410@38（O / P 以外）", path: "/x/T.prtf",
        lines: [rec("R1"), put(posField("F1", 35, "A"), 38, "I")], column: 38, value: "I" }
    ];

    for (const c of CASES) {
      test(c.why, () => {
        const found = at(c.path, c.lines);
        assert.equal(found.length, 1, `指摘が ${found.length} 件`);
        assert.equal(found[0].startColumn, c.column);
        assert.match(found[0].message, new RegExp(`"${c.value}" は指定できません`, "u"));
      });
    }

    /**
     * **印刷装置の 17 桁目は咎めない**（`restricted: false` のまま）。
     * 実機が `H` を受けるのに原典に無いため、集合が確定していない。
     * ここが指摘を出すようになったら、値集合を確かめ直すこと。
     */
    test("印刷装置 17 桁は咎めない（集合が未確定）", () => {
      const found = at("/x/T.prtf",
        [rec("R1"), put(put(put(" ".repeat(80), 6, "A"), 17, "H"), 19, "F1")]);
      assert.deepEqual(found, []);
    });
  });
});
