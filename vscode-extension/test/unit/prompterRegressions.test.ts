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
