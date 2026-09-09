import * as assert from "assert";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { buildDspfRenderModel } from "../../src/core/dds/dspfRenderModel";
import { buildPrtfRenderModel } from "../../src/core/dds/prtfRenderModel";
import { buildRecordLine } from "../../src/core/dds/ddsEditWriteBack";
import { buildDdsTemplate } from "../../src/core/dds/ddsTemplate";
import { parseEditorMessage } from "../../src/dds/webview/protocol";
import {
  applyDdsEdits,
  validateDdsEdits,
  type DdsEdit,
  type DdsEditRejection,
  type EditableDdsType
} from "../../src/core/dds/ddsEdit";

/**
 * 一から DDS を作る経路（新規作成・様式の追加と削除）。
 *
 * ## ここで守るもの
 *
 * どれも**動かすと分かるが、テストが無いと黙って壊れる**種類:
 *
 * 1. **項目が 0 件の様式が `records` から消える**——雛形を作っても
 *    「フィールドを置く」が押せず、新規作成が最初の一歩で行き止まりになる。
 * 2. **様式を消したのに位置の上書き行が孤児として残る**——条件名だけの行が
 *    次の項目の前置きに見え、絵が静かにずれる。
 * 3. **参照が宙に浮いたまま何も出ない**——`SFLCTL(消した様式)` が残っても
 *    コンパイルするまで気付けない。
 */

/** 新規作成の雛形と同じ形（`ddsTemplate.ts`）。項目はまだ 1 つも無い。 */
const EMPTY_RECORD = [
  "     A                                      DSPSIZ(24 80 *DS3)",
  "     A          R REC1",
  ""
];

suite("新規作成: 様式は項目が無くても様式である", () => {
  /**
   * **この作業の壁だったもの。**
   *
   * `records` は配置できた項目（`layout.items`）から導かれていたので、
   * 項目が 0 件の様式は出てこなかった。UI は `records.length > 0` で
   * 「フィールドを置く」「定数を置く」の可否を決めており（`ui.ts` の `canAdd`）、
   * **雛形を作っても何も置けない**状態になっていた。
   *
   * core 側は空の様式にも項目を足せる（`add` が通る）ので、
   * 塞いでいたのは**この導き方ひとつ**だった。
   */
  test("項目 0 件の様式が records に出る（画面）", () => {
    const model = buildDspfRenderModel(EMPTY_RECORD);
    assert.deepStrictEqual(model.records, ["REC1"]);
    assert.strictEqual(model.items.length, 0, "まだ何も置いていない");
  });

  test("項目 0 件の様式が records に出る（帳票）", () => {
    const model = buildPrtfRenderModel(["     A          R REC1", ""]);
    assert.deepStrictEqual(model.records, ["REC1"]);
  });

  /**
   * **「（様式の外）」は様式ではない。** 最初の様式より前に現れた項目は
   * 名前の無い束にまとめられる（`buildDspfOutline`）。追加先として選べてしまうと
   * `record-not-found` になるだけなので、`records` には入れない。
   */
  test("名前の無い束は records に入らない", () => {
    const model = buildDspfRenderModel([
      "     A                                  1  2'様式より前'",
      "     A          R REC1",
      "     A                                  3  2'様式の中'"
    ]);
    assert.deepStrictEqual(model.records, ["REC1"]);
  });

  /**
   * 用途が `H`（非表示）の項目しか持たない様式も、配置解決では 1 つも項目が残らない。
   * 「項目から数える」導き方だとこれも消えていた。**様式としては存在する。**
   */
  test("非表示の項目しか無い様式も records に出る", () => {
    const model = buildDspfRenderModel([
      "     A                                      DSPSIZ(24 80 *DS3)",
      "     A          R HIDDEN",
      "     A            SECRET        10A  H"
    ]);
    assert.deepStrictEqual(model.records, ["HIDDEN"]);
  });

  /** 並びは**ソース順**。既存の期待（配置順）と一致することを固定する。 */
  test("records はソースの並び順", () => {
    const model = buildDspfRenderModel([
      "     A                                      DSPSIZ(24 80 *DS3)",
      "     A          R FIRST",
      "     A                                 10  2'あとに置く'",
      "     A          R SECOND",
      "     A                                  1  2'さきに置く'"
    ]);
    assert.deepStrictEqual(model.records, ["FIRST", "SECOND"]);
  });
});

suite("新規作成: 雛形", () => {
  /**
   * **桁を数え直さない。** 雛形の行は既存の組み立て関数を通しているので、
   * 実ソース（`docs/src/CUSTMNT.dspf`）と同じ形になるはず。ここで固定しておくと、
   * 桁の扱いを変えたときに雛形の側も一緒に落ちる。
   */
  test("様式の行は実ソースと同じ形", () => {
    assert.strictEqual(buildRecordLine("MAIN"), "     A          R MAIN");
  });

  test("様式名は大文字にそろえ、前後の空白を落とす", () => {
    assert.strictEqual(buildRecordLine("  rec1  "), "     A          R REC1");
  });

  /**
   * **画面ファイルは `DSPSIZ` を明示する。** 省いても既定は 24x80 だが、
   * 書かないと画面サイズ条件名の拠り所が消える（原典より、条件名を指定しない場合は
   * IBM 提供の条件名で条件付けられる）。
   */
  test("画面の雛形は DSPSIZ と様式 1 つ", () => {
    assert.deepStrictEqual(buildDdsTemplate("DDS-DSPF"), [
      "     A                                      DSPSIZ(24 80 *DS3)",
      "     A          R REC1"
    ]);
  });

  /** **帳票に画面サイズ相当は入らない**（紙面は `CRTPRTF` の `PAGESIZE`）。 */
  test("帳票の雛形は様式 1 つだけ", () => {
    assert.deepStrictEqual(buildDdsTemplate("DDS-PRTF"), ["     A          R REC1"]);
  });

  /** **作った直後から置ける**こと。指摘が出ていたら雛形が壊れている。 */
  test("画面の雛形は 24x80 で解け、指摘が出ない", () => {
    const model = buildDspfRenderModel([...buildDdsTemplate("DDS-DSPF")]);
    assert.deepStrictEqual(model.canvas, { rows: 24, columns: 80 });
    assert.deepStrictEqual(model.diagnostics, []);
    assert.deepStrictEqual(model.records, ["REC1"]);
    assert.strictEqual(model.outline.length, 1);
  });

  test("帳票の雛形も様式として解ける", () => {
    const model = buildPrtfRenderModel([...buildDdsTemplate("DDS-PRTF")]);
    assert.deepStrictEqual(model.records, ["REC1"]);
  });
});

/** 検証 → 適用まで通し、置き換え指示を当てた行を返す（ホストがやることと同じ）。 */
function edit(
  lines: readonly string[],
  edits: readonly DdsEdit[],
  ddsType: EditableDdsType = "DDS-DSPF"
): { lines?: string[]; rejections?: readonly DdsEditRejection[] } {
  const rejections = validateDdsEdits(lines, edits, ddsType);
  if (rejections.length > 0) return { rejections };
  const out = [...lines];
  for (const result of applyDdsEdits(lines, edits, ddsType)) {
    out.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
  }
  return { lines: out };
}

suite("様式の追加", () => {
  /**
   * **空のファイルから始められること。** 読み込んだ行は末尾に空文字を持つことが多いので
   * （`text.split(/\r?\n/)`）、そのまま末尾に足すと**行頭に空行が残る**ファイルになる。
   */
  test("空ファイルでは先頭に置く（空行を頭に残さない）", () => {
    assert.deepStrictEqual(edit([""], [{ kind: "addRecord", name: "REC1" }]).lines, [
      "     A          R REC1",
      ""
    ]);
  });

  test("行が 1 本も無いファイルでも置ける", () => {
    assert.deepStrictEqual(edit([], [{ kind: "addRecord", name: "REC1" }]).lines, [
      "     A          R REC1"
    ]);
  });

  /** ファイル・レベルのキーワードは論理単位にならない。**その下に付く。** */
  test("ファイル・レベルのキーワードだけのファイルではその下に付く", () => {
    assert.deepStrictEqual(
      edit(
        ["     A                                      DSPSIZ(24 80 *DS3)", ""],
        [{ kind: "addRecord", name: "REC1" }]
      ).lines,
      [
        "     A                                      DSPSIZ(24 80 *DS3)",
        "     A          R REC1",
        ""
      ]
    );
  });

  /** 末尾の空行の**前**に入る（並べ替えは扱わないので、常にいちばん後ろの様式になる）。 */
  test("既にある様式の後ろに付く", () => {
    assert.deepStrictEqual(
      edit(
        [
          "     A          R FIRST",
          "     A                                  1  2'見出し'",
          ""
        ],
        [{ kind: "addRecord", name: "SECOND" }]
      ).lines,
      [
        "     A          R FIRST",
        "     A                                  1  2'見出し'",
        "     A          R SECOND",
        ""
      ]
    );
  });

  /** 足したあと**すぐその様式に項目を置ける**こと（AC4 の本体）。 */
  test("足した様式にそのまま項目を置ける", () => {
    const added = edit([""], [{ kind: "addRecord", name: "REC1" }]).lines ?? [];
    const placed = edit(added, [
      { kind: "add", recordName: "REC1", item: { kind: "constant", text: "見出し", row: 1, column: 2 } }
    ]);
    assert.ok(placed.lines?.some(line => line.includes("'見出し'")), "項目が入っていない");
    assert.deepStrictEqual(buildDspfRenderModel(placed.lines ?? []).records, ["REC1"]);
  });

  test("同じ名前の様式は作れない", () => {
    const result = edit(
      ["     A          R REC1", ""],
      [{ kind: "addRecord", name: "rec1" }]
    );
    assert.strictEqual(result.rejections?.[0]?.code, "record-name-duplicate");
  });

  test("名前が空なら断る", () => {
    const result = edit([""], [{ kind: "addRecord", name: "   " }]);
    assert.strictEqual(result.rejections?.[0]?.code, "record-needs-name");
  });

  /** 上限は項目と同じ 10 桁（`NAME_WIDTH`。実機で確認済み）。 */
  test("10 桁を超える名前は断る", () => {
    const result = edit([""], [{ kind: "addRecord", name: "ABCDEFGHIJK" }]);
    assert.strictEqual(result.rejections?.[0]?.code, "name-too-long");
  });
});

suite("様式の削除", () => {
  const SOURCE = [
    "     A                                      DSPSIZ(24 80 27 132)",
    "     A          R FIRST                     OVERLAY",
    "     A                                  1  2'見出し'",
    "     A            FLDA          10A  B 23  2",
    "     A  *DS4                           26 40",
    "     A          R SECOND",
    "     A            FLDB          10A  B  5  2",
    ""
  ];

  test("様式と中の項目がまとめて消える", () => {
    const result = edit(SOURCE, [{ kind: "removeRecord", sourceLine: 2 }]);
    assert.deepStrictEqual(result.lines, [
      "     A                                      DSPSIZ(24 80 27 132)",
      "     A          R SECOND",
      "     A            FLDB          10A  B  5  2",
      ""
    ]);
  });

  /**
   * **位置の上書き行を孤児にしない。** `*DS4` の行は項目の論理単位に属しているので
   * 一緒に消える。残ると次の項目の前置きに見え、2 次画面の絵が静かにずれる。
   */
  test("位置の上書き行も一緒に消える", () => {
    const result = edit(SOURCE, [{ kind: "removeRecord", sourceLine: 2 }]);
    assert.ok(!result.lines?.some(line => line.includes("*DS4")), "上書き行が残っている");
  });

  /** 最後の様式を消しても、ファイル・レベルのキーワードは残る（様式ではない）。 */
  test("最後の様式を消してもファイル・レベルは残る", () => {
    const once = edit(SOURCE, [{ kind: "removeRecord", sourceLine: 2 }]).lines ?? [];
    const twice = edit(once, [{ kind: "removeRecord", sourceLine: 2 }]);
    assert.deepStrictEqual(twice.lines, [
      "     A                                      DSPSIZ(24 80 27 132)",
      ""
    ]);
  });

  /**
   * **注記行は消さない。** 論理単位に属さないので集合に入らず、そこで塊が分かれる。
   * 利用者が書いたものを黙って捨てない（項目の削除と同じ扱い）。
   */
  test("間に挟まった注記行は残る", () => {
    const result = edit(
      [
        "     A          R FIRST",
        "     A                                  1  2'見出し'",
        "     A*  ここに説明がある",
        "     A            FLDA          10A  B  3  2",
        "     A          R SECOND",
        ""
      ],
      [{ kind: "removeRecord", sourceLine: 1 }]
    );
    assert.deepStrictEqual(result.lines, [
      "     A*  ここに説明がある",
      "     A          R SECOND",
      ""
    ]);
  });

  test("様式でない行を指したら断る", () => {
    const result = edit(SOURCE, [{ kind: "removeRecord", sourceLine: 3 }]);
    assert.strictEqual(result.rejections?.[0]?.code, "record-line-not-found");
  });
});

suite("宙に浮いた参照", () => {
  const REPO = join(__dirname, "..", "..", "..", "..");
  const EXT = join(REPO, "vscode-extension");

  /**
   * **偽陽性を固定する。**
   *
   * この検査は「このファイルに無い名前を指している」だけを見るので、
   * 外部のオブジェクトを指すキーワード（`REF(CUSTMST)` / `MSGID` / `FONTNAME` …）を
   * 追ってしまうと、**正しいソースに指摘が出続ける**。除外は `ddsReferences` の
   * `NOT_FOLLOWED` が持っているので、ここではその結果を実データで確かめる。
   *
   * 同梱の DDS を全部通す。新しいサンプルを足したときに気付けるよう、
   * ここに並べたものが唯一の対象ではなく**在る分を全部**にしてある。
   */
  const BUNDLED = [join(REPO, "docs", "src"), join(EXT, "test", "golden")].flatMap(dir =>
    readdirSync(dir)
      .filter(name => /\.(dspf|prtf|mnudds)$/iu.test(name))
      .sort()
      .map(name => join(dir, name))
  );

  test("走査する対象が 1 本以上ある（数え上げていないことの担保）", () => {
    assert.ok(BUNDLED.length > 0, "同梱の DDS が 1 本も見つからない（パスが変わった？）");
  });

  for (const path of BUNDLED) {
    test(`同梱の ${basename(path)} に指摘が出ない`, () => {
      const lines = readFileSync(path, "utf8").split(/\r?\n/u);
      const model = path.endsWith(".prtf")
        ? buildPrtfRenderModel(lines)
        : buildDspfRenderModel(lines);
      const dangling = model.diagnostics.filter(d => d.code.endsWith("-reference-not-found"));
      assert.deepStrictEqual(dangling, [], `${basename(path)} に偽陽性が出ている`);
    });
  }

  /**
   * 単独起動ハーネスの `references.dspf` と同じ形。**参照を持つ DDS の代表**で、
   * `&` の参照（規則 A）・定位置の参照（規則 B）・様式の参照・**外部**の参照が 1 本に入っている。
   */
  const REFERENCES = [
    "     A                                      REF(CUSTMST)",
    "     A                                      PASSRCD(MAIN)",
    "     A          R MAIN",
    "     A                                      CSRLOC(CSRROW CSRCOL)",
    "     A                                      SFLCSRRRN(&SFLRRN)",
    "     A            CSRROW         3S 0H",
    "     A            CSRCOL         3S 0H",
    "     A            SFLRRN         5S 0H",
    "     A            CUSTNO        10A  B  5  2",
    "     A          R OTHER                     OVERLAY +",
    "     A                                      ERASE(MAIN)",
    "     A            OTHFLD        10A  B  7  2",
    ""
  ];

  test("参照が全部そろっていれば指摘が出ない（外部の REF も追わない）", () => {
    const model = buildDspfRenderModel(REFERENCES);
    assert.deepStrictEqual(
      model.diagnostics.filter(d => d.code.endsWith("-reference-not-found")),
      []
    );
  });

  /** **様式を消すと、それを指していたキーワードが宙に浮く**（AC11 の本体）。 */
  test("様式を消すと、指していた参照が検証に出る", () => {
    const after = edit(REFERENCES, [{ kind: "removeRecord", sourceLine: 3 }]).lines ?? [];
    const codes = buildDspfRenderModel(after)
      .diagnostics.filter(d => d.code.endsWith("-reference-not-found"))
      .map(d => d.code);

    // `PASSRCD(MAIN)`（ファイル・レベル）と `ERASE(MAIN)`（OTHER の様式レベル）の 2 件。
    assert.deepStrictEqual(codes, [
      "record-reference-not-found",
      "record-reference-not-found"
    ]);
  });

  /**
   * **中の項目を指す参照も浮く。** 様式を消せば中のフィールドも消えるので、
   * `CSRLOC` / `&名前` / `HLPARA(*FLD)` の側も同時に宙に浮く。
   * 様式側だけ出すと「出ない側は正しい」と読まれる。
   */
  test("消えたフィールドを指す参照も検証に出る", () => {
    const source = [
      "     A          R MAIN",
      "     A                                      CSRLOC(CSRROW CSRCOL)",
      "     A            CUSTNO        10A  B  5  2",
      "     A          R HIDDEN",
      "     A            CSRROW         3S 0H",
      "     A            CSRCOL         3S 0H",
      ""
    ];
    assert.deepStrictEqual(
      buildDspfRenderModel(source).diagnostics.filter(d =>
        d.code.endsWith("-reference-not-found")
      ),
      [],
      "消す前は指摘が出ないはず"
    );

    const after = edit(source, [{ kind: "removeRecord", sourceLine: 4 }]).lines ?? [];
    const found = buildDspfRenderModel(after).diagnostics.filter(d =>
      d.code.endsWith("-reference-not-found")
    );
    assert.strictEqual(found.length, 2, "CSRROW と CSRCOL の 2 件");
    assert.ok(found.every(d => d.code === "field-reference-not-found"));
    assert.ok(found[0].message.includes("CSRLOC"), "どのキーワードかを出す");
  });

  /** **書き換えない。** 検証に出すだけで、ソースには触らない。 */
  test("参照が浮いてもソースは書き換わらない", () => {
    const after = edit(REFERENCES, [{ kind: "removeRecord", sourceLine: 3 }]).lines ?? [];
    assert.ok(after.some(line => line.includes("PASSRCD(MAIN)")), "参照が消されている");
    assert.ok(after.some(line => line.includes("ERASE(MAIN)")), "参照が消されている");
  });
});

suite("継ぎ目: メッセージの検証", () => {
  const parse = (edits: unknown[]) => parseEditorMessage({ type: "edit", edits });

  test("addRecord は名前が文字列なら通る", () => {
    assert.deepStrictEqual(parse([{ kind: "addRecord", name: "REC1" }]), {
      type: "edit",
      edits: [{ kind: "addRecord", name: "REC1" }]
    });
  });

  test("removeRecord は行が正の整数なら通る", () => {
    assert.deepStrictEqual(parse([{ kind: "removeRecord", sourceLine: 2 }]), {
      type: "edit",
      edits: [{ kind: "removeRecord", sourceLine: 2 }]
    });
  });

  /**
   * **中身の検査はここでやらない。** 空の名前も 11 桁の名前も型としては通し、
   * core の検証が理由つきで断る（規則を 2 か所に置かない）。
   */
  test("空の名前も型としては通す（判定は core）", () => {
    assert.ok(parse([{ kind: "addRecord", name: "" }]));
  });

  test("名前が文字列でなければ列ごと捨てる", () => {
    assert.strictEqual(parse([{ kind: "addRecord", name: 42 }]), undefined);
  });

  test("removeRecord の行が 0 以下なら列ごと捨てる", () => {
    assert.strictEqual(parse([{ kind: "removeRecord", sourceLine: 0 }]), undefined);
  });

  /** 1 つでも不正なら**列ごと**捨てる（部分適用を作らない既存の規約）。 */
  test("正しいものと混ざっていても列ごと捨てる", () => {
    assert.strictEqual(
      parse([{ kind: "addRecord", name: "REC1" }, { kind: "removeRecord" }]),
      undefined
    );
  });
});
