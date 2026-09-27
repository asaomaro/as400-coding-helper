import "../src/sync/webview/ui.css";
import { startSync } from "../src/sync/webview/ui";
import type { Bridge } from "../src/sync/webview/bridge";
import { parseSyncMessage, type HostMessage } from "../src/sync/webview/protocol";
import {
  buildSyncRows,
  downloadFileName,
  isTransferable,
  overwriteConfirmations,
  readLocalMembers,
  type LocalFile,
  type RemoteMember,
  type SyncDirection
} from "../src/sync/bulkSync";

/**
 * 一括の送受信の単独起動ハーネス。**検証用であり製品の一部ではない**（VSIX には入れない）。
 *
 * ホスト（`bulkSyncPanel.ts`）の代わりに、IBM i とフォルダを配列で持つ。
 * 突き合わせ・上書き確認の対象・新しいファイル名は**製品と同じコア**（`bulkSync.ts`）を使う。
 * 確認は `window.confirm`、差分は `#log` に書くだけ。画面から来たメッセージは `window.__posted` に残す。
 */
const at = (text: string): number => Date.parse(`${text}Z`);
const remote: RemoteMember[] = [
  { name: "CUST10", sourceType: "RPGLE", text: "顧客保守", lines: 200, changed: at("2026-09-25T08:30:00") },
  { name: "ORDR01", sourceType: "RPGLE", text: "受注入力", lines: 120, changed: at("2026-09-26T05:02:00") },
  { name: "ORDR02", sourceType: "CLLE", text: "受注 CL", lines: 80, changed: at("2026-09-01T00:00:00") },
  { name: "PRTORD", sourceType: "PRTF", text: "", lines: 30, changed: at("2026-09-20T00:00:00") }
];
const local: LocalFile[] = [
  { fileName: "CUST10-顧客保守.rpgle", lines: 200, modified: at("2026-09-25T08:30:00") },
  { fileName: "ORDR01-受注入力.rpgle", lines: 118, modified: at("2026-09-20T01:11:00") },
  { fileName: "PRTORD.prtf", lines: 31, modified: at("2026-09-27T00:00:00") },
  { fileName: "LOCAL1-手元だけ.rpgle", lines: 5, modified: at("2026-09-27T01:00:00") },
  { fileName: "1BAD.rpgle", lines: 1, modified: 0 }
];
let direction: SyncDirection = "download";
const posted: unknown[] = [];
(window as unknown as { __posted: unknown[] }).__posted = posted;
const log = (text: string): void => {
  const node = document.getElementById("log");
  if (node) node.textContent += `${text}\n`;
};

let deliver: (message: HostMessage) => void = () => undefined;
const send = (message: HostMessage): void => {
  setTimeout(() => deliver(message), 0);
};
const rows = () => buildSyncRows(direction, remote, readLocalMembers(local));
const state = (): void => send({ type: "state", sourceFile: "MYLIB/QRPGSRC", folder: "src/MYLIB/QRPGSRC", direction, rows: rows(), loaded: true });

const bridge: Bridge = {
  post(value) {
    posted.push(value);
    const message = parseSyncMessage(value);
    if (message === undefined) return;
    switch (message.type) {
      case "ready":
      case "refresh":
        state();
        return;
      case "direction":
        direction = message.direction;
        state();
        return;
      case "diff":
        log(`差分: ${message.name}`);
        return;
      case "transfer": {
        const current = rows();
        const chosen = current.filter(row => message.names.includes(row.name) && isTransferable(row));
        const newer = overwriteConfirmations(current, message.names);
        if (newer.length > 0) {
          if (!window.confirm(`転送先の方が新しいメンバー: ${newer.join("、")}。上書きしますか？`)) return;
        }
        send({ type: "busy", text: `転送しています（${chosen.length} 件）` });
        for (const row of chosen) {
          const now = Date.now() - (Date.now() % 1000);
          if (direction === "download") {
            const source = remote.find(entry => entry.name === row.name)!;
            const fileName = row.target?.fileName ?? downloadFileName(source);
            const index = local.findIndex(entry => entry.fileName === fileName);
            const file = { fileName, lines: source.lines, modified: source.changed };
            if (index >= 0) local[index] = file; else local.push(file);
          } else {
            const file = local.find(entry => entry.fileName === row.source?.fileName)!;
            const index = remote.findIndex(entry => entry.name === row.name);
            const member = { name: row.name, sourceType: row.source!.sourceType, text: row.source!.text, lines: file.lines, changed: now };
            if (index >= 0) remote[index] = member; else remote.push(member);
            // 製品は送った後に IBM i の日時へ揃える。
            local[local.indexOf(file)] = { ...file, modified: now };
          }
        }
        log(`転送: ${direction} ${chosen.map(row => row.name).join(",")}`);
        send({ type: "busy" });
        send({ type: "transferred" });
        state();
        send({ type: "notice", kind: "info", text: `${message.names.length} 件を転送しました。` });
        return;
      }
    }
  },
  onMessage(handler) {
    deliver = handler;
  }
};

const root = document.getElementById("root");
if (root !== null) startSync(bridge, root);
