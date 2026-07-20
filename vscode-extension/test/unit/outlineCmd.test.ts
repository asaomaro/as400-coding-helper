import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCmdOutline, commandNameFromPath } from "../../src/language/cmdSymbols";
import { toDocumentSymbols, toLineReader } from "../../src/language/outlineTypes";
import type { OutlineNode } from "../../src/language/outlineTypes";

/**
 * `.cmd`（コマンド定義ソース）のアウトライン。
 *
 * ELEM / QUAL は PARM に字句的にネストせず、ラベル付きの兄弟文として書かれて
 * `TYPE(ラベル)` で参照される。その解決が主な検証対象。
 */

const SRC = join(__dirname, "../../../../docs/src");

function outlineOf(fileName: string): OutlineNode[] {
  const text = readFileSync(join(SRC, fileName), "utf8");
  const { lineAt, lineCount } = toLineReader(text);
  return buildCmdOutline(lineAt, lineCount, commandNameFromPath(fileName));
}

function outlineOfText(text: string, name = "TESTCMD"): OutlineNode[] {
  const { lineAt, lineCount } = toLineReader(text);
  return buildCmdOutline(lineAt, lineCount, name);
}

function shape(nodes: readonly OutlineNode[]): unknown {
  return nodes.map(node => ({
    name: node.name,
    kind: node.kind,
    children: shape(node.children)
  }));
}

function assertSelectionInsideRange(nodes: readonly OutlineNode[], path = ""): void {
  for (const node of nodes) {
    const here = `${path}/${node.name}`;
    const { range: r, selectionRange: s } = node;

    assert.ok(
      s.startLine > r.startLine ||
        (s.startLine === r.startLine && s.startChar >= r.startChar),
      `${here}: selectionRange の開始が range の外`
    );
    assert.ok(
      s.endLine < r.endLine || (s.endLine === r.endLine && s.endChar <= r.endChar),
      `${here}: selectionRange の終端が range の外`
    );

    assertSelectionInsideRange(node.children, here);
  }
}

/** VSCode の要件: 子の range は親の range に含まれていなければならない。 */
function assertChildrenInsideParent(nodes: readonly OutlineNode[], parent?: OutlineNode, path = ""): void {
  for (const node of nodes) {
    const here = `${path}/${node.name}`;
    if (parent) {
      const p = parent.range;
      const c = node.range;
      assert.ok(
        c.startLine > p.startLine || (c.startLine === p.startLine && c.startChar >= p.startChar),
        `${here}: 子の range が親より前から始まる（親 ${p.startLine}-${p.endLine} / 子 ${c.startLine}-${c.endLine}）`
      );
      assert.ok(
        c.endLine < p.endLine || (c.endLine === p.endLine && c.endChar <= p.endChar),
        `${here}: 子の range が親より後ろまで伸びる（親 ${p.startLine}-${p.endLine} / 子 ${c.startLine}-${c.endLine}）`
      );
    }
    assertChildrenInsideParent(node.children, node, here);
  }
}

/** 兄弟の range が重なっていないこと。重なると VSCode がどちらを指すか不定になる。 */
function assertNoSiblingOverlap(nodes: readonly OutlineNode[], path = ""): void {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i].range;
      const b = nodes[j].range;
      assert.ok(
        a.endLine < b.startLine || b.endLine < a.startLine,
        `${path}: ${nodes[i].name}(${a.startLine}-${a.endLine}) と ` +
          `${nodes[j].name}(${b.startLine}-${b.endLine}) の range が重なっている`
      );
    }
  }
  for (const node of nodes) {
    assertNoSiblingOverlap(node.children, `${path}/${node.name}`);
  }
}

suite(".cmd のアウトライン", () => {
  test("CMD がルート、PARM がその子、QUAL/ELEM は参照で PARM の子になる", () => {
    assert.deepEqual(shape(outlineOf("ADDCUST.cmd")), [
      {
        name: "ADDCUST",
        kind: "command",
        children: [
          {
            name: "CUST",
            kind: "parm",
            children: [
              { name: "*NAME", kind: "qual", children: [] },
              { name: "*NAME", kind: "qual", children: [] }
            ]
          },
          { name: "NAME", kind: "parm", children: [] },
          {
            name: "RANGE",
            kind: "parm",
            children: [
              { name: "*DEC", kind: "elem", children: [] },
              { name: "*DEC", kind: "elem", children: [] }
            ]
          },
          { name: "REPLACE", kind: "parm", children: [] },
          { name: "DEP", kind: "dep", children: [] }
        ]
      }
    ]);
  });

  test("DEP は PARM の子ではなくルート直下に出る", () => {
    // DEP CTL(REPLACE) PARM(NAME) は複数の PARM を横断的に参照するので、
    // どれか 1 つにぶら下げると嘘の階層になる。
    const root = outlineOf("ADDCUST.cmd")[0];
    const dep = root.children.find(child => child.kind === "dep");

    assert.ok(dep, "DEP がルート直下に無い");
    assert.equal(dep.detail, "REPLACE");

    for (const parm of root.children.filter(c => c.kind === "parm")) {
      assert.ok(
        parm.children.every(child => child.kind !== "dep"),
        `${parm.name} の下に DEP がぶら下がっている`
      );
    }
  });

  test("detail はコマンド名でなく用途が分かる文言（引用符を外す）", () => {
    const root = outlineOf("ADDCUST.cmd")[0];
    const byName = new Map(root.children.map(c => [c.name, c.detail]));

    assert.equal(root.detail, "顧客の追加");
    assert.equal(byName.get("CUST"), "Q1 顧客ファイル");
    assert.equal(byName.get("NAME"), "*CHAR 顧客名");
  });

  test("継続行をまたぐ文の range が続きの行まで伸びる", () => {
    const root = outlineOf("ADDCUST.cmd")[0];
    const replace = root.children.find(child => child.name === "REPLACE");

    assert.ok(replace);
    // PARM REPLACE は `+` で 2 行に折り返している。
    assert.equal(replace.range.endLine, replace.range.startLine + 1);
  });

  test("継続行の 2 行目の内容も解析される", () => {
    const root = outlineOf("ADDCUST.cmd")[0];
    const library = root.children
      .find(child => child.name === "CUST")
      ?.children[1];

    // PROMPT('ライブラリー') は継続行の側にある。
    assert.ok(library);
    assert.equal(library.detail, "10 ライブラリー");
  });

  test("ルートの range が配下の文をすべて覆う（末尾の空行は含めない）", () => {
    const root = outlineOf("ADDCUST.cmd")[0];
    const last = root.children[root.children.length - 1];

    assert.equal(root.range.startLine, 1, "ルートは CMD 文から始まる");
    assert.equal(
      root.range.endLine,
      last.range.endLine,
      "ルートの range が最後の子と一致しない"
    );
  });

  test("selectionRange は必ず range に含まれる", () => {
    assertSelectionInsideRange(outlineOf("ADDCUST.cmd"), "ADDCUST.cmd");
  });

  test("兄弟の range が重ならない（カーソル位置から一意に引ける）", () => {
    assertNoSiblingOverlap(outlineOf("ADDCUST.cmd"), "ADDCUST.cmd");
  });

  test("要素リストの途中の要素が隣の要素を飲み込まない（CHGPRTF USRDFNOBJ 型）", () => {
    // 修飾名が要素リスト全体の後ろに書かれる実際の配置。ここで
    // 「グループの直後」まで隣接と認めると、E1 の要素が兄弟の要素を覆う。
    const outline = outlineOfText(
      "             CMD        PROMPT('T')\n" +
        "             PARM       KWD(U) TYPE(E1)\n" +
        "E1:          ELEM       TYPE(Q1)\n" +
        "             ELEM       TYPE(*DEC) LEN(5)\n" +
        "Q1:          QUAL       TYPE(*NAME) LEN(10)\n" +
        "             QUAL       TYPE(*NAME) LEN(10)"
    );

    assertChildrenInsideParent(outline, undefined, "chgprtf");
    assertNoSiblingOverlap(outline, "chgprtf");
  });

  test("子の range は必ず親の range に含まれる", () => {
    // レビューで見つかった欠陥の回帰テスト。QUAL / ELEM は PARM 文とは別の行に
    // あるため、PARM の range を自分の行だけにしておくと必ずこの要件を破る。
    assertChildrenInsideParent(outlineOf("ADDCUST.cmd"), undefined, "ADDCUST.cmd");
  });

  test("PARM の range が参照先の QUAL / ELEM まで伸びる", () => {
    const root = outlineOf("ADDCUST.cmd")[0];
    const cust = root.children.find(child => child.name === "CUST");

    assert.ok(cust);
    const lastChild = cust.children[cust.children.length - 1];
    assert.ok(
      cust.range.endLine >= lastChild.range.endLine,
      "PARM の range が参照先のグループを覆っていない"
    );
  });

  test("コマンド名はファイル名から取る（本文には無い）", () => {
    assert.equal(commandNameFromPath("/x/y/ADDCUST.cmd"), "ADDCUST");
    assert.equal(commandNameFromPath("addcust.cmd"), "ADDCUST");
    assert.equal(commandNameFromPath("C:\\src\\MYCMD.CMD"), "MYCMD");
  });

  suite("異常系（例外を投げない）", () => {
    test("空ファイル", () => {
      assert.deepEqual(outlineOfText(""), []);
    });

    test("注記だけ", () => {
      assert.deepEqual(outlineOfText("             /* コメントだけ */"), []);
    });

    test("CMD 文が無ければ PARM 以下をトップレベルに並べる", () => {
      const outline = outlineOfText(
        "             PARM       KWD(AAA) TYPE(*CHAR) LEN(10)\n" +
          "             PARM       KWD(BBB) TYPE(*DEC)"
      );

      assert.deepEqual(shape(outline), [
        { name: "AAA", kind: "parm", children: [] },
        { name: "BBB", kind: "parm", children: [] }
      ]);
    });

    test("TYPE が解決できない PARM は子なしで出る", () => {
      const outline = outlineOfText(
        "             CMD        PROMPT('テスト')\n" +
          "             PARM       KWD(AAA) TYPE(NOPE)"
      );

      const parm = outline[0].children[0];
      assert.equal(parm.name, "AAA");
      assert.deepEqual(parm.children, []);
    });

    test("引き取り手のいないグループはルート直下に出る（隠さない）", () => {
      // どの PARM も TYPE(Z9) を参照していない。
      const outline = outlineOfText(
        "             CMD        PROMPT('テスト')\n" +
          "             PARM       KWD(AAA) TYPE(*CHAR)\n" +
          "Z9:          ELEM       TYPE(*DEC) LEN(5 0)\n" +
          "             ELEM       TYPE(*CHAR) LEN(3)"
      );

      const orphan = outline[0].children.find(child => child.name === "Z9");
      assert.ok(orphan, "引き取り手のいないグループが消えている");
      assert.equal(orphan.kind, "elem");
      assert.equal(orphan.children.length, 2);
    });

    test("離れた位置のグループは入れ子にせずルート直下に出す", () => {
      // 入れ子にすると親の range をそこまで伸ばすことになり、間にある兄弟の
      // PARM を飲み込んでカーソル位置から誤ったパラメータが引かれる。
      // 隠さずルート直下に出し、PARM の detail に TYPE の値を残して辿れるようにする。
      const outline = outlineOfText(
        "             CMD        PROMPT('テスト')\n" +
          "Q9:          QUAL       TYPE(*NAME) LEN(10)\n" +
          "             QUAL       TYPE(*NAME) LEN(10)\n" +
          "             PARM       KWD(AAA) TYPE(Q9)"
      );

      const parm = outline[0].children.find(child => child.name === "AAA");
      assert.ok(parm);
      assert.equal(parm.children.length, 0, "離れたグループを入れ子にしている");
      assert.equal(parm.detail, "Q9", "参照先が detail から辿れない");

      const group = outline[0].children.find(child => child.name === "Q9");
      assert.ok(group, "離れたグループが消えている");
      assert.equal(group.children.length, 2);
    });

    test("グループを末尾にまとめても隣の PARM を飲み込まない", () => {
      // 1 回目の修正（無条件に range を伸ばす）で作ってしまった欠陥の回帰テスト。
      // この配置は実務で普通に書かれる。
      const outline = outlineOfText(
        "             CMD        PROMPT('x')\n" +
          "             PARM       KWD(A) TYPE(E1)\n" +
          "             PARM       KWD(B) TYPE(E2)\n" +
          "E1:          ELEM       TYPE(*CHAR) LEN(10)\n" +
          "             ELEM       TYPE(*DEC) LEN(5)\n" +
          "E2:          ELEM       TYPE(*CHAR) LEN(3)"
      );

      const a = outline[0].children.find(child => child.name === "A");
      const b = outline[0].children.find(child => child.name === "B");
      assert.ok(a && b);
      assert.ok(
        a.range.endLine < b.range.startLine,
        `PARM A の range が PARM B を覆っている（A ${a.range.startLine}-${a.range.endLine} / B ${b.range.startLine}）`
      );
      assertChildrenInsideParent(outline, undefined, "tail-groups");
      assertNoSiblingOverlap(outline, "tail-groups");
    });

    test("CMD が 2 つあるとき未参照グループは自分側の CMD に付く", () => {
      // 常に「最後の CMD」に付けると、2 つ目の range が 1 つ目まで前方に広がり
      // トップレベルの兄弟が重なる。
      const outline = outlineOfText(
        "             CMD        PROMPT('a')\n" +
          "             PARM       KWD(A) TYPE(*CHAR)\n" +
          "Z9:          QUAL       TYPE(*NAME)\n" +
          "             CMD        PROMPT('b')\n" +
          "             PARM       KWD(B) TYPE(*CHAR)"
      );

      assert.equal(outline.length, 2);
      assert.ok(
        outline[0].children.some(child => child.name === "Z9"),
        "未参照グループが 1 つ目の CMD に付いていない"
      );
      assertNoSiblingOverlap(outline, "two-cmd-orphan");
    });

    test("ラベルに $ # @ _ を含めても認識する（IBM i の名前規則）", () => {
      const outline = outlineOfText(
        "             CMD        PROMPT('x')\n" +
          "             PARM       KWD(LIB) TYPE(Q_1)\n" +
          "Q_1:\n" +
          "             QUAL       TYPE(*NAME) LEN(10)"
      );

      const parm = outline[0].children.find(child => child.name === "LIB");
      assert.equal(parm?.children.length, 1, "アンダースコア入りラベルが認識されない");
    });

    test("ラベルが横取りされない（持ち越しは直後の行まで）", () => {
      // ラベル行と文の間に別の行が挟まると、そのラベルは使わない。
      const outline = outlineOfText(
        "             CMD        PROMPT('x')\n" +
          "Q1:\n" +
          "Q2:          QUAL       TYPE(*NAME)"
      );

      // Q2 が自前のラベルを持つので、range は Q1: の行まで戻らない。
      const group = outline[0].children.find(child => child.name === "Q2");
      assert.ok(group, "自前のラベルが使われていない");
      assert.equal(group.range.startLine, 2, "range が無関係なラベル行まで戻っている");
    });

    test("ラベル行と文が離れていたらラベルを引き継がない", () => {
      // 間に別の行が挟まると、そのラベルはその文のものではない。
      // 無期限に持ち越すと無関係な文にラベルが付き、range もラベル行まで戻る。
      const outline = outlineOfText(
        "             CMD        PROMPT('x')\n" +
          "             PARM       KWD(A) TYPE(Q1)\n" +
          "Q1:\n" +
          "\n" +
          "             QUAL       TYPE(*NAME) LEN(10)"
      );

      const parm = outline[0].children.find(child => child.name === "A");
      assert.equal(
        parm?.children.length,
        0,
        "離れたラベル行から名前を引き継いでしまっている"
      );

      const stray = outline[0].children.find(child => child.kind === "qual");
      assert.ok(stray, "QUAL が消えている");
      assert.equal(
        stray.range.startLine,
        4,
        "range が無関係なラベル行まで戻っている"
      );
    });

    test("ラベルだけの行でもグループが名前を保つ", () => {
      // `Q1:` を単独行に書くのは CL / .cmd で合法。parseClCommand は
      // キーワードが無いと undefined を返すので、捨てるとグループが名無しになる。
      const outline = outlineOfText(
        "             CMD        PROMPT('テスト')\n" +
          "             PARM       KWD(AAA) TYPE(Q1)\n" +
          "Q1:\n" +
          "             QUAL       TYPE(*NAME) LEN(10)"
      );

      const parm = outline[0].children.find(child => child.name === "AAA");
      assert.ok(parm);
      assert.equal(parm.children.length, 1, "ラベル行が捨てられてグループが外れた");
      assert.equal(parm.children[0].kind, "qual");
    });

    test("要素リストの要素がさらに修飾名でも入れ子になる（CHGPRTF USRDFNOBJ 型）", () => {
      const outline = outlineOfText(
        "             CMD        PROMPT('T')\n" +
          "             PARM       KWD(USRDFNOBJ) TYPE(E1)\n" +
          "E1:          ELEM       TYPE(Q1) PROMPT('Object')\n" +
          "Q1:          QUAL       TYPE(*NAME) LEN(10)\n" +
          "             QUAL       TYPE(*NAME) LEN(10)"
      );

      const parm = outline[0].children.find(child => child.name === "USRDFNOBJ");
      assert.ok(parm);
      assert.equal(parm.children.length, 1);
      assert.equal(parm.children[0].children.length, 2, "修飾名が要素の下に付いていない");
      assert.equal(parm.children[0].children[0].kind, "qual");
      // ルート直下に重複して出ていないこと。
      assert.equal(outline[0].children.filter(c => c.name === "Q1").length, 0);
      assertChildrenInsideParent(outline, undefined, "nested-qual");
    });

    test("ELEM グループの直後の無ラベル QUAL を取り込まない（種別が混ざらない）", () => {
      const outline = outlineOfText(
        "             CMD        PROMPT('x')\n" +
          "E1:          ELEM       TYPE(*CHAR) LEN(10)\n" +
          "             QUAL       TYPE(*NAME) LEN(10)"
      );

      const kinds = outline[0].children.map(child => child.kind);
      assert.ok(kinds.includes("elem"), "ELEM グループが無い");
      assert.ok(kinds.includes("qual"), "QUAL が ELEM に取り込まれている");
    });

    test("値が空でも名前が空文字にならない（実機は空 name を弾く）", () => {
      // `PARM KWD()` は編集途中に普通に起きる。空の name を作ると
      // 実機の VSCode が `name must not be falsy` で throw し、
      // アウトラインが丸ごと出なくなる。
      const outline = outlineOfText(
        "             CMD        PROMPT('x')\n" +
          "             PARM       KWD() TYPE(*CHAR) LEN(10)"
      );

      const parm = outline[0].children[0];
      assert.ok(parm.name.length > 0, "name が空文字になっている");

      // アダプタ（実機と同じ検証をするスタブ）を通しても落ちないこと。
      assert.doesNotThrow(() => toDocumentSymbols(outline));
    });

    test("PMTCTL もルート直下に出る", () => {
      const outline = outlineOfText(
        "             CMD        PROMPT('テスト')\n" +
          "             PARM       KWD(AAA) TYPE(*CHAR)\n" +
          "             PMTCTL     CTL(AAA)"
      );

      const pmtctl = outline[0].children.find(child => child.kind === "pmtctl");
      assert.ok(pmtctl);
      assert.equal(pmtctl.name, "PMTCTL");
      assert.equal(pmtctl.detail, "AAA");
    });

    test("TYPE の大小文字が違ってもグループが解決する（IBM i の名前は大小無視）", () => {
      const outline = outlineOfText(
        "             CMD        PROMPT('テスト')\n" +
          "             PARM       KWD(AAA) TYPE(q1)\n" +
          "Q1:          QUAL       TYPE(*NAME) LEN(10)"
      );

      const parm = outline[0].children.find(child => child.name === "AAA");
      assert.ok(parm);
      assert.equal(parm.children.length, 1, "大小文字違いでグループが外れた");
      // 引き取られたので、重複したトップレベルのグループは出ない。
      assert.equal(
        outline[0].children.filter(child => child.kind === "qual").length,
        0
      );
    });

    test("CMD が 2 つあっても入れ子にせず兄弟にする", () => {
      const outline = outlineOfText(
        "             CMD        PROMPT('a')\n" +
          "             PARM       KWD(A) TYPE(*CHAR)\n" +
          "             CMD        PROMPT('b')\n" +
          "             PARM       KWD(B) TYPE(*CHAR)"
      );

      assert.equal(outline.length, 2, "2 つ目の CMD が 1 つ目を取り込んでいる");
      assert.equal(outline[0].detail, "a");
      assert.equal(outline[1].detail, "b");
      assert.equal(outline[0].children[0].name, "A");
      assert.equal(outline[1].children[0].name, "B");
      assertChildrenInsideParent(outline, undefined, "two-cmd");
      assertNoSiblingOverlap(outline, "two-cmd");
    });

    test("CMD より前にある文も親より前から始まる子にならない", () => {
      const outline = outlineOfText(
        "             PARM       KWD(EARLY) TYPE(*CHAR)\n" +
          "             CMD        PROMPT('テスト')\n" +
          "             PARM       KWD(LATE) TYPE(*CHAR)"
      );

      assertChildrenInsideParent(outline, undefined, "early-parm");
      // EARLY は CMD より前なので、CMD の子にはならずトップレベルに残る。
      assert.equal(outline[0].name, "EARLY");
    });

    test("同一ラベルが 2 度定義されても種別と所属が混ざらない", () => {
      const outline = outlineOfText(
        "             CMD        PROMPT('テスト')\n" +
          "             PARM       KWD(A) TYPE(Q1)\n" +
          "Q1:          QUAL       TYPE(*NAME)\n" +
          "Q1:          ELEM       TYPE(*CHAR)\n" +
          "             ELEM       TYPE(*DEC)"
      );

      const parm = outline[0].children.find(child => child.name === "A");
      assert.ok(parm);
      // 先勝ち: 参照は直後の 1 つ目（QUAL）に解決する。
      assert.equal(parm.children.length, 1);
      assert.equal(parm.children[0].kind, "qual");

      // 2 つ目（ELEM 2 件）は捨てられず、引き取り手なしとして残る。
      const leftover = outline[0].children.find(
        child => child.kind === "elem" && child.children.length === 2
      );
      assert.ok(leftover, "2 つ目のラベルのグループが消えている");
      assert.ok(
        leftover.children.every(child => child.kind === "elem"),
        "2 つ目のグループの種別が 1 つ目に引きずられている"
      );
    });

    test("自己参照・相互参照でも無限再帰しない", () => {
      // TYPE が自分自身や相手を指す壊れたソース。claimed で打ち切られること。
      const self = outlineOfText(
        "             CMD        PROMPT('x')\n" + "Q1:          QUAL       TYPE(Q1)"
      );
      assert.ok(Array.isArray(self));
      assertChildrenInsideParent(self, undefined, "self-ref");

      const mutual = outlineOfText(
        "             CMD        PROMPT('x')\n" +
          "A1:          ELEM       TYPE(B1)\n" +
          "B1:          ELEM       TYPE(A1)"
      );
      assert.ok(Array.isArray(mutual));
      assertChildrenInsideParent(mutual, undefined, "mutual-ref");
    });

    test("ラベルだけの行で終わっていても落ちない", () => {
      const outline = outlineOfText(
        "             CMD        PROMPT('x')\n" + "Q1:"
      );
      assert.equal(outline.length, 1);
      assert.equal(outline[0].children.length, 0);
    });

    test("同じグループを 2 つの PARM が参照したら先に書かれた方に付く", () => {
      // 同じ木に同じノードを 2 度出すと range が重複して解決が壊れる。
      const outline = outlineOfText(
        "             CMD        PROMPT('x')\n" +
          "             PARM       KWD(A) TYPE(Q1)\n" +
          "Q1:          QUAL       TYPE(*NAME)\n" +
          "             PARM       KWD(B) TYPE(Q1)"
      );

      const a = outline[0].children.find(c => c.name === "A");
      const b = outline[0].children.find(c => c.name === "B");
      assert.equal(a?.children.length, 1);
      assert.equal(b?.children.length, 0, "同じグループが 2 箇所に出ている");
      assertChildrenInsideParent(outline, undefined, "shared-group");
    });

    test("末尾が継続行のまま切れていても落ちない", () => {
      const outline = outlineOfText(
        "             CMD        PROMPT('テスト')\n" +
          "             PARM       KWD(AAA) TYPE(*CHAR) +"
      );

      assert.ok(Array.isArray(outline));
      assertSelectionInsideRange(outline, "truncated");
      assertChildrenInsideParent(outline, undefined, "truncated");
    });
  });
});
