import type { SyncDirection, SyncRow } from "../bulkSync";

/**
 * 一括送受信の画面とホストの契約。**`vscode` を import しない。**
 *
 * 作法は DDS ビジュアルエディタ・プロンプターと同じ 4 点セット（契約 / bridge / 素の web の UI / エントリ）。
 * 判断（突き合わせ・上書き確認の対象）はホストと `bulkSync.ts` が持ち、画面は選んだ名前を返すだけ。
 */

export interface SyncView {
  /** 画面の見出し: `MYLIB/QRPGSRC`。 */
  readonly sourceFile: string;
  /** ワークスペースからの相対パス: `src/MYLIB/QRPGSRC`。 */
  readonly folder: string;
  readonly direction: SyncDirection;
  readonly rows: readonly SyncRow[];
  /** 一覧を取れていれば true（接続に失敗した直後は false）。 */
  readonly loaded: boolean;
}

/** ホスト → 画面。 */
export type HostMessage =
  | ({ readonly type: "state" } & SyncView)
  /** 処理中の表示。undefined で解除。処理中は操作できない。 */
  | { readonly type: "busy"; readonly text?: string }
  | { readonly type: "notice"; readonly kind: "info" | "error"; readonly text: string }
  /** 転送が終わった。選択を外す。 */
  | { readonly type: "transferred" };

/** 画面 → ホスト。 */
export type EditorMessage =
  | { readonly type: "ready" }
  | { readonly type: "refresh" }
  | { readonly type: "direction"; readonly direction: SyncDirection }
  | { readonly type: "diff"; readonly name: string }
  | { readonly type: "transfer"; readonly names: readonly string[] };

/** 画面から来たメッセージを検証する。不正なら undefined（ホストは無視する）。 */
export function parseSyncMessage(value: unknown): EditorMessage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case "ready":
      return { type: "ready" };
    case "refresh":
      return { type: "refresh" };
    case "direction":
      return message.direction === "download" || message.direction === "upload"
        ? { type: "direction", direction: message.direction }
        : undefined;
    case "diff":
      return typeof message.name === "string" ? { type: "diff", name: message.name } : undefined;
    case "transfer":
      return Array.isArray(message.names) && message.names.every(name => typeof name === "string")
        ? { type: "transfer", names: message.names as string[] }
        : undefined;
    default:
      return undefined;
  }
}
