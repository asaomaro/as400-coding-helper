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
import { buildRpgLineText, narrowToEditableColumns } from "../../src/prompter/commandText";
import { printWidth } from "../../src/core/dbcs";
import { readKeywordForm } from "../../src/prompter/keywordForm";
import { opcodeFieldHelp, withOpcodeCandidates } from "../../src/prompter/opcodeCandidates";
import { readContinuedName, writeContinuedName } from "../../src/prompter/rpgNameContinuation";
import { DATA_AREA_KEYWORD, PROMPT_TYPE_PARAMETER, dataAreaDefinition, keywordForPromptType, promptTypeOf, withPromptType } from "../../src/prompter/promptTypes";
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


suite("桁幅を超える値（実操作調査 P3）", () => {
  // 以前は書き戻しで左から黙って切り、`EVAL` の式が `(%DATE():*YMD)` に化けていた。
  // 定義の maxLength（C の演算項目 30）が桁幅（14）より大きいので、maxLength の検査では止まらない。
  test("C 仕様の演算項目 2 に 14 桁を超える式を入れると、欄のエラーで確定できない", () => {
    const cSpec = load("rpg/ile/ja/C-SPEC.json");
    const state = buildInitialState(cSpec, { OPCODE: "EVAL", FACTOR2: "DSPDATE = %DEC(%DATE():*YMD)" });
    const factor2 = state.fields.find(field => field.fieldName === "FACTOR2");
    assert.equal(factor2?.error, "14 桁に収まりません（28 文字）。");
    assert.equal(state.hasErrors, true);
  });

  test("D 仕様のキーワードは 37 桁まで。ちょうど 37 桁は通る", () => {
    const dSpec = load("rpg/ile/ja/D-SPEC.json");
    const keywords = (value: string) =>
      buildInitialState(dSpec, { NAME: "P", DECLTYPE: "PR", KEYWORDS: value }).fields.find(field => field.fieldName === "KEYWORDS")?.error;
    assert.equal(keywords(`EXTPROC('${"A".repeat(26)}')`), undefined); // 37 文字
    assert.equal(keywords(`EXTPROC('${"A".repeat(27)}')`), "37 桁に収まりません（38 文字）。");
  });
});

suite("桁の決まりどおりに寄せる（実操作調査 P4）", () => {
  // trim した値を左詰めで書いていたため、別の意味の桁に入っていた。
  // 実機: D の開始位置の左詰めは RNF0263、DSPF の小数・行・桁の左詰めは CPD7422。
  const at = (line: string, from: number, to: number): string => line.padEnd(to).slice(from - 1, to);
  const write = (rel: string, original: string, values: Record<string, string>): string => {
    const definition = load(rel);
    const current = Object.fromEntries(
      definition.parameters
        .filter(p => typeof p.sourceStart === "number" && typeof p.sourceLength === "number")
        .map(p => [p.name, original.padEnd(100).slice(p.sourceStart! - 1, p.sourceStart! - 1 + p.sourceLength!).trim()])
    );
    return buildRpgLineText(original, definition, { ...current, ...values });
  };

  test("C 仕様の条件標識は右寄せ（OF は 10-11 桁、N01 は 9-11 桁）", () => {
    assert.equal(at(write("rpg/ile/ja/C-SPEC.json", "     C", { INDICATORS: "OF", OPCODE: "EXCEPT" }), 9, 11), " OF");
    assert.equal(at(write("rpg/ile/ja/C-SPEC.json", "     C", { INDICATORS: "N01", OPCODE: "EXSR" }), 9, 11), "N01");
  });

  test("C-NEW にも条件標識（9-11 桁）の欄がある（実操作調査 P10）", () => {
    const line = write("rpg/ile/ja/C-NEW.json", "     C", { INDICATORS: "OF", OPCODE: "EVAL", COND: "*IN77 = *OFF" });
    assert.equal(line, "     C   OF              EVAL      *IN77 = *OFF");
  });

  test("C 仕様の結果標識は高・低・等しいの組ごとに置ける（等しいだけ 75-76 桁）", () => {
    const line = write("rpg/ile/ja/C-SPEC.json", "     C", { OPCODE: "READC", FACTOR2: "SFL01", RESIND_EQ: "50" });
    assert.equal(at(line, 71, 76), "    50");
  });

  test("D 仕様の開始位置は右寄せ", () => {
    const line = write("rpg/ile/ja/D-SPEC.json", "     D", { NAME: "FLD", FROM: "12", LEN: "15" });
    assert.equal(at(line, 26, 32), "     12");
    assert.equal(at(line, 33, 39), "     15");
  });

  test("DSPF の条件付けは N＋標識の 3 桁ずつ。画面サイズ条件名は 9 桁目から", () => {
    assert.equal(at(write("dds/ja/DDS-DSPF.json", "     A", { C8: "40", C19: "FLD" }), 8, 16), " 40      ");
    assert.equal(at(write("dds/ja/DDS-DSPF.json", "     A", { C8: "N40 41", C19: "FLD" }), 8, 16), "N40 41   ");
    assert.equal(at(write("dds/ja/DDS-DSPF.json", "     A", { C8: "*DS4", C39: "24 46" }), 8, 16), " *DS4    ");
  });

  test("DSPF の小数は右寄せ、位置は行 39-41・桁 42-44 に右寄せ", () => {
    const line = write("dds/ja/DDS-DSPF.json", "     A", { C19: "AMT", C30: "7", C36: "0", C38: "B", C39: "7 74" });
    assert.equal(at(line, 30, 37), "    7  0"); // 長さ 30-34・タイプ 35（空）・小数 36-37
    assert.equal(at(line, 39, 44), "  7 74");
  });

  test("PRTF の位置が 1 つだけなら桁（42-44）", () => {
    assert.equal(at(write("dds/ja/DDS-PRTF.json", "     A", { C19: "FLD", C39: "10" }), 39, 44), "    10");
  });

  test("形に合わない値は欄のエラーにする", () => {
    const dspf = load("dds/ja/DDS-DSPF.json");
    const error = (values: Record<string, string>, name: string) =>
      buildInitialState(dspf, values).fields.find(field => field.fieldName === name)?.error;
    assert.match(error({ C39: "1 2 3" }, "C39") ?? "", /行と桁/);
    assert.match(error({ C8: "AB" }, "C8") ?? "", /標識/);
    assert.equal(error({ C8: "N40N41" }, "C8"), undefined);
  });
});

suite("英大文字に縛らない欄（実操作調査 P6・P12）", () => {
  // 実機で作成できる（.aidev/works/20260927-prompter-mixed-case/verify/）。縛ると確定できなかった。
  const error = (rel: string, values: Record<string, string>, name: string) =>
    buildInitialState(load(rel), values).fields.find(field => field.fieldName === name)?.error;

  test("DDS のキーワード欄に小文字・日本語の定数が書ける", () => {
    assert.equal(error("dds/ja/DDS-DSPF.json", { C39: "1 2", C45: "'Search: customer name'" }, "C45"), undefined);
    assert.equal(error("dds/ja/DDS-DSPF.json", { C39: "2 2", C45: "'顧客名で絞り込みます'" }, "C45"), undefined);
    assert.equal(error("dds/ja/DDS-PRTF.json", { C39: "2", C45: "'Total'" }, "C45"), undefined);
  });

  test("ILE RPG の名前は大小文字を混ぜてよい（D・P・F）", () => {
    assert.equal(error("rpg/ile/ja/D-SPEC.json", { NAME: "loadSubfile", DECLTYPE: "PR" }, "NAME"), undefined);
    assert.equal(error("rpg/ile/ja/P-SPEC.json", { PROCNAME: "loadSubfile", BEGINEND: "B" }, "PROCNAME"), undefined);
    assert.equal(error("rpg/ile/ja/F-SPEC.json", { FILENAME: "mixcased" }, "FILENAME"), undefined);
  });

  test("DDS の名前欄はこれまでどおり英大文字", () => {
    assert.notEqual(error("dds/ja/DDS-DSPF.json", { C19: "fld" }, "C19"), undefined);
  });
});

suite("CL: 文字ストリングを引用符で囲む・折り返しを実機の桁で数える（実操作調査 P13・P14）", () => {
  const sndpgmmsg = load("cl/ja/SNDPGMMSG.json");
  const msg = (value: string) => buildClCommandText(sndpgmmsg, { MSG: value });

  test("空白・日本語を含む値は引用符で囲む（囲まないとコンパイルできない）", () => {
    assert.match(msg("CMPLXPR で印刷エラー"), /MSG\('CMPLXPR で印刷エラー'\)/u);
    assert.match(msg("印刷エラー"), /MSG\('印刷エラー'\)/u);
  });

  test("中のアポストロフィは重ねる", () => {
    assert.match(msg("It's done"), /MSG\('It''s done'\)/u);
  });

  test("既に囲んだ値・変数・式はそのまま", () => {
    assert.match(msg("'Already quoted'"), /MSG\('Already quoted'\)/u);
    assert.match(msg("&TEXT"), /MSG\(&TEXT\)/u);
    assert.match(msg("'Count: ' *CAT &N"), /MSG\('Count: ' \*CAT &N\)/u);
  });

  test("空白の無い英数字は囲まない（名前・特殊値の欄は対象外）", () => {
    assert.match(msg("DONE"), /MSG\(DONE\)/u);
    assert.match(buildClCommandText(load("cl/ja/CALL.json"), { PGM: "MYPGM" }), /PGM\(MYPGM\)/u);
  });

  test("折り返しは SO/SI と全角 2 桁で数える（文字数では 72 桁に収まる行も折る）", () => {
    // 文字数 60・実機 76 桁。文字数で判定すると折り返されず、実機で 72 桁を超えていた。
    const text = buildClCommandText(sndpgmmsg, { MSG: "印刷装置でエラーが発生したので停止", MSGTYPE: "*COMP" });
    const lines = text.split("\n");
    assert.ok(lines.length >= 2, text);
    for (const line of lines) assert.ok(printWidth(line) <= 72, `${printWidth(line)} 桁: ${line}`);
  });
});

suite("RPG 仕様書の定義の不足（実操作調査 P7・P8・P9・P11・P23）", () => {
  const state = (rel: string, values: Record<string, string>) => buildInitialState(load(rel), values, { reportEmptyRequired: true });
  const errorOf = (rel: string, values: Record<string, string>, name: string) =>
    state(rel, values).fields.find(field => field.fieldName === name)?.error;

  test("必須が強すぎない: 長さの無い D 行・キーワードだけの F 行・名前の無い P の E 行・ELSE", () => {
    assert.equal(state("rpg/ile/ja/D-SPEC.json", { NAME: "INDS", DECLTYPE: "DS" }).hasErrors, false);
    assert.equal(state("rpg/ile/ja/F-SPEC.json", { KEYWORDS: "SFILE(SFL01:RRN)" }).hasErrors, false);
    assert.equal(state("rpg/ile/ja/P-SPEC.json", { BEGINEND: "E" }).hasErrors, false);
    assert.equal(state("rpg/ile/ja/C-NEW.json", { OPCODE: "ELSE" }).hasErrors, false);
  });

  test("D のデータ・タイプに N（標識）・U・G・C・O・* がある（原典の 40 桁目の値）", () => {
    const values = load("rpg/ile/ja/D-SPEC.json").parameters.find(p => p.name === "INTTYPE")?.options?.map(o => o.value);
    for (const value of ["N", "U", "G", "C", "O", "*"]) assert.ok(values?.includes(value), value);
    assert.equal(errorOf("rpg/ile/ja/D-SPEC.json", { NAME: "IND01", LEN: "1", INTTYPE: "N" }, "INTTYPE"), undefined);
  });

  test("隠れていた欄が見える（D の小数、F の限界内処理・レコード・アドレス・タイプ・ファイル編成）", () => {
    const visible = (rel: string, name: string) => state(rel, {}).fields.find(field => field.fieldName === name)?.visible;
    assert.equal(visible("rpg/ile/ja/D-SPEC.json", "DEC"), true);
    for (const name of ["LIMITS", "RECADDR", "FILEORG"]) assert.equal(visible("rpg/ile/ja/F-SPEC.json", name), true, name);
  });

  test("F の外部記述キー付き（34 桁目 K）が書ける", () => {
    const line = buildRpgLineText("     F", load("rpg/ile/ja/F-SPEC.json"), { FILENAME: "CUSTMST", FILETYPE: "I", FILEDESG: "F", FILEFMT: "E", RECADDR: "K", DEVICE: "DISK" });
    assert.equal(line, "     FCUSTMST   IF   E           K DISK");
  });

  test("出力ファイル（17 桁 O）のファイル指定はブランクだけ（実機 RNF2040）", () => {
    assert.notEqual(errorOf("rpg/ile/ja/F-SPEC.json", { FILENAME: "QSYSPRT", FILETYPE: "O", FILEDESG: "F", DEVICE: "PRINTER" }, "FILEDESG"), undefined);
    assert.equal(errorOf("rpg/ile/ja/F-SPEC.json", { FILENAME: "QSYSPRT", FILETYPE: "O", FILEDESG: "", DEVICE: "PRINTER" }, "FILEDESG"), undefined);
    assert.equal(errorOf("rpg/ile/ja/F-SPEC.json", { FILENAME: "CUSTMST", FILETYPE: "I", FILEDESG: "F" }, "FILEDESG"), undefined);
  });
});

suite("H 仕様書（キーワード形式）を読み書きする（実操作調査 P1）", () => {
  const hSpec = load("rpg/ile/ja/H-SPEC.json");

  test("確定した値がキーワードとして書かれる", () => {
    assert.equal(
      buildRpgLineText("     H", hSpec, { DFTACTGRP: "*NO", ACTGRP: "*NEW", DATFMT: "*ISO" }),
      "     H DATFMT(*ISO) DFTACTGRP(*NO) ACTGRP(*NEW)"
    );
  });

  test("既存の行から値を読み、定義に無いキーワードは残し、空にしたものは外す", () => {
    const original = "     H DFTACTGRP(*NO) NOMAIN ACTGRP('QILE') BNDDIR('A':'B')";
    assert.deepEqual(readKeywordForm(original, hSpec), { DFTACTGRP: "*NO", ACTGRP: "'QILE'", BNDDIR: "'A':'B'" });
    assert.equal(
      buildRpgLineText(original, hSpec, { DFTACTGRP: "", ACTGRP: "*CALLER", BNDDIR: "'A':'B'" }),
      "     H NOMAIN ACTGRP(*CALLER) BNDDIR('A':'B')"
    );
  });

  test("80 桁を超えたら H の行を足す", () => {
    const text = buildRpgLineText("     H", hSpec, {
      DFTACTGRP: "*NO", ACTGRP: "'LONGACTIVATIONGROUP'", BNDDIR: "'QC2LE':'MYBNDDIR'", COPYRIGHT: "'(C) 2026 EXAMPLE CORPORATION'"
    });
    const lines = text.split("\n");
    assert.ok(lines.length >= 2, text);
    for (const line of lines) {
      assert.ok(line.length <= 80, line);
      assert.ok(line.startsWith("     H "), line);
    }
  });

  test("何も変えずに確定すると元の行のまま", () => {
    const original = "     H DFTACTGRP(*NO) ACTGRP(*NEW) NOMAIN";
    assert.equal(buildRpgLineText(original, hSpec, readKeywordForm(original, hSpec)), original);
  });
});

suite("C 仕様書の命令コードの候補（実操作調査 P18）", () => {
  const values = (rel: string, dialect: "ile" | "rpg3" = "ile") =>
    withOpcodeCandidates(load(rel), dialect, "ja").parameters.find(p => p.name === "OPCODE")?.options?.map(o => o.value) ?? [];

  test("C-NEW は拡張演算項目 2 を取る命令、C-SPEC は取らない命令（行の分類と同じ集合）", () => {
    const cNew = values("rpg/ile/ja/C-NEW.json");
    const cSpec = values("rpg/ile/ja/C-SPEC.json");
    for (const name of ["EVAL", "IF", "DOW", "ELSE", "ENDIF"]) assert.ok(cNew.includes(name), name);
    for (const name of ["CHAIN", "MOVEL", "READ", "SETON", "EXFMT"]) assert.ok(cSpec.includes(name), name);
    assert.ok(!cNew.includes("CHAIN") && !cSpec.includes("EVAL"));
    assert.ok(!cSpec.some(value => value !== value.toUpperCase()), "総称（ANDxx 等）は入れない");
  });

  test("候補は制限ではない（演算拡張つきも書ける）", () => {
    const definition = withOpcodeCandidates(load("rpg/ile/ja/C-NEW.json"), "ile", "ja");
    const error = buildInitialState(definition, { OPCODE: "EVAL(H)", COND: "X = 1" }).fields.find(f => f.fieldName === "OPCODE")?.error;
    assert.equal(error, undefined);
  });
});

suite("CL: 利用者が入れたものだけ書く（P16 の決定）", () => {
  const call = load("cl/ja/CALL.json");
  const ovrprtf = load("cl/ja/OVRPRTF.json");
  test("既定値のままのライブラリー（*LIBL）は書かない。入れたライブラリーは書く", () => {
    assert.match(buildClCommandText(call, { LIB: "*LIBL", PGM: "CMPLXPR" }), /CALL\s+PGM\(CMPLXPR\)$/u);
    assert.match(buildClCommandText(call, { LIB: "MYLIB", PGM: "CMPLXPR" }), /PGM\(MYLIB\/CMPLXPR\)/u);
  });
  test("要素リストの後ろの既定値（*ROWCOL）は書かない。既定値でなければ書く", () => {
    assert.match(buildClCommandText(ovrprtf, { FILE: "CMPLXP", LENGTH: "66", WIDTH: "132", PAGESIZE_UOM: "*ROWCOL" }), /PAGESIZE\(66 132\)/u);
    assert.match(buildClCommandText(ovrprtf, { FILE: "CMPLXP", LENGTH: "66", WIDTH: "132", PAGESIZE_UOM: "*UOM" }), /PAGESIZE\(66 132 \*UOM\)/u);
  });
  test("元のソースに書かれていたパラメーターはそのまま残す", () => {
    assert.match(buildClCommandText(call, { LIB: "*LIBL", PGM: "CMPLXPR" }, { presentParameters: ["PGM"] }), /PGM\(\*LIBL\/CMPLXPR\)/u);
  });
});

suite("D 仕様の名前: 継続名前行と字下げ（P21 の決定）", () => {
  const dSpec = load("rpg/ile/ja/D-SPEC.json");
  const build = (original: string, name: string, values: Record<string, string>) =>
    buildRpgLineText(original, dSpec, { ...values, NAME: name });

  test("15 桁を超える名前は継続名前行に分け、主要定義行の名前欄を空ける", () => {
    const written = writeContinuedName(["     D"], 0, "customerAccountBalance", (o, n) => build(o, n, { DECLTYPE: "S", LEN: "11", INTTYPE: "P", DEC: "2" }));
    assert.equal(written.from, 0);
    assert.deepEqual(written.text.split("\n"), [
      "     DcustomerAccountBalance...",
      "     D                 S             11P 2"
    ]);
  });

  test("継続名前行を読むとつながり、短くすると継続名前行が消える", () => {
    const lines = ["     DcustomerAccount...", "     D   Balance     S             11P 2"];
    assert.equal(readContinuedName(lines, 1, "Balance"), "customerAccountBalance");
    const written = writeContinuedName(lines, 1, "BAL", (o, n) => build(o, n, { DECLTYPE: "S", LEN: "11", INTTYPE: "P", DEC: "2" }));
    assert.equal(written.from, 0);
    assert.equal(written.text, "     D   BAL           S             11P 2");
  });

  test("名前を変えても字下げ（8 桁目から）は残る", () => {
    const original = "     D  SUB1                   1      5";
    const values = readValues(original);
    assert.equal(build(original, "SUB9", values).slice(6, 21), "  SUB9         ");
  });

  test("長い名前は桁幅の検査に掛からない", () => {
    const error = buildInitialState(dSpec, { NAME: "customerAccountBalance", DECLTYPE: "S", LEN: "11" }).fields.find(f => f.fieldName === "NAME")?.error;
    assert.equal(error, undefined);
  });

  function readValues(line: string): Record<string, string> {
    return Object.fromEntries(
      dSpec.parameters
        .filter(p => typeof p.sourceStart === "number" && typeof p.sourceLength === "number")
        .map(p => [p.name, line.padEnd(100).slice(p.sourceStart! - 1, p.sourceStart! - 1 + p.sourceLength!).trim()])
    );
  }
});

suite("プロンプト・タイプ（ACS と同じ切り替え。P15 の決定）", () => {
  test("定義のキーワード ↔ プロンプト・タイプ", () => {
    assert.equal(promptTypeOf("C-NEW"), "CX");
    assert.equal(promptTypeOf("C-SPEC"), "C");
    assert.equal(promptTypeOf("D-SPEC"), "D");
    assert.equal(promptTypeOf(DATA_AREA_KEYWORD), "**");
    assert.equal(keywordForPromptType("CX", "", "ile", []), "C-NEW");
    assert.equal(keywordForPromptType("c", "", "ile", []), "C-SPEC");
    assert.equal(keywordForPromptType("D", "", "ile", []), "D-SPEC");
    assert.equal(keywordForPromptType("**", "", "ile", []), DATA_AREA_KEYWORD);
    assert.equal(keywordForPromptType("CX", "", "rpg3", []), undefined, "RPG III に拡張演算項目 2 は無い");
    assert.equal(keywordForPromptType("E", "", "rpg3", []), "E-SPEC");
    assert.equal(keywordForPromptType("ZZ", "", "ile", []), undefined);
  });

  test("データ域は 1-80 桁の 1 欄で、目盛りを出す", () => {
    const definition = dataAreaDefinition();
    assert.equal(definition.parameters.length, 1);
    assert.equal(definition.parameters[0].attributes?.ruler, true);
    const shown = withPromptType(definition);
    assert.equal(shown.parameters[0].name, PROMPT_TYPE_PARAMETER);
  });
});

suite("CL: 条件表示の欄は基本の画面・説明の箇条書き（実操作調査 P17）", () => {
  const dcl = load("cl/ja/DCL.json");
  const len = dcl.parameters.find(p => p.name === "LEN")!;
  test("DCL の LEN / VALUE は F10 の奥ではなく基本の画面の欄（CDML の PmtCtl=PMTCTL）", () => {
    assert.equal(len.basic, true);
    assert.equal(dcl.parameters.find(p => p.name === "VALUE")?.basic, true);
  });
  test("LEN の説明に最大長の一覧が入る（以前は「次の通りです。」で切れていた）", () => {
    assert.match(len.help ?? "", /最大長は次の通りです。\n\n・10進数-- 15桁/u);
    assert.match(len.help ?? "", /・文字-- 32767バイト/u);
  });
});

suite("C 仕様の演算項目のヘルプ（命令ごとの意味。P18）", () => {
  test("入れた命令での欄の意味が出る", () => {
    assert.equal(opcodeFieldHelp("C-SPEC", "FACTOR2", "CHAIN", "ja"), "CHAIN の演算項目 2: 名前 (ファイルまたはレコード様式)");
    assert.equal(opcodeFieldHelp("C-SPEC", "RESIND_EQ", "READC", "ja"), "READC の等しい: EOF");
    assert.equal(opcodeFieldHelp("C-NEW", "COND", "EVAL(H)", "ja"), "EVAL の拡張演算項目 2: 割り当てステートメント");
    assert.equal(opcodeFieldHelp("C-SPEC", "FACTOR1", "SETON", "ja"), "SETON ではこの欄を使いません。");
    assert.equal(opcodeFieldHelp("C-SPEC", "FACTOR2", "", "ja"), undefined);
    assert.equal(opcodeFieldHelp("D-SPEC", "NAME", "CHAIN", "ja"), undefined);
  });
  test("ヘルプの先頭に足される（命令を変えれば変わる）", () => {
    const cSpec = load("rpg/ile/ja/C-SPEC.json");
    const help = (opcode: string) =>
      toSerializableState(cSpec, buildInitialState(cSpec, { OPCODE: opcode })).fields.find(f => f.name === "FACTOR2")?.help ?? "";
    assert.match(help("CHAIN"), /^CHAIN の演算項目 2: 名前/u);
    assert.match(help("ADD"), /^ADD の演算項目 2: 加数/u);
  });
});
