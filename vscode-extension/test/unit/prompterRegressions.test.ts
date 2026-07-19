import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseClCommand,
  joinContinuationLines,
  mapParsedCommandToValues,
  isContinuedLine
} from "../../src/prompter/clCommandParser";
import { buildClCommandText } from "../../src/prompter/applyChanges";
import { buildInitialState } from "../../src/prompter/model";
import { buildCommandHelpText } from "../../src/prompter/commandHelp";
import { buildHtml, toSerializableState } from "../../src/prompter/binding";
import { TinyElement } from "../support/tiny-dom";
import { resolveDdsLevel } from "../../src/language/ddsKeywordCompletion";
import { resolveCompletionKind } from "../../src/language/rpgCompletion";
import type { PrompterDefinition } from "../../src/prompter/types";

const load = (rel: string): PrompterDefinition =>
  JSON.parse(readFileSync(join(__dirname, "../../../resources/prompter", rel), "utf8"));

/**
 * 一度出た欠陥を二度出さないためのテスト。
 * どれも「黙って壊れる」ものばかりで、動かして気付くのが難しい。
 */
suite("Prompter regressions", () => {
  test("単一値が入れ子の group で消えない（CHGPRTF の USRDFNOBJ）", () => {
    const definition = load("cl/ja/CHGPRTF.json");
    const parsed = parseClCommand("CHGPRTF USRDFNOBJ(*SAME)");
    assert.ok(parsed);

    const values = mapParsedCommandToValues(definition, parsed);
    const text = buildClCommandText(definition, values, {
      presentParameters: Object.keys(parsed.parameters)
    });

    // group は入力欄を持たない。単一値を group に入れると書き戻しで消える。
    assert.match(text, /USRDFNOBJ\(\*SAME\)/u);
  });

  test("group の dependsOn が末端に効く（SNDPGMMSG の MSGID→MSGF）", () => {
    const definition = load("cl/ja/SNDPGMMSG.json");

    const withoutId = buildInitialState(definition, {});
    const withId = buildInitialState(definition, { MSGID: "CPF9898" });

    const required = (state: ReturnType<typeof buildInitialState>) =>
      state.fields.filter(f => f.parameter.name === "MSGF").some(f => f.required);

    assert.equal(required(withoutId), false, "MSGID 未指定なら必須ではない");
    assert.equal(required(withId), true, "MSGID を指定したら必須になる");
  });

  test("継続行は + と - の両方（引用符の中は継続ではない）", () => {
    assert.equal(isContinuedLine("CHGJOB JOB(*) +"), true);
    assert.equal(isContinuedLine("CHGJOB JOB(*) -"), true);
    assert.equal(isContinuedLine("CHGJOB JOB(*)"), false);
    assert.equal(isContinuedLine("SNDMSG MSG('a + b')"), false);
  });

  test("既定値のままの省略可能パラメータを書き出さない", () => {
    const definition = load("cl/ja/CHGJOB.json");
    const source = ["CHGJOB     JOB(*) RUNPTY(50)"];
    const parsed = parseClCommand(joinContinuationLines(source));
    assert.ok(parsed);

    const text = buildClCommandText(
      definition,
      mapParsedCommandToValues(definition, parsed),
      { presentParameters: Object.keys(parsed.parameters) }
    );

    const written = text.match(/[A-Z]+\(/gu) ?? [];
    assert.equal(written.length, 2, `書き出しは 2 つのはず: ${text.trim()}`);
  });

  test("DDS のレベルは行を遡って決まる（注記行は飛ばす）", () => {
    const lines = [
      "     A                                      DSPSIZ(24 80 *DS3)",
      "     A          R CUSTREC",
      "     A                                      OVERLAY",
      "     A            CUSTNO         5S 0",
      "     A                                      COLOR(RED)",
      "     A          K CUSTNO",
      "     A*  注記行",
      "     A                                      TEXT('x')"
    ];
    const at = (index: number) => lines[index];

    assert.equal(resolveDdsLevel(at, 0), "file", "最初のレコードより前");
    assert.equal(resolveDdsLevel(at, 2), "record", "レコードの続き");
    assert.equal(resolveDdsLevel(at, 4), "field", "フィールドの続き");
    assert.equal(resolveDdsLevel(at, 7), "key", "注記行を飛ばして遡る");
  });

  test("RPG の命令コード欄は方言で桁が違う", () => {
    const line = "     C                   ";

    // ILE は 26 桁目から、RPG III は 28 桁目から。
    assert.equal(resolveCompletionKind(line, 25, "C-NEW", "ile")?.kind, "opcode");
    assert.equal(resolveCompletionKind(line, 25, "C-SPEC", "rpg3"), undefined);
    assert.equal(resolveCompletionKind(line, 27, "C-SPEC", "rpg3")?.kind, "opcode");
  });

  test("RPG III に組み込み関数は無い", () => {
    const line = "     C           %SUB";
    assert.equal(resolveCompletionKind(line, 21, "C-NEW", "ile")?.kind, "bif");
    assert.equal(resolveCompletionKind(line, 21, "C-SPEC", "rpg3"), undefined);
  });
});

suite("コマンド全体ヘルプ", () => {
  test("説明も help も無ければヘルプを作らない（ボタンを出さない）", () => {
    const empty = buildCommandHelpText({
      keyword: "X",
      description: "",
      parameters: []
    } as unknown as PrompterDefinition);
    assert.equal(empty, "", "中身が無いのにボタンだけ出てはいけない");
  });

  test("定義があればコマンド全体のヘルプが作られる", () => {
    const definition = load("cl/ja/SNDBRKMSG.json");
    const help = buildCommandHelpText(definition);
    assert.ok(help.includes("SNDBRKMSG"), "コマンド名が含まれる");
    assert.ok(help.length > 100, "本文が入っている");
  });
});

suite("プロンプターの描画", () => {
  const render = (rel: string) => {
    const definition = load(rel);
    const state = buildInitialState(definition, {});
    return buildHtml(
      toSerializableState(definition, state, {
        keyword: definition.keyword,
        language: "cl",
        line: 0
      } as never),
      { cspSource: "x", nonce: "n" }
    );
  };

  /** 画面に出てくる順に、入力欄名と囲みの見出しを拾う。 */
  const order = (html: string): string[] => {
    const found: string[] = [];
    for (const match of html.matchAll(/<legend>([^<]+)<\/legend>|name="([A-Z][A-Z0-9_]*)"/gu)) {
      const name = match[1] ? `[${match[1]}]` : match[2];
      if (name && !found.includes(name)) found.push(name);
    }
    return found;
  };

  test("入力欄は定義の順（＝原典の順）に出る", () => {
    // 以前は囲みのある項目を全部先に出しており、PARM では先頭のはずの KWD が
    // SNGVAL などの後ろに回っていた。
    const rendered = order(render("cmd/ja/PARM.json"));
    assert.equal(rendered[0], "KWD", `先頭は KWD のはず: ${rendered.slice(0, 4)}`);

    const kwd = rendered.indexOf("KWD");
    const group = rendered.findIndex(name => name.startsWith("["));
    assert.ok(kwd < group, "囲みより前に単独の欄が出ること");
  });

  test("2 組目以降に削除ボタンが出る", () => {
    const definition = load("cmd/ja/PARM.json");
    const parsed = parseClCommand("PARM KWD(X) TYPE(*CHAR) SNGVAL((*ALL 'A') (*NONE 'B'))");
    assert.ok(parsed);

    const state = buildInitialState(definition, mapParsedCommandToValues(definition, parsed));
    const html = buildHtml(
      toSerializableState(definition, state, {
        keyword: "PARM",
        language: "cmd",
        line: 0
      } as never),
      { cspSource: "x", nonce: "n" }
    );

    const boxes = [...html.matchAll(/data-group-name="(SNGVAL[^"]*)"[\s\S]*?<\/fieldset>/gu)];
    assert.equal(boxes.length, 2, "2 組そろっていること");
    assert.ok(!/class="group-remove"/u.test(boxes[0][0]), "1 組目は消せない");
    assert.ok(/class="group-remove"/u.test(boxes[1][0]), "2 組目には削除が出る");
  });

  test("途中の組を消すと後ろが繰り上がる（連番が飛ばない）", () => {
    // 増減は WebView の script が行う。生成された script から振り直しの処理を
    // 取り出し、最小の DOM 模型で実際に動かす。
    const html = render("cmd/ja/PARM.json");
    const source = html.slice(
      html.indexOf("function renumberGroup"),
      html.indexOf("function escapeForDom")
    );

    const form = new TinyElement("form");
    const makeBox = (index: number) => {
      const box = new TinyElement("fieldset");
      box.className = "group-field";
      box.setAttribute("data-group-name", index === 1 ? "SNGVAL" : `SNGVAL#${index}`);
      box.setAttribute("data-label-base", "単一値");

      const legend = new TinyElement("legend");
      legend.textContent = index === 1 ? "単一値" : `単一値 (${index})`;
      box.appendChild(legend);

      const input = new TinyElement("input");
      input.setAttribute("name", index === 1 ? "SNGVAL" : `SNGVAL#${index}`);
      box.appendChild(input);

      if (index > 1) {
        const remove = new TinyElement("button");
        remove.className = "group-remove";
        box.appendChild(remove);
      }
      return form.appendChild(box);
    };

    makeBox(1);
    const second = makeBox(2);
    const third = makeBox(3);
    const add = new TinyElement("button");
    add.className = "group-add";
    third.appendChild(add);

    const renumber = new Function(
      "form",
      "document",
      `${source}; return renumberGroup;`
    )(form, { createElement: (tag: string) => new TinyElement(tag) }) as (base: string) => void;

    second.remove();
    renumber("SNGVAL");

    const names = form.children.map(box => box.getAttribute("data-group-name"));
    const inputs = form.children.map(box => box.querySelector("input")?.getAttribute("name"));

    assert.deepEqual(names, ["SNGVAL", "SNGVAL#2"], "番号が飛ばない");
    assert.deepEqual(inputs, ["SNGVAL", "SNGVAL#2"], "入力欄の名前も振り直す");
    assert.ok(form.children[1].querySelector(".group-add"), "追加は最後の組に残る");
    assert.ok(!form.children[0].querySelector(".group-remove"), "1 組目は消せない");
  });

  test("組を増減したら番号を振り直す（生成された script の確認）", () => {
    // 増減は画面側の処理なので DOM が要る。ここでは「振り直す処理があること」と
    // 「入力欄の名前を番号から作り直していること」を固定する。
    // 実際の増減はブラウザ上での確認が要る。
    const html = render("cmd/ja/PARM.json");

    assert.match(html, /function renumberGroup\(base\)/u, "振り直しの処理があること");
    assert.match(
      html,
      /name\.split\('#'\)\[0\] \+ suffix/u,
      "入力欄の名前を番号から作り直すこと"
    );
    assert.match(html, /className = 'group-remove'/u, "削除ボタンを作ること");
    assert.match(html, /renumberGroup\(base\)/u, "追加・削除の後に呼ぶこと");
  });

  test("繰り返しの入力欄がラベルの右に並ぶ（次の行に回らない）", () => {
    const html = render("cmd/ja/PARM.json");
    assert.match(
      html,
      /\.multi-field \{ display: inline-block/u,
      "ブロックのままだと入力欄がラベルの次の行へ回る"
    );
  });
});
