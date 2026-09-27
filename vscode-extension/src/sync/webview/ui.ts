import type { SyncRow, SyncSide } from "../bulkSync";
import type { Bridge } from "./bridge";
import type { HostMessage, SyncView } from "./protocol";

/**
 * 一括送受信の画面。**判断はホストが持つ**——ここは表を描き、選んだ名前を返すだけ。
 *
 * CSP に `unsafe-inline` が無いので `style="…"` は使わない（クラスだけ）。
 */
export function startSync(bridge: Bridge, root: HTMLElement): void {
  let view: SyncView | undefined;
  let busy: string | undefined;
  let notice: { kind: "info" | "error"; text: string } | undefined;
  const selected = new Set<string>();

  const transferable = (row: SyncRow): boolean => row.source !== undefined && row.problem === undefined;

  function render(): void {
    root.replaceChildren();
    root.classList.toggle("busy", busy !== undefined);
    if (view === undefined) {
      root.append(element("p", "sync-empty", busy ?? "読み込み中…"));
      return;
    }
    const current = view;
    // 一覧が変わって選べなくなったものは外す。
    for (const name of [...selected]) {
      const row = current.rows.find(entry => entry.name === name);
      if (row === undefined || !transferable(row)) selected.delete(name);
    }

    const download = current.direction === "download";
    const header = element("div", "sync-header");
    header.append(element("h1", "sync-title", `IBM i ${current.sourceFile} ⇔ ${current.folder}`));

    const toolbar = element("div", "sync-toolbar");
    const directions = element("div", "sync-direction");
    directions.setAttribute("role", "radiogroup");
    for (const [direction, label] of [["download", "ダウンロード（IBM i → ローカル）"], ["upload", "アップロード（ローカル → IBM i）"]] as const) {
      const button = element("button", direction === current.direction ? "selected" : "", label);
      button.dataset.key = `direction:${direction}`;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(direction === current.direction));
      button.disabled = busy !== undefined;
      button.addEventListener("click", () => {
        if (direction === current.direction) return;
        selected.clear();
        bridge.post({ type: "direction", direction });
      });
      directions.append(button);
    }
    const refresh = element("button", "", "再読み込み");
    refresh.dataset.key = "refresh";
    refresh.disabled = busy !== undefined;
    refresh.addEventListener("click", () => bridge.post({ type: "refresh" }));
    const transfer = element("button", "primary", selected.size > 0 ? `転送（${selected.size} 件）` : "転送");
    transfer.dataset.key = "transfer";
    transfer.disabled = busy !== undefined || selected.size === 0;
    transfer.addEventListener("click", () => {
      const names = current.rows.filter(row => selected.has(row.name)).map(row => row.name);
      if (names.length > 0) bridge.post({ type: "transfer", names });
    });
    toolbar.append(directions, refresh, transfer);
    header.append(toolbar);
    root.append(header);

    if (busy !== undefined) root.append(element("p", "sync-busy", busy));
    if (notice !== undefined) {
      const box = element("p", `sync-notice ${notice.kind}`, notice.text);
      box.dataset.key = "notice";
      root.append(box);
    }

    if (current.rows.length === 0) {
      root.append(element("p", "sync-empty", current.loaded ? "メンバーがありません。" : "一覧を取得できませんでした。"));
      return;
    }

    const table = element("table", "sync-table");
    const head = element("thead");
    const headRow = element("tr");
    const all = document.createElement("input");
    all.type = "checkbox";
    all.dataset.key = "select-all";
    all.title = "全選択";
    const candidates = current.rows.filter(transferable);
    all.checked = candidates.length > 0 && candidates.every(row => selected.has(row.name));
    all.indeterminate = !all.checked && candidates.some(row => selected.has(row.name));
    all.disabled = busy !== undefined || candidates.length === 0;
    all.addEventListener("change", () => {
      if (all.checked) candidates.forEach(row => selected.add(row.name));
      else selected.clear();
      render();
    });
    const allCell = element("th", "check");
    allCell.append(all);
    headRow.append(
      allCell,
      element("th", "", "メンバー"),
      element("th", "", `転送元（${download ? "IBM i" : "ローカル"}）`),
      element("th", "", `転送先（${download ? "ローカル" : "IBM i"}）`),
      element("th", "", "状態"),
      element("th", "")
    );
    head.append(headRow);
    table.append(head);

    const body = element("tbody");
    for (const row of current.rows) {
      const tr = element("tr", row.problem !== undefined ? "unavailable" : "");
      tr.dataset.member = row.name;
      const check = document.createElement("input");
      check.type = "checkbox";
      check.dataset.key = `select:${row.name}`;
      check.checked = selected.has(row.name);
      check.disabled = busy !== undefined || !transferable(row);
      check.addEventListener("change", () => {
        if (check.checked) selected.add(row.name);
        else selected.delete(row.name);
        render();
      });
      const checkCell = element("td", "check");
      checkCell.append(check);

      const diffCell = element("td", "action");
      if (row.source !== undefined && row.target !== undefined) {
        const diff = element("button", "", "差分");
        diff.dataset.key = `diff:${row.name}`;
        diff.disabled = busy !== undefined;
        diff.addEventListener("click", () => bridge.post({ type: "diff", name: row.name }));
        diffCell.append(diff);
      }
      tr.append(
        checkCell,
        element("td", "name", row.name),
        side(row.source, row.newer === "source"),
        side(row.target, row.newer === "target"),
        element("td", "state", stateText(row)),
        diffCell
      );
      body.append(tr);
    }
    table.append(body);
    root.append(table);
  }

  bridge.onMessage((message: HostMessage) => {
    switch (message.type) {
      case "state": {
        const { type: _type, ...next } = message;
        view = next;
        break;
      }
      case "busy":
        busy = message.text;
        if (busy !== undefined) notice = undefined;
        break;
      case "notice":
        notice = { kind: message.kind, text: message.text };
        break;
      case "transferred":
        selected.clear();
        break;
    }
    render();
  });
  render();
  bridge.post({ type: "ready" });
}

function stateText(row: SyncRow): string {
  if (row.problem !== undefined) return row.problem;
  if (row.target === undefined) return "転送先に無し（新規）";
  switch (row.newer) {
    case "source":
      return "転送元が新しい";
    case "target":
      return "転送先が新しい";
    default:
      return "同じ日時";
  }
}

function side(value: SyncSide | undefined, newer: boolean): HTMLElement {
  const cell = element("td", newer ? "side newer" : "side");
  if (value === undefined) {
    cell.append(element("span", "absent", "（無し）"));
    return cell;
  }
  const line = element("div", "meta", `${formatTime(value.changed)}　${value.lines} 行　${value.sourceType}`);
  cell.append(line);
  if (value.text.length > 0) cell.append(element("div", "text", value.text));
  if (value.fileName !== undefined) cell.append(element("div", "file", value.fileName));
  return cell;
}

/** 手元の時刻で `YYYY-MM-DD HH:MM:SS`。 */
export function formatTime(time: number): string {
  const date = new Date(time);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
