import "../src/dds/webview/ui.css";
import "./standalone.css";
import { applyDdsEdits, validateDdsEdits } from "../src/core/dds/ddsEdit";
import { buildDspfRenderModel } from "../src/core/dds/dspfRenderModel";
import type { Bridge } from "../src/dds/webview/bridge";
import {
  parseEditorMessage,
  STANDALONE_HOST,
  type EditorMessage,
  type HostMessage
} from "../src/dds/webview/protocol";
import { startEditor } from "../src/dds/webview/ui";
import sample from "../../docs/src/CUSTMNT.dspf";

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
    this.bridge.send({ type: "load", model: this.model(), host: STANDALONE_HOST });
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
        this.bridge.send({ type: "load", model: this.model(), host: STANDALONE_HOST });
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
        const rejections = validateDdsEdits(this.lines, message.edits);
        if (rejections.length > 0) {
          this.bridge.send({ type: "rejected", model: this.model(), rejections });
          return;
        }
        const results = applyDdsEdits(this.lines, message.edits);
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

  private model(): ReturnType<typeof buildDspfRenderModel> {
    return buildDspfRenderModel(this.lines);
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

const SAMPLES = [{ name: "CUSTMNT.dspf", text: sample as unknown as string }];
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
