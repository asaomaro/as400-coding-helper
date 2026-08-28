import "../src/prompter/webview/ui.css";
import "./prompter.css";
import { startPrompter } from "../src/prompter/webview/ui";
import type { Bridge } from "../src/prompter/webview/bridge";
import {
  parsePrompterMessage,
  STANDALONE_HOST,
  type EditorMessage,
  type HostMessage
} from "../src/prompter/webview/protocol";
import { buildClCommandBody, buildClCommandText } from "../src/prompter/commandText";
import { parseClCommand, mapParsedCommandToValues } from "../src/prompter/clCommandParser";
import type { ObjectCandidates, PrompterDefinition } from "../src/prompter/types";

import SBMJOB from "../resources/prompter/cl/ja/SBMJOB.json";
import SNDPGMMSG from "../resources/prompter/cl/ja/SNDPGMMSG.json";
import CRTBNDRPG from "../resources/prompter/cl/ja/CRTBNDRPG.json";
import ALCOBJ from "../resources/prompter/cl/ja/ALCOBJ.json";
import CALL from "../resources/prompter/cl/ja/CALL.json";
import SAVOBJ from "../resources/prompter/cl/ja/SAVOBJ.json";
import ADDPFM from "../resources/prompter/cl/ja/ADDPFM.json";
import PARM from "../resources/prompter/cmd/ja/PARM.json";

/**
 * F4 プロンプターの単独起動ハーネス。**検証用であり製品の一部ではない**（VSIX には入れない）。
 *
 * ## 何を確かめるためのものか
 *
 * プロンプターの UI は「VSCode 非依存の UI ＋ ホストの継ぎ目」で作ってある。
 * その主張が本当かは、**UI を 1 行も変えずに VSCode の外で動くか**でしか確かめられない。
 * ここは `Bridge` の別実装（`postMessage` ではなく直接呼び出し）を与えるだけで、
 * `ui.ts` も `protocol.ts` も、そして **コアの判定・書き戻しもそのまま**使う。
 *
 * ## ホストが持つもの
 *
 * - 定義の読み込み（VSCode 版は `jsonDefinitions.ts`。ここは同梱 JSON を埋め込む）
 * - 入れ子のプロンプター（VSCode 版は別パネル。ここは重ね表示）
 * - 確定後の書き戻し（VSCode 版は `WorkspaceEdit`。ここは行を描くだけ）
 *
 * **定義を `import` で埋め込む**のは、`file://` で開くと `fetch` が使えないため。
 */

/**
 * **実定義では踏めない形**を 1 本だけ持つ（DDS ハーネスの検証用サンプルと同じ考え方）。
 *
 * 同梱の 251 定義を全部見ても、次の 2 つは現れなかった:
 * - 追加パラメーター側（F10）に、**既定値の無い必須の欄**がある
 * - 条件で隠れる欄が必須になる
 *
 * どちらも「**見えない欄で確定を止めない**」という規則の要で、
 * 踏めないままだと後退しても誰も気付けない。
 */
const HIDDEN_REQUIRED: PrompterDefinition = {
  keyword: "FIXTURE",
  description: "検証用（見えない欄は咎めない）",
  parameters: [
    {
      name: "MODE",
      description: "方式",
      inputType: "dropdown",
      required: true,
      defaultValue: "*SIMPLE",
      basic: true,
      options: [
        { label: "*SIMPLE", value: "*SIMPLE" },
        { label: "*DETAIL", value: "*DETAIL" }
      ]
    },
    {
      name: "DETAIL",
      description: "方式が *DETAIL のときだけ出る必須の欄",
      inputType: "text",
      required: true,
      basic: true,
      visibleByDefault: false,
      dependsOn: [
        { effect: "visible", parameter: "MODE", equalsAny: ["*DETAIL"] },
        { effect: "required", parameter: "MODE", equalsAny: ["*DETAIL"] }
      ]
    },
    {
      name: "EXTRA",
      description: "追加パラメーター側の必須の欄",
      inputType: "text",
      required: true
    }
  ]
};

/** 同梱する定義。AC7 の各項目を 1 つ以上の定義が踏むように選んである。 */
const SAMPLES: { readonly label: string; readonly definition: PrompterDefinition }[] = [
  // 値がコマンドの欄（F4 in F4）／基本と追加の別（F10）
  { label: "SBMJOB — 値がコマンドの欄・追加パラメーター", definition: SBMJOB as PrompterDefinition },
  // dependsOn（MSGID→MSGF が条件必須）／相関制約／繰り返し group
  { label: "SNDPGMMSG — 条件必須・相関制約", definition: SNDPGMMSG as PrompterDefinition },
  // オブジェクト名の候補／PMTCTL の条件表示
  { label: "CRTBNDRPG — 候補一覧・条件表示", definition: CRTBNDRPG as PrompterDefinition },
  // 入れ子の group（要素リストの要素 1 が修飾名）
  { label: "ALCOBJ — 入れ子の囲み", definition: ALCOBJ as PrompterDefinition },
  // 繰り返し group が 2 つ（.cmd 側）
  { label: "PARM — 繰り返しの組", definition: PARM as PrompterDefinition },
  // CDML(PMTCTL) の条件表示（DEV の値で SAVF / MEDDFN が出入りする）
  { label: "SAVOBJ — PMTCTL の条件表示", definition: SAVOBJ as PrompterDefinition },
  // 「候補にすぎない」選択欄（SRCTYPE は定義済み値が *NONE だけだが RPGLE と書ける）
  { label: "ADDPFM — 候補にすぎない選択欄", definition: ADDPFM as PrompterDefinition },
  { label: "CALL — 入れ子で開く先", definition: CALL as PrompterDefinition },
  { label: "FIXTURE — 見えない欄は咎めない（検証用）", definition: HIDDEN_REQUIRED }
];

/**
 * 候補一覧。VSCode 版はワークスペースを走査するが、ここは作り物でよい
 * （**確かめたいのは「欄に紐づくか」であって、集め方ではない**）。
 */
const CANDIDATES: ObjectCandidates = {
  program: ["MYPGM", "ORDENTRY", "CUSTMNT"],
  file: ["QRPGLESRC", "CUSTMAS", "ORDDTL"],
  dataArea: ["LDA", "CONFIG"]
};

/** `postMessage` を挟まない `Bridge`。**UI から見た形は VSCode 版と同じ。** */
class DirectBridge implements Bridge {
  private toUi: ((message: HostMessage) => void) | undefined;
  private toHost: ((message: EditorMessage) => void) | undefined;

  post(message: EditorMessage): void {
    // ホスト側も**同じ検証**を通す（VSCode 版と条件を変えない）。
    const parsed = parsePrompterMessage(message);
    if (parsed === undefined) {
      console.warn("不正なメッセージを無視しました", message);
      return;
    }
    this.toHost?.(parsed);
  }

  onMessage(handler: (message: HostMessage) => void): void {
    this.toUi = handler;
  }

  serve(handler: (message: EditorMessage) => void): void {
    this.toHost = handler;
  }

  send(message: HostMessage): void {
    this.toUi?.(message);
  }
}

function must<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`${selector} がありません`);
  return node;
}

const outcome = must<HTMLElement>("#outcome");
const resultLine = must<HTMLElement>("#result");
const resultValues = must<HTMLElement>("#values");
const nested = must<HTMLElement>("#nested");
const nestedRoot = must<HTMLElement>("#nested-root");
const nestedKeyword = must<HTMLElement>("#nested-keyword");
const sampleSelect = must<HTMLSelectElement>("#sample");

const bridge = new DirectBridge();
let current: PrompterDefinition = SAMPLES[0].definition;

/** 入れ子のプロンプターを開き、確定した値（素の 1 行コマンド）を返す。 */
function openNested(currentValue: string): Promise<string | undefined> {
  const parsed = parseClCommand(currentValue.trim());
  // 欄に書かれているコマンドの定義を持っていればそれを、無ければ CALL を開く。
  // VSCode 版はここで実際の定義を読み、無ければ利用者に尋ねる。
  const definition =
    SAMPLES.find(sample => sample.definition.keyword === parsed?.keyword)?.definition ??
    (CALL as PrompterDefinition);

  return new Promise(resolve => {
    const inner = new DirectBridge();
    nestedKeyword.textContent = definition.keyword;
    nestedRoot.textContent = "";
    nested.classList.remove("hidden");

    const close = (built: string | undefined): void => {
      nested.classList.add("hidden");
      nestedRoot.textContent = "";
      resolve(built);
    };

    inner.serve(message => {
      switch (message.type) {
        case "ready":
          inner.send({
            type: "load",
            definition,
            values:
              parsed && parsed.keyword === definition.keyword
                ? mapParsedCommandToValues(definition, parsed)
                : {},
            objectCandidates: CANDIDATES,
            host: STANDALONE_HOST
          });
          return;
        case "submit":
          // 欄に入るのは値であってソース行ではないので、桁揃えも折り返しもしない。
          close(
            buildClCommandBody(definition, message.values, {
              presentParameters: Object.keys(parsed?.parameters ?? {})
            })
          );
          return;
        case "cancel":
          close(undefined);
          return;
        case "promptCommand":
          // 入れ子の入れ子は開かない（VSCode 版は開けるが、確かめたいのは 1 段目）。
          return;
      }
    });

    startPrompter(inner, nestedRoot);
  });
}

bridge.serve(message => {
  switch (message.type) {
    case "ready":
      bridge.send({
        type: "load",
        definition: current,
        values: {},
        objectCandidates: CANDIDATES,
        host: STANDALONE_HOST
      });
      return;

    case "submit": {
      outcome.textContent = "確定";
      // **書き戻しはコアの関数をそのまま呼ぶ。** ここで組み立て直すと、
      // 単独起動で見ている桁が VSCode 版と別物になる。
      resultLine.textContent = buildClCommandText(current, message.values);
      resultValues.textContent = JSON.stringify(message.values, null, 1);
      return;
    }

    case "cancel":
      outcome.textContent = "取り消し";
      resultLine.textContent = "";
      resultValues.textContent = "";
      return;

    case "promptCommand":
      void openNested(message.value).then(built => {
        if (built !== undefined) {
          bridge.send({ type: "setValue", name: message.name, value: built });
        }
      });
      return;
  }
});

for (const [index, sample] of SAMPLES.entries()) {
  const option = document.createElement("option");
  option.value = String(index);
  option.textContent = sample.label;
  sampleSelect.appendChild(option);
}

sampleSelect.addEventListener("change", () => {
  current = SAMPLES[Number(sampleSelect.value)]?.definition ?? SAMPLES[0].definition;
  outcome.textContent = "";
  resultLine.textContent = "";
  resultValues.textContent = "";
  // 定義を替えたら読み込み直す。UI は `load` を受け直すだけでよい。
  bridge.send({
    type: "load",
    definition: current,
    values: {},
    objectCandidates: CANDIDATES,
    host: STANDALONE_HOST
  });
});

const mainRoot = must<HTMLElement>("#root");

// 触ったら前回の結果を消す。**確定できなかったことが分かる形にする**——
// 残しておくと「止まったのか、前の確定が残っているのか」が見分けられない。
mainRoot.addEventListener("input", () => {
  outcome.textContent = "";
});
mainRoot.addEventListener("change", () => {
  outcome.textContent = "";
});

startPrompter(bridge, mainRoot);
