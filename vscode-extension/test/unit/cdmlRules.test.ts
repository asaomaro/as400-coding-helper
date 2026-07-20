import { strict as assert } from "node:assert";
import {
  buildInternalValueResolver,
  checkDependencies,
  promptControlHolds
} from "../../src/prompter/cdmlRules";
import { buildInitialState } from "../../src/prompter/model";
import type { PrompterDefinition } from "../../src/prompter/types";

/**
 * CDML(DEP / PMTCTL) 由来の相関規則の評価。
 *
 * ここで確かめているのは、いずれも**旧スキーマ(dependsOn / constraints)では
 * 表せなかった形**。表せないまま近似すると黙って規則が効かなくなる。
 */
suite("CDML 由来の相関規則", () => {
  // SNDPGMMSG の実データを写したもの（docs/origin/cmddef/SNDPGMMSG.xml）。
  const sndpgmmsg: PrompterDefinition = {
    keyword: "SNDPGMMSG",
    description: "プログラム・メッセージ送信",
    parameters: [
      { name: "MSG", description: "メッセージ・テキスト", inputType: "text", required: false },
      { name: "MSGID", description: "メッセージ識別コード", inputType: "text", required: false },
      { name: "MSGF", description: "メッセージ・ファイル", inputType: "text", required: false }
    ],
    dependencies: [
      // MSGID を指定したら MSGF が必須。
      {
        controlRelation: "SPCFD",
        controlParameter: "MSGID",
        countRelation: "EQ",
        count: 1,
        messageId: "CPD2441",
        message: "MSGID を指定した場合は MSGF が必要です。",
        terms: [{ parameter: "MSGF", relation: "SPCFD" }]
      },
      // MSG と MSGID は、どちらか「ちょうど 1 つ」が必要。
      {
        controlRelation: "ALWAYS",
        countRelation: "EQ",
        count: 1,
        messageId: "CPD2536",
        message: "MSG と MSGID はどちらか一方を指定してください。",
        terms: [
          { parameter: "MSG", relation: "SPCFD" },
          { parameter: "MSGID", relation: "SPCFD" }
        ]
      }
    ]
  };

  test("SPCFD を条件に使える（旧スキーマは値の比較しかできない）", () => {
    const resolve = buildInternalValueResolver(sndpgmmsg);

    // MSGID だけ指定 → MSGF が無いので違反。
    const violations = checkDependencies(
      sndpgmmsg,
      { MSGID: "CPF9898", MSGF: "" },
      resolve
    );
    assert.deepEqual(
      violations.map(v => v.messageId),
      ["CPD2441"]
    );

    // MSGF も指定すれば解消する。
    assert.equal(
      checkDependencies(sndpgmmsg, { MSGID: "CPF9898", MSGF: "QCPFMSG" }, resolve).length,
      0
    );
  });

  test("「ちょうど1つ」を数えられる（exclusive は『1つまで』しか表せない）", () => {
    const resolve = buildInternalValueResolver(sndpgmmsg);

    // どちらも未指定 → 0 個なので違反。exclusive ではここを捕まえられない。
    assert.equal(
      checkDependencies(sndpgmmsg, { MSG: "", MSGID: "" }, resolve).some(
        v => v.messageId === "CPD2536"
      ),
      true
    );

    // 両方指定 → 2 個なので違反。
    assert.equal(
      checkDependencies(sndpgmmsg, { MSG: "HELLO", MSGID: "CPF9898", MSGF: "QCPFMSG" }, resolve)
        .some(v => v.messageId === "CPD2536"),
      true
    );

    // どちらか一方だけなら通る。
    assert.equal(
      checkDependencies(sndpgmmsg, { MSG: "HELLO" }, resolve).length,
      0
    );
  });

  test("制御条件が成立しない規則は違反にしない", () => {
    // MSGID 未指定なら CPD2441 は適用対象外。
    const violations = checkDependencies(sndpgmmsg, { MSG: "HELLO" });
    assert.equal(violations.some(v => v.messageId === "CPD2441"), false);
  });

  test("PMTCTL の条件表示（SAVOBJ の DEV(*SAVF) で SAVF を出す）", () => {
    const groups = [
      {
        controlParameter: "DEV",
        countRelation: "EQ" as const,
        count: 1,
        conditions: [{ relation: "EQ" as const, compareValue: "*SAVF" }]
      }
    ];
    const asIs = (_p: string, v: string) => v.trim().toUpperCase();

    assert.equal(promptControlHolds(groups, { DEV: "*SAVF" }, asIs), true);
    assert.equal(promptControlHolds(groups, { DEV: "*TAPE" }, asIs), false);
    assert.equal(promptControlHolds(groups, { DEV: "" }, asIs), false);
  });

  test("複数指定の制御パラメータでも一致を拾う", () => {
    // DEV は複数指定できる。単一値として比較すると *TAPE *SAVF で成立しなくなる。
    const groups = [
      {
        controlParameter: "DEV",
        countRelation: "GT" as const,
        count: 0,
        conditions: [{ relation: "EQ" as const, compareValue: "*SAVF" }]
      }
    ];
    const asIs = (_p: string, v: string) => v.trim().toUpperCase();
    assert.equal(promptControlHolds(groups, { DEV: "*TAPE *SAVF" }, asIs), true);
  });

  test("グループを OR で連ねられる（旧スキーマの all は AND のみ）", () => {
    const asIs = (_p: string, v: string) => v.trim().toUpperCase();
    const groups = [
      {
        controlParameter: "A",
        countRelation: "EQ" as const,
        count: 1,
        conditions: [{ relation: "EQ" as const, compareValue: "*YES" }]
      },
      {
        controlParameter: "B",
        countRelation: "EQ" as const,
        count: 1,
        logicalRelation: "OR" as const,
        conditions: [{ relation: "EQ" as const, compareValue: "*YES" }]
      }
    ];

    assert.equal(promptControlHolds(groups, { A: "*YES", B: "*NO" }, asIs), true);
    assert.equal(promptControlHolds(groups, { A: "*NO", B: "*YES" }, asIs), true);
    assert.equal(promptControlHolds(groups, { A: "*NO", B: "*NO" }, asIs), false);

    // AND なら両方必要。
    const andGroups = [groups[0], { ...groups[1], logicalRelation: "AND" as const }];
    assert.equal(promptControlHolds(andGroups, { A: "*YES", B: "*NO" }, asIs), false);
    assert.equal(promptControlHolds(andGroups, { A: "*YES", B: "*YES" }, asIs), true);
  });

  test("MapTo を通さないと条件が黙って成立しない", () => {
    // 実機の CDML では <Value> の 7 割に MapTo がある。表示値 *YES に対し
    // 内部値が 1 のような対応で、変換しないと比較が外れる。
    const definition: PrompterDefinition = {
      keyword: "X",
      description: "x",
      parameters: [
        {
          name: "OPT",
          description: "opt",
          inputType: "dropdown",
          required: false,
          options: [
            { label: "*YES", value: "*YES", mapTo: "1" },
            { label: "*NO", value: "*NO", mapTo: "0" }
          ]
        },
        { name: "SUB", description: "sub", inputType: "text", required: false }
      ]
    };
    const resolve = buildInternalValueResolver(definition);
    // CmpVal は内部値 "1"。
    const groups = [
      {
        controlParameter: "OPT",
        countRelation: "EQ" as const,
        count: 1,
        conditions: [{ relation: "EQ" as const, compareValue: "1" }]
      }
    ];

    assert.equal(promptControlHolds(groups, { OPT: "*YES" }, resolve), true);
    assert.equal(promptControlHolds(groups, { OPT: "*NO" }, resolve), false);
  });

  test("promptControl と DEP がプロンプターの状態まで届く", () => {
    // 定義に置いただけで消費経路に無い、という死蔵を防ぐための検査。
    const definition: PrompterDefinition = {
      keyword: "Y",
      description: "y",
      parameters: [
        { name: "DEV", description: "装置", inputType: "text", required: false },
        {
          name: "SAVF",
          description: "保管ファイル",
          inputType: "text",
          required: false,
          promptControl: [
            {
              controlParameter: "DEV",
              countRelation: "EQ",
              count: 1,
              conditions: [{ relation: "EQ", compareValue: "*SAVF" }]
            }
          ]
        }
      ],
      dependencies: [
        {
          controlRelation: "EQ",
          controlParameter: "DEV",
          controlCompareValue: "*SAVF",
          countRelation: "EQ",
          count: 1,
          messageId: "CPD0001",
          message: "DEV(*SAVF) のときは SAVF が必要です。",
          terms: [{ parameter: "SAVF", relation: "SPCFD" }]
        }
      ]
    };

    const hidden = buildInitialState(definition, { DEV: "*TAPE" });
    assert.equal(hidden.fields.find(f => f.fieldName === "SAVF")?.visible, false);
    assert.deepEqual(hidden.constraintErrors, []);

    const shown = buildInitialState(definition, { DEV: "*SAVF" });
    assert.equal(shown.fields.find(f => f.fieldName === "SAVF")?.visible, true);
    assert.deepEqual(shown.constraintErrors, ["DEV(*SAVF) のときは SAVF が必要です。"]);
  });
});
