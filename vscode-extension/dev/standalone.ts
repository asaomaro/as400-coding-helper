/**
 * 単独起動（スタンドアロン）ハーネス。**検証用であり製品の一部ではない**（VSIX には入れない）。
 *
 * ## 何を確かめるためのものか
 *
 * design DD7 は「**スタンドアロンが本体・VSCode は埋め込み先の 1 つ**」とした。
 * その主張が本当かは、**UI を 1 行も変えずに VSCode の外で動くか**でしか確かめられない。
 * このハーネスは `Bridge` の別実装（`postMessage` ではなく直接呼び出し）を与えるだけで、
 * `ui.ts` も `protocol.ts` も共有している——**継ぎ目が本当に継ぎ目になっているかの検証。**
 *
 * ## ホストが肩代わりしないものは自前で持つ（DD8）
 *
 * `providesFileIO` / `providesUndo` を `false` で宣言し、その 2 つ（ファイル操作・undo）は
 * このハーネス自身が UI の外側の帯として持つ。VSCode 版ではどちらもホストが担う。
 */

import "../src/dds/webview/ui.css";
import "./standalone.css";
import {
  applyOps,
  buildRenderModel,
  decodeSource,
  parse,
  PatchRejectedError,
  type PatchOp,
  type RenderModel
} from "@as400/dds-core";
import type { Bridge } from "../src/dds/webview/bridge";
import type {
  Host,
  HostMessage,
  WebviewMessage
} from "../src/dds/webview/protocol";
import { startEditor } from "../src/dds/webview/ui";
import dbcsConst from "../../packages/dds-core/test/fixtures/dbcs-const.dspf";
import goldenA from "../../packages/dds-core/test/fixtures/golden-a.dspf";
import messy from "../../packages/dds-core/test/fixtures/messy.dspf";
import realGrid from "../../packages/dds-core/test/fixtures/real-gridtst3.dspf";

/** スタンドアロンのホスト能力。VSCode 版（`VSCODE_HOST`）と対になる。 */
const STANDALONE_HOST: Host = {
  name: "standalone",
  providesFileIO: false,
  providesUndo: false,
  providesCommandPalette: false,
  // ソース面を自前で持っているので、行へのジャンプはできる。
  canOpenTextEditor: true,
  hasPrompter: false
};

const SAMPLES: ReadonlyArray<{ name: string; text: string }> = [
  { name: "dbcs-const.dspf（DBCS 定数）", text: dbcsConst },
  { name: "golden-a.dspf（ゴールデン採取済み）", text: goldenA },
  { name: "messy.dspf（コメント・継続行あり）", text: messy },
  { name: "real-gridtst3.dspf（実機由来）", text: realGrid }
];

/**
 * UI とホストを直接つなぐ `Bridge`。
 *
 * VSCode 版は `postMessage` を挟むが、**UI から見た形は同じ**。
 * ここが「同じインターフェースを満たす実装をもう 1 つ書くだけ」の実物。
 */
class DirectBridge implements Bridge {
  private handler: ((message: HostMessage) => void) | undefined;
  private receiver: ((message: WebviewMessage) => void) | undefined;

  post(message: WebviewMessage): void {
    this.receiver?.(message);
  }

  onMessage(handler: (message: HostMessage) => void): void {
    this.handler = handler;
  }

  /** ホスト側の受け口を差し込む。 */
  serve(receiver: (message: WebviewMessage) => void): void {
    this.receiver = receiver;
  }

  /** ホスト → UI。 */
  send(message: HostMessage): void {
    this.handler?.(message);
  }
}

class StandaloneHost {
  private text = "";
  private original = "";
  private name = "";
  private history: string[] = [];

  constructor(
    private readonly bridge: DirectBridge,
    private readonly view: {
      readonly source: HTMLElement;
      readonly sourceName: HTMLElement;
      readonly byteState: HTMLElement;
    }
  ) {
    bridge.serve(message => this.receive(message));
  }

  load(name: string, text: string): void {
    this.name = name;
    this.text = text;
    this.original = text;
    this.history = [];
    this.bridge.send({ type: "load", model: this.model(), host: STANDALONE_HOST });
    this.renderSource();
  }

  /** ホストが肩代わりしない undo（DD8 の「自前で持つ」側）。 */
  undo(): void {
    const previous = this.history.pop();
    if (previous === undefined) {
      return;
    }
    this.text = previous;
    this.bridge.send({ type: "applied", model: this.model() });
    this.renderSource();
  }

  save(): void {
    const blob = new Blob([this.text], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = this.name || "edited.dspf";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private receive(message: WebviewMessage): void {
    switch (message.type) {
      case "ready":
        this.bridge.send({
          type: "load",
          model: this.model(),
          host: STANDALONE_HOST
        });
        break;
      case "patch":
        this.applyPatch(message.ops);
        break;
      case "openSource":
        this.revealSource(message.sourceLine);
        break;
    }
  }

  private applyPatch(ops: readonly PatchOp[]): void {
    try {
      // **VSCode 版とまったく同じ呼び出し。** 判断は core にあり、ホストは経路を用意するだけ。
      const result = applyOps(parse(this.text), ops);
      this.history.push(this.text);
      this.text = result.text;
      this.bridge.send({ type: "applied", model: this.model() });
      this.renderSource();
    } catch (error) {
      if (error instanceof PatchRejectedError) {
        this.bridge.send({
          type: "rejected",
          reason: error.message,
          diagnostics: error.diagnostics.map(diagnostic => ({ ...diagnostic })),
          model: this.model()
        });
        return;
      }
      throw error;
    }
  }

  private model(): RenderModel {
    return buildRenderModel(parse(this.text));
  }

  /** ソース面を描く。**読み込み時から変わった行に印を付ける**（AC2 をその場で見るため）。 */
  private renderSource(): void {
    const current = splitLines(this.text);
    const before = splitLines(this.original);

    this.view.sourceName.textContent = this.name;
    this.view.source.replaceChildren(
      ...current.map((line, index) => {
        const row = document.createElement("div");
        row.className = "line";
        row.dataset.line = String(index);
        if (line !== before[index]) {
          row.classList.add("changed");
        }
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

    const changed = current.filter(
      (line, index) => line !== before[index]
    ).length;
    const lengthChanged = current.length !== before.length;
    this.view.byteState.textContent = lengthChanged
      ? `行数が変わりました（${before.length} → ${current.length}）／変更行 ${changed}`
      : changed === 0
        ? "読み込み時から変更なし"
        : `変更行 ${changed} 行（他の ${current.length - changed} 行はバイト不変）`;
  }

  private revealSource(sourceLine: number): void {
    const row = this.view.source.querySelector<HTMLElement>(
      `.line[data-line="${sourceLine}"]`
    );
    if (row === null) {
      return;
    }
    this.view.source.querySelectorAll(".line.focus").forEach(element => {
      element.classList.remove("focus");
    });
    row.classList.add("focus");
    row.scrollIntoView({ block: "center" });
  }
}

function splitLines(text: string): string[] {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const body = text.endsWith(eol) ? text.slice(0, -eol.length) : text;
  return body === "" ? [] : body.split(eol);
}

function must<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`要素が見つかりません: ${selector}`);
  }
  return element;
}

const bridge = new DirectBridge();
const host = new StandaloneHost(bridge, {
  source: must("#source"),
  sourceName: must("#sourceName"),
  byteState: must("#byteState")
});

startEditor(bridge, must("#editor"));

const sample = must<HTMLSelectElement>("#sample");
SAMPLES.forEach((entry, index) => {
  const option = document.createElement("option");
  option.value = String(index);
  option.textContent = entry.name;
  sample.appendChild(option);
});
sample.addEventListener("change", () => {
  const entry = SAMPLES[Number(sample.value)];
  host.load(entry.name.replace(/（.*$/, ""), entry.text);
});

must<HTMLInputElement>("#open").addEventListener("change", event => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file === undefined) {
    return;
  }
  void file.arrayBuffer().then(buffer => {
    // **エンコーディングの判定も core に任せる**（AC10 の経路をそのまま通す）。
    const decoded = decodeSource(new Uint8Array(buffer));
    host.load(file.name, decoded.text);
  });
});

must("#undo").addEventListener("click", () => host.undo());
must("#save").addEventListener("click", () => host.save());
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "z") {
    event.preventDefault();
    host.undo();
  }
});

host.load("dbcs-const.dspf", SAMPLES[0].text);
