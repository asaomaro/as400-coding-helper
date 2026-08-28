import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildInitialState } from "../../src/prompter/model";
import { toSerializableState } from "../../src/prompter/formModel";
import { parsePrompterMessage, STANDALONE_HOST, VSCODE_HOST } from "../../src/prompter/webview/protocol";
import { buildPrompterHtml, createNonce } from "../../src/prompter/webviewHtml";
import type { PrompterDefinition } from "../../src/prompter/types";

const load = (rel: string): PrompterDefinition =>
  JSON.parse(readFileSync(join(__dirname, "../../../resources/prompter", rel), "utf8"));

/**
 * WebView 側（VSCode 非依存の UI）の土台。
 *
 * 画面そのものは `dev/prompter-e2e.mjs` がブラウザで操作して確かめる。
 * ここで見るのは**そこへ渡すまでの取り決め**——コアの引数・契約・HTML の殻・
 * そして「`vscode` を持ち込んでいないこと」。
 */
suite("プロンプター WebView の土台", () => {
  suite("繰り返しの組数は呼び出し側が指定できる", () => {
    // 値からは復元しきれない。画面で「追加」を押した直後の組は空なので、
    // countOccurrences では数えられない。
    const definition = load("cmd/ja/PARM.json");
    const groupsOf = (state: ReturnType<typeof buildInitialState>): number =>
      new Set(
        state.fields
          .filter(field => field.parameter.name.startsWith("SNGVAL_"))
          .map(field => field.occurrence)
      ).size;

    test("指定しなければ従来どおり値から数える", () => {
      assert.equal(groupsOf(buildInitialState(definition, {})), 1);
      assert.equal(
        groupsOf(buildInitialState(definition, { "SNGVAL_E1#2": "X" })),
        2,
        "値が入っていれば 2 組"
      );
    });

    test("**空の組も指定すれば出る**（追加を押した直後の状態）", () => {
      const state = buildInitialState(definition, {}, { occurrences: { SNGVAL: 3 } });
      assert.equal(groupsOf(state), 3);
      assert.ok(
        state.fields.some(field => field.fieldName === "SNGVAL_E1#3"),
        "3 組目の入力欄名が連番になる"
      );
    });

    test("値から数えた件数の方が多ければそちらを採る", () => {
      const state = buildInitialState(
        definition,
        { "SNGVAL_E1#2": "X", "SNGVAL_E1#3": "Y" },
        { occurrences: { SNGVAL: 1 } }
      );
      assert.equal(groupsOf(state), 3, "書かれている値を落とさない");
    });

    test("定義の上限を超えない", () => {
      const parameter = definition.parameters.find(p => p.name === "SNGVAL");
      const max = parameter?.maxOccurrences ?? 0;
      assert.ok(max > 1, "SNGVAL は繰り返し指定できる");
      const state = buildInitialState(definition, {}, { occurrences: { SNGVAL: max + 5 } });
      assert.equal(groupsOf(state), max);
    });
  });

  suite("「必須なのに空」を咎めるのは確定のときだけ", () => {
    // 開いた瞬間に赤字が並ぶと警告として機能しない（実機の F4 も入力前は何も出さない）。
    // 以前はこの判定が WebView 側の JS に別に書かれていた。
    const definition = load("cl/ja/SNDPGMMSG.json");
    const errorOf = (name: string, reportEmptyRequired: boolean): string | undefined =>
      buildInitialState(definition, { MSGID: "CPF9898" }, { reportEmptyRequired }).fields.find(
        field => field.fieldName === name
      )?.error;

    test("初期表示では出さない", () => {
      assert.equal(errorOf("MSGF", false), undefined);
    });

    test("確定のときは出す", () => {
      assert.equal(errorOf("MSGF", true), "値の入力が必要です。");
    });

    test("既定は初期表示（引数なしの呼び出しを変えない）", () => {
      assert.equal(
        buildInitialState(definition, { MSGID: "CPF9898" }).fields.find(
          field => field.fieldName === "MSGF"
        )?.error,
        undefined
      );
    });
  });

  suite("UI → ホストのメッセージは受け口で検証する", () => {
    test("正しいものは通る", () => {
      assert.deepEqual(parsePrompterMessage({ type: "ready" }), { type: "ready" });
      assert.deepEqual(parsePrompterMessage({ type: "cancel" }), { type: "cancel" });
      assert.deepEqual(
        parsePrompterMessage({ type: "promptCommand", name: "CMD", value: "CALL" }),
        { type: "promptCommand", name: "CMD", value: "CALL" }
      );
      assert.deepEqual(
        parsePrompterMessage({ type: "submit", values: { PGM: "A", PARM: ["1", "2"] } }),
        { type: "submit", values: { PGM: "A", PARM: ["1", "2"] } }
      );
    });

    test("知らない型・欠けた欄は捨てる（例外にしない）", () => {
      for (const bad of [
        undefined,
        null,
        "submit",
        {},
        { type: "unknown" },
        { type: "promptCommand", name: "CMD" },
        { type: "promptCommand", name: 1, value: "x" },
        { type: "submit" },
        { type: "submit", values: "x" }
      ]) {
        assert.equal(parsePrompterMessage(bad), undefined, JSON.stringify(bad));
      }
    });

    test("**値が 1 つでも不正なら表ごと捨てる**", () => {
      // 桁で書き戻すので、欠けた値は「空欄で上書き」と区別が付かない。
      // 半分だけ書き戻された行を作らない。
      assert.equal(
        parsePrompterMessage({ type: "submit", values: { A: "ok", B: 1 } }),
        undefined
      );
      assert.equal(
        parsePrompterMessage({ type: "submit", values: { A: "ok", B: ["x", 2] } }),
        undefined
      );
    });
  });

  suite("ホストが何を肩代わりするか", () => {
    test("VSCode 版は全部ホストが持つ", () => {
      assert.equal(VSCODE_HOST.opensNestedPrompter, true);
      assert.equal(VSCODE_HOST.providesObjectCandidates, true);
      assert.equal(VSCODE_HOST.closesWindow, true);
    });

    test("単独起動では窓を閉じない（閉じる先が無い）", () => {
      assert.equal(STANDALONE_HOST.closesWindow, false);
    });
  });

  suite("HTML の殻", () => {
    const html = buildPrompterHtml({
      cspSource: "vscode-resource://x",
      nonce: "NONCE1",
      scriptUri: "https://x/prompter.js",
      styleUri: "https://x/prompter.css",
      title: "F4 プロンプター - SBMJOB"
    });

    test("**インライン script も inline style も許さない**", () => {
      // CSP を緩めると、静かに効かない style 属性を書いても気付けない。
      assert.ok(!html.includes("unsafe-inline"), "'unsafe-inline' が入っていない");
      assert.ok(!html.includes("unsafe-eval"));
      assert.match(html, /script-src 'nonce-NONCE1';/u);
    });

    test("束ねた資産を読む（中身は空の器）", () => {
      assert.ok(html.includes('<script nonce="NONCE1" src="https://x/prompter.js">'));
      assert.ok(html.includes('<link rel="stylesheet" href="https://x/prompter.css">'));
      assert.ok(html.includes('<div id="root"></div>'));
    });

    test("題名を逃がす", () => {
      const escaped = buildPrompterHtml({
        cspSource: "x",
        nonce: "n",
        scriptUri: "s",
        styleUri: "c",
        title: '<img src=x onerror="alert(1)">'
      });
      assert.ok(!escaped.includes("<img"), escaped.slice(escaped.indexOf("<title>"), 120));
    });

    test("nonce は毎回変わる（使い回すと意味が無い）", () => {
      assert.notEqual(createNonce(), createNonce());
      assert.equal(createNonce().length, 32);
    });
  });

  suite("WebView 側に vscode を持ち込んでいない", () => {
    // **型検査でも締め出している**（`tsconfig.webview.json` の `types: []`）が、
    // 一覧を手で数えると漏れる。実ファイルを機械で見る。
    // **ソースを読む**（`__dirname` は out-test 側なので 1 つ多く遡る）。
    // ui.ts / bridge.ts / main.ts は本体のビルドから外してあり、
    // コンパイル結果が存在しない。
    const dir = join(__dirname, "../../../src/prompter/webview");
    const sources = readdirSync(dir).filter(name => name.endsWith(".ts"));

    test("ファイルが揃っている", () => {
      assert.deepEqual(sources.sort(), ["bridge.ts", "main.ts", "protocol.ts", "ui.ts"]);
    });

    for (const name of sources) {
      test(`${name} は vscode を import しない`, () => {
        const text = readFileSync(join(dir, name), "utf8");
        assert.ok(!/from ["']vscode["']/u.test(text), `${name} が vscode を import している`);
        assert.ok(!/require\(["']vscode["']\)/u.test(text));
      });
    }

    test("描画モデルと書き戻しの組み立ても vscode を知らない", () => {
      // UI から直接呼ぶので、ここに vscode が入ると WebView が束ねられなくなる。
      for (const rel of ["formModel.ts", "commandText.ts", "webviewHtml.ts"]) {
        const text = readFileSync(join(__dirname, "../../../src/prompter", rel), "utf8");
        assert.ok(!/from ["']vscode["']/u.test(text), `${rel} が vscode を import している`);
      }
    });
  });

  suite("選択肢に無い値を握り潰さない", () => {
    // 列挙した値＝制限とは限らない。実機が Rstd=NO と言う欄（86 件）では
    // 任意の値を書ける。ADDPFM の SRCTYPE は定義済み値が *NONE だけ。
    const definition = load("cl/ja/ADDPFM.json");
    const optionsOf = (values: Record<string, string>) =>
      toSerializableState(definition, buildInitialState(definition, values)).fields.find(
        field => field.name === "SRCTYPE"
      )?.options?.map(option => option.value);

    test("原典の定義済み値は *NONE だけ（前提の確認）", () => {
      const parameter = definition.parameters.find(p => p.name === "SRCTYPE");
      assert.deepEqual(parameter?.options?.map(o => o.value), ["*NONE"]);
      assert.equal(parameter?.attributes?.restricted, false, "任意の値を書ける欄");
    });

    test("**ソースに書かれていた値が選択肢に無ければ足す**", () => {
      // 足さないと select が先頭を選ぶか無選択になり、**確定で RPGLE が消える**。
      assert.deepEqual(optionsOf({ SRCTYPE: "RPGLE" }), ["RPGLE", "*NONE"]);
    });

    test("既にある値は重複させない", () => {
      assert.deepEqual(optionsOf({ SRCTYPE: "*NONE" }), ["*NONE"]);
    });

    test("空欄なら足さない", () => {
      assert.deepEqual(optionsOf({ SRCTYPE: "" }), ["*NONE"]);
    });
  });

  suite("「制限」か「候補」かを画面へ渡す", () => {
    // 列挙した値＝制限とは限らない。実機が Rstd=NO と言う欄では任意の値を書ける。
    // **画面はこれを見て入力部品を変える**——`<select>` は一覧に無い値を打てないため。
    const restrictedOf = (rel: string, name: string): boolean | undefined => {
      const definition = load(rel);
      return toSerializableState(definition, buildInitialState(definition, {})).fields.find(
        field => field.name === name
      )?.restricted;
    };

    test("候補にすぎない欄は restricted:false が載る", () => {
      assert.equal(restrictedOf("cl/ja/ADDPFM.json", "SRCTYPE"), false);
    });

    test("制限のある欄は false にならない（振る舞いを変えない）", () => {
      // 未指定＝制限あり。`false` を立てるのは定義が明示した欄だけ。
      assert.notEqual(restrictedOf("cl/ja/ADDPFM.json", "SHARE"), false);
    });

    test("**該当は 108 欄あり、うち 57 欄は選択肢が 1 つしかない**", () => {
      // 選択肢 1 つの `<select>` は選択ではなく錠前で、その欄は実質入力できなかった。
      // 件数が動いたら、この変更の前提（どれだけの欄が助かるか）が変わっている。
      const dir = join(__dirname, "../../../resources/prompter");
      const flatten = (params: readonly any[]): any[] =>
        params.flatMap(p =>
          p.inputType === "group" && p.children?.length ? flatten(p.children) : [p]
        );

      let total = 0;
      let single = 0;
      for (const scope of ["cl/ja", "cl/en", "cmd/ja", "cmd/en"]) {
        const scopeDir = join(dir, scope);
        for (const file of readdirSync(scopeDir)) {
          const definition = JSON.parse(readFileSync(join(scopeDir, file), "utf8"));
          for (const parameter of flatten(definition.parameters)) {
            if (
              parameter.inputType === "dropdown" &&
              parameter.options?.length > 0 &&
              parameter.attributes?.restricted === false
            ) {
              total += 1;
              if (parameter.options.length === 1) single += 1;
            }
          }
        }
      }
      assert.equal(total, 108, "候補にすぎない選択欄の数");
      assert.equal(single, 57, "うち選択肢が 1 つしかない欄");
    });
  });

  suite("描画モデルは判定を持ち込まない", () => {
    test("相関の違反は画面が読む形で載る", () => {
      const definition = load("cl/ja/SNDPGMMSG.json");
      const model = toSerializableState(
        definition,
        buildInitialState(definition, { MSG: "HELLO", MSGID: "CPF9898" })
      );
      assert.ok(model.constraintErrors.length > 0);
    });

    test("**クライアント側で評価し直すための材料は載せない**", () => {
      // 以前は評価器の spec と制約の一覧を画面へ渡し、写しを動かしていた。
      // いまは UI がコアを直接呼ぶので、渡す必要が無い（渡すと写しが復活する）。
      const definition = load("cl/ja/SNDPGMMSG.json");
      const model = toSerializableState(definition, buildInitialState(definition, {}));
      const keys = Object.keys(model);
      for (const gone of ["evaluatorSpec", "constraintFields", "constraints"]) {
        assert.ok(!keys.includes(gone), `${gone} は載せない`);
      }
    });
  });
});
