import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildRuleContext,
  checkDependencies,
  createCdmlEvaluator,
  promptControlHolds
} from "../../src/prompter/cdmlRules";
import { buildInitialState } from "../../src/prompter/model";
import { buildHtml, toSerializableState } from "../../src/prompter/binding";
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
    const resolve = buildRuleContext(sndpgmmsg);

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
    const resolve = buildRuleContext(sndpgmmsg);

    // どちらも未指定なら、まだ何も言わない（実機の F4 も入力前は出さない）。
    assert.deepEqual(checkDependencies(sndpgmmsg, { MSG: "", MSGID: "" }, resolve), []);

    // 両方指定 → 2 個なので違反。exclusive ではこの「ちょうど1つ」を表せない。
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
    const asIs = createCdmlEvaluator({});

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
    const asIs = createCdmlEvaluator({});
    assert.equal(promptControlHolds(groups, { DEV: "*TAPE *SAVF" }, asIs), true);
  });

  test("グループを OR で連ねられる（旧スキーマの all は AND のみ）", () => {
    const asIs = createCdmlEvaluator({});
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
          valueMap: { "*YES": "1", "*NO": "0" }
        },
        { name: "SUB", description: "sub", inputType: "text", required: false }
      ]
    };
    const resolve = buildRuleContext(definition);
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

  /* ---------------------------------------------------------------- *
   * 生成した実データでの検証。
   *
   * 手で組んだ定義で通っても、生成スクリプトが実際に書いた JSON が
   * 消費経路に届いているとは限らない（死蔵は「置いただけ」で起きる）。
   * ---------------------------------------------------------------- */
  const loadCl = (name: string): PrompterDefinition =>
    JSON.parse(
      readFileSync(
        join(__dirname, `../../../resources/prompter/cl/ja/${name}.json`),
        "utf8"
      )
    );

  // dependencies を持つ全コマンド（生成結果から起こしたもの）。
  const DEPENDENCY_COMMANDS = ["ADDCMNE", "ADDMSGD", "ADDPJE", "ADDRTGE", "ADDWSE", "CHGCMDDFT", "CHGJOBD", "CHGMSGD", "CHGMSGQ", "CHGOBJD", "CHGOUTQ", "CHGPF", "CHGPGM", "CHGPJE", "CHGPRTF", "CHGRTGE", "CHGSPLFA", "CHGSRCPF", "CHGWSE", "CHGWTR", "CHKOBJ", "CLRLIB", "CPYF", "CPYSPLF", "CPYSRCF", "CRTBNDCL", "CRTBNDRPG", "CRTCBLMOD", "CRTCLMOD", "CRTCMD", "CRTDSPF", "CRTDTAARA", "CRTDTAQ", "CRTDUPOBJ", "CRTLF", "CRTMNU", "CRTMSGQ", "CRTOUTQ", "CRTPF", "CRTPGM", "CRTPRTF", "CRTRPGMOD", "CRTSQLCBL", "CRTSQLCBLI", "CRTSQLPKG", "CRTSQLRPG", "CRTSQLRPGI", "CRTSRCPF", "CRTSRVPGM", "DCL", "DLTLIB", "DLTMSGQ", "DLTSPLF", "DLYJOB", "DSPDTAARA", "DSPF", "DSPFD", "DSPFFD", "DSPJOB", "DSPJOBLOG", "DSPLIB", "DSPMOD", "DSPOBJAUT", "DSPOBJD", "EDTF", "EDTOBJAUT", "GRTOBJAUT", "HLDSPLF", "MOVOBJ", "OPNQRYF", "OVRPRTF", "RCVMSG", "RGZPFM", "RLSSPLF", "RLSWTR", "RMVCMNE", "RMVMSG", "RMVWSE", "RNMM", "RNMOBJ", "RTVCLSRC", "RUNQRY", "RUNSQLSTM", "RVKOBJAUT", "SAVCHGOBJ", "SAVLIB", "SAVOBJ", "SBMJOB", "SNDMSG", "SNDPGMMSG", "SNDUSRMSG", "STRPRTWTR", "STRQMQRY", "STRSQL", "UPDSRVPGM", "VRYCFG", "WRKJOB", "WRKLIB", "WRKSPLF", "WRKWTR"];

  test("生成した SAVOBJ の PMTCTL が効く（DEV(*SAVF) で SAVF 欄が出る）", () => {
    const savobj = loadCl("SAVOBJ");
    // group に付いた規則が末端まで降りることも同時に見ている。
    const savfOf = (dev: string) =>
      buildInitialState(savobj, { DEV: dev }).fields.filter(
        f => f.parameter.name === "SAVF"
      );

    assert.equal(savfOf("*TAPE").every(f => !f.visible), true);
    assert.equal(savfOf("*SAVF").some(f => f.visible), true);
  });

  test("生成した SNDPGMMSG の DEP が効く（MSGID→MSGF）", () => {
    const sndpgmmsg = loadCl("SNDPGMMSG");
    const errorsFor = (values: Record<string, string>) =>
      buildInitialState(sndpgmmsg, values).constraintErrors;

    // MSGID を入れて MSGF が空なら CPD2441 が出る。
    assert.equal(
      errorsFor({ MSG: "", MSGID: "CPF9898", MSGF: "" }).some(e =>
        e.includes("CPD2441")
      ),
      true
    );
    // MSGF を入れれば消える。
    assert.equal(
      errorsFor({ MSG: "", MSGID: "CPF9898", MSGF: "QCPFMSG" }).some(e =>
        e.includes("CPD2441")
      ),
      false
    );
  });

  test("生成した valueMap が内部値への変換に使われる", () => {
    // ADDMSGD の TYPE は *CHAR を内部値 C として比較する。
    const addmsgd = loadCl("ADDMSGD");
    const type = addmsgd.parameters.find(p => p.name === "TYPE");
    assert.ok(type?.valueMap, "TYPE に valueMap が生成されている");
    assert.equal(type?.valueMap?.["*CHAR"], "C");

    const resolve = buildRuleContext(addmsgd);
    assert.equal(resolve.resolve("TYPE", "*CHAR"), "C");
  });

  /* ---------------------------------------------------------------- *
   * 一度出した欠陥。どれも「黙って壊れる」種類。
   * ---------------------------------------------------------------- */

  test("既定値のままは「指定された(SPCFD)」ではない", () => {
    // これを取り違えると、開いた瞬間に誤った違反が並ぶ。
    // 実際 dependencies を持つ 100 コマンド中 47 コマンドで出ていた。
    const definition: PrompterDefinition = {
      keyword: "Z",
      description: "z",
      parameters: [
        {
          name: "RPYMSGQ",
          description: "応答メッセージ待ち行列",
          inputType: "text",
          required: false,
          defaultValue: "*PGMQ"
        },
        {
          name: "MSGTYPE",
          description: "メッセージ・タイプ",
          inputType: "text",
          required: false,
          defaultValue: "*INFO"
        }
      ],
      dependencies: [
        {
          controlRelation: "SPCFD",
          controlParameter: "RPYMSGQ",
          countRelation: "EQ",
          count: 1,
          messageId: "CPD2538",
          terms: [{ parameter: "MSGTYPE", relation: "EQ", compareValue: "*INQ" }]
        }
      ]
    };

    // 既定値のまま → RPYMSGQ は未指定。違反にしない。
    assert.deepEqual(
      buildInitialState(definition, {}).constraintErrors,
      []
    );
    // 既定値と違う値を入れて初めて規則が効く。
    assert.equal(
      buildInitialState(definition, { RPYMSGQ: "MYLIB/MYQ", MSGTYPE: "*INFO" })
        .constraintErrors.length,
      1
    );
  });

  test("違反の文面は日本語で、メッセージ ID は末尾に残る", () => {
    // CDML はメッセージ ID しか持たず、生の CPD2441 を出しても意味が通らない。
    // 生成した実データで確かめる（手で書いた message があると素通りするため）。
    const [violation] = checkDependencies(loadCl("SNDPGMMSG"), {
      MSG: "",
      MSGID: "CPF9898",
      MSGF: ""
    });
    assert.equal(violation.message, "MSGID を指定した場合、MSGF を指定してください。(CPD2441)");
  });

  test("生成した定義に XML の実体参照が残っていない", () => {
    // `X&apos;&apos;` のような値がそのまま入ると、比較にも画面にも実体参照が出る。
    const addmsgd = JSON.stringify(loadCl("ADDMSGD"));
    assert.equal(/&(apos|quot|amp|lt|gt);/.test(addmsgd), false);
  });

  test("dependencies を持つ全コマンドが、開いただけではエラーを出さない", () => {
    // 実機の F4 も入力前は何も出さない。既定値のまま赤字が並ぶと警告として
    // 機能しなくなる（model.ts の初期表示の方針と揃える）。
    const noisy: string[] = [];
    for (const name of DEPENDENCY_COMMANDS) {
      const definition = loadCl(name);
      if (buildInitialState(definition, {}).constraintErrors.length > 0) {
        noisy.push(name);
      }
    }
    assert.deepEqual(noisy, []);
  });

  /* ---------------------------------------------------------------- *
   * WebView まで届いているか。
   *
   * model.ts まで届いていても、プロンプターの画面は入力のたびクライアント側で
   * 再評価する。そこに規則が渡っていなければ、開いた瞬間の一度きりで終わる
   * （実際 PR #93 はその状態で、dependencies は一度も画面に出ていなかった）。
   * ---------------------------------------------------------------- */
  const renderCl = (name: string): string => {
    const definition = loadCl(name);
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

  test("PMTCTL が入力欄の属性として出ている", () => {
    // script の中にも `data-prompt-control` の語は出るので、**script より前**
    // （＝実際の入力欄）に属性が書かれていることを見る。
    const html = renderCl("SAVOBJ");
    const body = html.slice(0, html.indexOf("<script"));
    const match = body.match(/data-prompt-control="([^"]*)"/);
    assert.ok(match, "入力欄に data-prompt-control が書き出されている");
    assert.ok(
      match![1].includes("controlParameter"),
      "属性の中身が規則そのものになっている"
    );
  });

  test("埋め込んだ評価器が WebView 側で動き、サーバと同じ答えを返す", () => {
    // toString() で埋め込んでいるため、壊れれば構文エラーか挙動差になる。
    // 実際に取り出して動かし、サーバ側の評価と突き合わせる。
    const definition = loadCl("SNDPGMMSG");
    const html = renderCl("SNDPGMMSG");

    const match = html.match(
      /const createCdmlEvaluator = ([\s\S]*?);\n    const CDML = createCdmlEvaluator\(([\s\S]*?)\);/
    );
    assert.ok(match, "埋め込まれた評価器と spec を取り出せる");

    // eslint-disable-next-line no-new-func
    const factory = new Function(`return (${match![1]});`)();
    const spec = JSON.parse(match![2]);
    const embedded = factory(spec);

    const scenarios: Record<string, string>[] = [
      {},
      { MSGID: "CPF9898" },
      { MSGID: "CPF9898", MSGF: "QCPFMSG" },
      { MSG: "HELLO", MSGID: "CPF9898", MSGF: "QCPFMSG" }
    ];
    for (const values of scenarios) {
      assert.deepEqual(
        embedded.checkDependencies(values),
        checkDependencies(definition, values),
        `シナリオ ${JSON.stringify(values)} でサーバと一致する`
      );
    }
  });

  test("埋め込んだ評価器で PMTCTL も同じ答えになる", () => {
    const definition = loadCl("SAVOBJ");
    const html = renderCl("SAVOBJ");
    const match = html.match(
      /const createCdmlEvaluator = ([\s\S]*?);\n    const CDML = createCdmlEvaluator\(([\s\S]*?)\);/
    );
    assert.ok(match);
    // eslint-disable-next-line no-new-func
    const embedded = new Function(`return (${match![1]});`)()(JSON.parse(match![2]));
    const server = buildRuleContext(definition);

    const savf = definition.parameters.find(p => p.name === "SAVF");
    const groups = savf?.promptControl;
    assert.ok(groups, "SAVOBJ の SAVF は promptControl を持つ");

    for (const dev of ["", "*TAPE", "*SAVF", "*TAPE *SAVF"]) {
      assert.equal(
        embedded.promptControlHolds(groups, { DEV: dev }),
        server.promptControlHolds(groups, { DEV: dev }),
        `DEV=${dev} でサーバと一致する`
      );
    }
  });
});
