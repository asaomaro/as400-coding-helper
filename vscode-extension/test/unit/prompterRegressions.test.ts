import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseClCommand,
  joinContinuationLines,
  mapParsedCommandToValues,
  isContinuedLine
} from "../../src/prompter/clCommandParser";
import { applyChanges, buildClCommandText } from "../../src/prompter/applyChanges";
import { narrowToEditableColumns } from "../../src/prompter/commandText";
import * as vscode from "vscode";
import { buildInitialState } from "../../src/prompter/model";
import { buildCommandHelpText } from "../../src/prompter/commandHelp";
import { buildBlocks, toSerializableState } from "../../src/prompter/formModel";
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
  const model = (rel: string) => {
    const definition = load(rel);
    return toSerializableState(definition, buildInitialState(definition, {}));
  };

  /** 画面に出てくる順に、入力欄名と囲みの見出しを拾う。 */
  const order = (rel: string): string[] =>
    buildBlocks(model(rel)).map(block =>
      block.kind === "field" ? block.field.name : `[${block.label}]`
    );

  test("入力欄は定義の順（＝原典の順）に出る", () => {
    // 以前は囲みのある項目を全部先に出しており、PARM では先頭のはずの KWD が
    // SNGVAL などの後ろに回っていた。
    const rendered = order("cmd/ja/PARM.json");
    assert.equal(rendered[0], "KWD", `先頭は KWD のはず: ${rendered.slice(0, 4)}`);

    const kwd = rendered.indexOf("KWD");
    const group = rendered.findIndex(name => name.startsWith("["));
    assert.ok(kwd < group, "囲みより前に単独の欄が出ること");
  });

  test("囲みは最初の子が現れた位置に置かれ、後続の子はそこへ入る", () => {
    const blocks = buildBlocks(model("cl/ja/SBMJOB.json"));
    const jobd = blocks.find(block => block.kind === "group" && block.name === "JOBD");
    assert.ok(jobd && jobd.kind === "group", "JOBD の囲みがある");
    assert.deepEqual(
      jobd.fields.map(field => field.name),
      ["LIB", "JOBD"],
      "修飾名の 2 欄が 1 つの囲みに束ねられる"
    );
  });

  test("繰り返し group は最後の一組にだけ「追加」を出す", () => {
    // 途中の組に出すと、どこに追加されるのか分からなくなる。
    // **押して増える／減ることは e2e が画面で確かめる**（ここは印の位置だけ）。
    const definition = load("cmd/ja/PARM.json");
    const parsed = parseClCommand("PARM KWD(X) TYPE(*CHAR) SNGVAL((*ALL 'A') (*NONE 'B'))");
    assert.ok(parsed);

    const state = buildInitialState(definition, mapParsedCommandToValues(definition, parsed));
    const rendered = toSerializableState(definition, state);
    const groups = Object.keys(rendered.repeatableGroups ?? {});

    assert.ok(groups.includes("SNGVAL#2"), `2 組目が最後: ${groups.join(",")}`);
    assert.ok(!groups.includes("SNGVAL"), "1 組目には出さない");
  });
});

// RPG 固定長の 4 行目は 1〜6 桁目を変えない決まり（FR-031）。行全体を組み立て直すプロンプターが、
// 1 桁でも掛かるとして丸ごと拒まれ、4 行目だけ何も書けなかった（docs/research/20260927-f4-prompter-exploration の P2）。
suite("4 行目への書き戻し（FR-031）", () => {
  test("narrowToEditableColumns: 先頭 6 桁が同じなら 7 桁目以降だけを書く／違えば書けない／元が短くても比べる", () => {
    assert.deepEqual(narrowToEditableColumns("     D", "     DF3                       3      3N", 6),
      { ok: true, start: 6, text: "F3                       3      3N" });
    assert.deepEqual(narrowToEditableColumns("     D", "     C                   EVAL", 6), { ok: false });
    assert.deepEqual(narrowToEditableColumns("     ", "     DX", 6), { ok: false }, "6 桁目が空白から D に変わる");
    assert.deepEqual(narrowToEditableColumns("", "", 6), { ok: true, start: 0, text: "" });
  });

  const stub = vscode as unknown as any;
  const dSpec = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "resources", "prompter", "rpg", "ile", "ja", "D-SPEC.json"), "utf8"));

  function fakeEditor(lines: string[]): any {
    return {
      document: {
        uri: stub.Uri.file("/ws/X.rpgle"),
        lineAt: (n: number) => ({ text: lines[n] })
      }
    };
  }

  test("4 行目の D 仕様の値を 7 桁目以降に書き戻し、1〜6 桁目は残す", async () => {
    stub.workspace.__appliedEdits = [];
    const editor = fakeEditor(["     H", "     F", "     D", "     D", "     D"]);
    await applyChanges(editor, dSpec, { language: "rpg", line: 3 } as any, { NAME: "F3", FROM: "3", LEN: "3" } as any);
    assert.equal(stub.workspace.__appliedEdits.length, 1);
    const [edit] = stub.workspace.__appliedEdits[0].edits;
    assert.equal(edit.range.start.character, 6, "7 桁目から置き換える");
    assert.ok(edit.text.startsWith("F3"), edit.text);
  });

  test("4 行目で 1〜6 桁目が変わる確定は書かずに知らせる。5 行目はこれまでどおり行全体を置き換える", async () => {
    stub.workspace.__appliedEdits = [];
    stub.window.messages = [];
    const editor = fakeEditor(["     H", "     F", "     D", "     D", "     D"]);
    // 1〜5 桁目（順序番号の所）に書く欄を持つ定義。同梱の定義には無いが、FR-031 の側の断り方を確かめるために作る
    const seqDefinition = { keyword: "SEQ", parameters: [{ name: "SEQ", sourceStart: 1, sourceLength: 5 }] };
    await applyChanges(editor, seqDefinition as any, { language: "rpg", line: 3 } as any, { SEQ: "00400" } as any);
    assert.equal(stub.workspace.__appliedEdits.length, 0);
    assert.ok(stub.window.messages.some((m: string) => /4 行目の 1〜6 桁目は変更できない/.test(m)), stub.window.messages.join("\n"));

    await applyChanges(editor, seqDefinition as any, { language: "rpg", line: 4 } as any, { SEQ: "00500" } as any);
    assert.equal(stub.workspace.__appliedEdits[0].edits[0].range.start.character, 0);
    assert.ok(stub.workspace.__appliedEdits[0].edits[0].text.startsWith("00500"));
  });
});

