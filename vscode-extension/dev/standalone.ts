import "../src/dds/webview/ui.css";
import "./standalone.css";
import {
  applyDdsEdits,
  validateDdsEdits,
  type EditableDdsType
} from "../src/core/dds/ddsEdit";
import { buildDspfRenderModel } from "../src/core/dds/dspfRenderModel";
import { buildPrtfRenderModel } from "../src/core/dds/prtfRenderModel";
import type { Bridge } from "../src/dds/webview/bridge";
import {
  parseEditorMessage,
  STANDALONE_HOST,
  type EditorMessage,
  type HostMessage
} from "../src/dds/webview/protocol";
import type { DdsKeywordHelp } from "../src/core/dds/ddsKeywords";
import { startEditor } from "../src/dds/webview/ui";
import sample from "../../docs/src/CUSTMNT.dspf";
import report from "../../docs/src/CUSTRPT.prtf";
import keywordTables from "../resources/completion/dds-keywords.json";

/**
 * 原典から生成したキーワードの解説。**日本語で固定**——
 * 単独起動は設定を持たないホストなので、切り替える先が無い
 * （VSCode 側は `rpgClSupport.language` に従う）。
 */
const KEYWORD_HELP = (keywordTables as Record<string, DdsKeywordHelp[]>)["DDS-DSPF"];

/**
 * 単独起動ハーネス。**検証用であり製品の一部ではない**（VSIX には入れない）。
 *
 * ## 何を確かめるためのものか
 *
 * このエディタは「VSCode 非依存の UI ＋ ホストの継ぎ目」で作ってある。
 * その主張が本当かは、**UI を 1 行も変えずに VSCode の外で動くか**でしか確かめられない。
 * ここは `Bridge` の別実装（`postMessage` ではなく直接呼び出し）を与えるだけで、
 * `ui.ts` も `protocol.ts` も、そして **core の編集エンジンもそのまま**使う。
 *
 * ホストが肩代わりしないもの（`providesFileIO` / `providesUndo` が false）は、
 * この殻が自前で持つ——ファイルを開く・保存・元に戻す。
 */

class DirectBridge implements Bridge {
  private toUi: ((message: HostMessage) => void) | undefined;
  private toHost: ((message: EditorMessage) => void) | undefined;

  post(message: EditorMessage): void {
    // ホスト側も**同じ検証**を通す（VSCode 版と条件を変えない）。
    const parsed = parseEditorMessage(message);
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

class StandaloneHost {
  private lines: string[] = [];
  private original: string[] = [];
  private history: string[][] = [];
  private name = "";

  constructor(private readonly bridge: DirectBridge) {
    bridge.serve(message => void this.receive(message));
  }

  load(name: string, text: string): void {
    this.name = name;
    this.lines = text.split(/\r?\n/u);
    this.original = [...this.lines];
    this.history = [];
    this.bridge.send({
      type: "load",
      model: this.model(),
      host: STANDALONE_HOST,
      keywords: KEYWORD_HELP
    });
    this.renderSource();
  }

  undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.lines = previous;
    this.bridge.send({ type: "applied", model: this.model() });
    this.renderSource();
  }

  save(): void {
    const blob = new Blob([this.lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = this.name || "edited.dspf";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private async receive(message: EditorMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.bridge.send({
      type: "load",
      model: this.model(),
      host: STANDALONE_HOST,
      keywords: KEYWORD_HELP
    });
        return;
      case "openSource":
        this.reveal(message.sourceLine);
        return;
      case "askItem": {
        const item = await ask(message.kind);
        this.bridge.send({ type: "askItemResult", item: item ?? null });
        return;
      }
      case "edit": {
        // **VSCode 版とまったく同じ呼び出し。** 判定は core にあり、ホストは経路を用意するだけ。
        const rejections = validateDdsEdits(this.lines, message.edits, this.ddsType());
        if (rejections.length > 0) {
          this.bridge.send({ type: "rejected", model: this.model(), rejections });
          return;
        }
        const results = applyDdsEdits(this.lines, message.edits, this.ddsType());
        this.history.push([...this.lines]);
        for (const result of results) {
          this.lines.splice(
            result.replaceFrom,
            result.replaceTo - result.replaceFrom,
            ...result.lines
          );
        }
        this.bridge.send({ type: "applied", model: this.model() });
        this.renderSource();
        return;
      }
    }
  }

  /**
   * 描画モデル。**拡張子で種別を選ぶ**（VSCode 側と同じ規約）。
   *
   * 帳票は行が行送り（SPACE / SKIP）で決まるので、画面の配置解決では位置が出ない。
   * 紙面の大きさは設定を持たないホストなので `CRTPRTF` の既定のまま。
   */
  private model(): ReturnType<typeof buildDspfRenderModel> {
    return this.ddsType() === "DDS-PRTF"
      ? buildPrtfRenderModel(this.lines)
      : buildDspfRenderModel(this.lines);
  }

  /**
   * 編集の検証にも種別が要る（1 桁目の禁止は表示装置だけ / 行送りは印刷装置だけ）。
   * **描画と同じ判定を使う**——2 か所で拡張子を見ると食い違う。
   */
  private ddsType(): EditableDdsType {
    return this.name.toLowerCase().endsWith(".prtf") ? "DDS-PRTF" : "DDS-DSPF";
  }

  /** ソース面。**読み込み時から変わった行に印**を付ける（触っていない行が動かないことを見る）。 */
  private renderSource(): void {
    const pane = must("#source");
    must("#sourceName").textContent = this.name;
    pane.replaceChildren(
      ...this.lines.map((line, index) => {
        const row = document.createElement("div");
        row.className = "line";
        row.dataset.line = String(index + 1);
        if (line !== this.original[index]) row.classList.add("changed");
        const number = document.createElement("span");
        number.className = "no";
        number.textContent = String(index + 1).padStart(3, " ");
        const text = document.createElement("span");
        text.className = "text";
        text.textContent = line;
        row.append(number, text);
        return row;
      })
    );

    const changed = this.lines.filter((line, index) => line !== this.original[index]).length;
    must("#byteState").textContent =
      this.lines.length !== this.original.length
        ? `行数が変わりました（${this.original.length} → ${this.lines.length}）／変更行 ${changed}`
        : changed === 0
          ? "読み込み時から変更なし"
          : `変更行 ${changed} 行（他の ${this.lines.length - changed} 行はバイト不変）`;
  }

  private reveal(sourceLine: number): void {
    const row = document.querySelector<HTMLElement>(`#source .line[data-line="${sourceLine}"]`);
    row?.scrollIntoView({ block: "center" });
  }
}

/** 追加の内容を聞く。**ホストが入力手段を持つ**（VSCode なら showInputBox）。 */
function ask(kind: "field" | "constant"): Promise<Record<string, unknown> | undefined> {
  const dialog = must<HTMLDialogElement>("#ask");
  must("#ask-title").textContent = kind === "field" ? "フィールドを置く" : "定数を置く";
  const nameRow = must<HTMLInputElement>("#ask-name").closest("label");
  const lengthRow = must<HTMLInputElement>("#ask-length").closest("label");
  const textRow = must<HTMLInputElement>("#ask-text").closest("label");
  if (nameRow) nameRow.hidden = kind !== "field";
  if (lengthRow) lengthRow.hidden = kind !== "field";
  if (textRow) textRow.hidden = kind !== "constant";

  return new Promise(resolve => {
    const done = (): void => {
      dialog.removeEventListener("close", done);
      if (dialog.returnValue !== "ok") {
        resolve(undefined);
        return;
      }
      resolve(
        kind === "field"
          ? {
              kind: "field",
              name: must<HTMLInputElement>("#ask-name").value.trim().toUpperCase(),
              length: Number(must<HTMLInputElement>("#ask-length").value),
              dataType: "A",
              usage: "B"
            }
          : { kind: "constant", text: must<HTMLInputElement>("#ask-text").value }
      );
    };
    dialog.addEventListener("close", done);
    dialog.showModal();
  });
}

function must<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`要素が見つかりません: ${selector}`);
  return element;
}

const bridge = new DirectBridge();
const host = new StandaloneHost(bridge);
startEditor(bridge, must("#editor"), {
  askItem: kind => ask(kind)
});

/**
 * 2 本目は**描かれない項目を含む**小さな DDS。
 *
 * 位置欄が空の項目・画面に出ない用途（`H`）は配置解決で落ちるので**キャンバスに出ない**。
 * 一覧から手が届くことをここで実際に確かめられるようにしておく
 * （実サンプルの `CUSTMNT.dspf` には無い形なので、手で試すと見落とす）。
 */
const HIDDEN_SAMPLE = [
  "     A                                      DSPSIZ(24 80 *DS3)",
  "     A          R MAIN",
  "     A                                  1  2'見出し'",
  "     A            SHOWN         10A  B  3 20",
  "     A            NOPOS         10A  B",
  "     A            HIDDEN        10A  H",
  ""
].join("\n");

/**
 * 3 本目は**条件標識で見え方が変わる** DDS。
 *
 * `50` / `N50` は同じ桁に置いた排他の組（標識を倒すと片方だけが出る）、
 * `01` / `02` は**両方オンにすると重なる**組（実機で初めて分かる類の不具合）。
 * `30` はキーワードだけを条件付ける標識で、**項目の表示には効かないが一覧には出る**
 * ——論理単位から集めると取りこぼす形なので、ここで実際に確かめられるようにしておく。
 */
const INDICATOR_SAMPLE = [
  "     A                                      DSPSIZ(24 80 *DS3)",
  "     A          R MAIN",
  "     A                                  1  2'見出し'",
  "     A  50                              3  2'部門名'",
  "     A N50                              3  2'未定'",
  "     A  01        FLD1          10A  B  5  2",
  "     A  02        FLD2          10A  B  5  6",
  "     A  30                                  DSPATR(RI)",
  ""
].join("\n");

/**
 * 2 つの画面サイズを持つ様式。**位置の上書き行**（条件名 ＋ 位置だけの行）が
 * 2 次画面サイズでの位置を与える。原典（`DSPSIZ` の 例 2 / 例 3）の形。
 *
 * 実サンプルには 2 サイズのものが無く、この形は**実機でしか確かめられない**
 * 制約（条件名は 2 次を指し、上書き行にしか書けない）を持つので、
 * 触れる形を 1 本置いておく。
 */
const TWO_SIZE_SAMPLE = [
  "     A                                      DSPSIZ(24 80 27 132)",
  "     A          R MAIN",
  "     A                                  1  2'見出し'",
  "     A            FLDA          10A  B 23  2",
  "     A  *DS4                           26 40",
  "     A            FLDB          10A  B  5  2",
  ""
].join("\n");

const SAMPLES = [
  { name: "CUSTMNT.dspf", text: sample as unknown as string },
  { name: "hidden-items.dspf", text: HIDDEN_SAMPLE },
  { name: "indicators.dspf", text: INDICATOR_SAMPLE },
  { name: "two-sizes.dspf", text: TWO_SIZE_SAMPLE },
  // 帳票。**行は SPACE / SKIP で決まり、位置欄には桁だけが書かれる**——
  // 画面ファイルには無い形なので、ここで実際に触れるようにしておく。
  { name: "CUSTRPT.prtf", text: report as unknown as string }
];
const select = must<HTMLSelectElement>("#sample");
SAMPLES.forEach((entry, index) => {
  const option = document.createElement("option");
  option.value = String(index);
  option.textContent = entry.name;
  select.appendChild(option);
});
select.addEventListener("change", () => {
  const entry = SAMPLES[Number(select.value)];
  host.load(entry.name, entry.text);
});

must<HTMLInputElement>("#open").addEventListener("change", event => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  void file.text().then(text => host.load(file.name, text));
});
must("#undo").addEventListener("click", () => host.undo());
must("#save").addEventListener("click", () => host.save());

host.load(SAMPLES[0].name, SAMPLES[0].text);
