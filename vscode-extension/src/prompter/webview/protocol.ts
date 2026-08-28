import type { ObjectCandidates, PrompterDefinition } from "../types";

/**
 * プロンプター UI とホストの契約。**`vscode` を import しない。**
 *
 * UI は素の web として書き、ホストとはこのメッセージだけで会話する。
 * VSCode 版は `postMessage` を挟み、単独起動版は直接呼ぶ——**UI から見た形は同じ**。
 * ここを崩すと、プロンプターは VSCode の外に出られなくなる。
 *
 * 形は DDS ビジュアルエディタ（`src/dds/webview/protocol.ts`）に合わせてある。
 * 2 つの WebView で作法を変えない。
 */

/**
 * ホストが何を肩代わりするか。
 *
 * 意味は「何ができるか」ではなく **「ホストが何を肩代わりするか」**。
 * `true` なら UI は自前の部品を降ろす。
 */
export interface PrompterHost {
  readonly name: "standalone" | "vscode";
  /**
   * 入れ子のプロンプター（F4 in F4）をホストが開く。
   * `false` なら UI は F4 の印を出さない——押しても何も起きない印を出さないため。
   */
  readonly opensNestedPrompter: boolean;
  /** オブジェクト名の候補をホストが集める。`false` なら候補一覧を作らない。 */
  readonly providesObjectCandidates: boolean;
  /**
   * 確定・取消で**窓を閉じるのはホスト**。
   * `false` の単独起動では閉じる先が無いので、UI は結果を残したままにする。
   */
  readonly closesWindow: boolean;
}

export const VSCODE_HOST: PrompterHost = {
  name: "vscode",
  opensNestedPrompter: true,
  providesObjectCandidates: true,
  closesWindow: true
};

export const STANDALONE_HOST: PrompterHost = {
  name: "standalone",
  // ハーネスが**同じ UI を重ねて**開く。VSCode 版では確かめられない経路なので、
  // 単独起動でこそ意味がある（`dev/prompter-standalone.ts`）。
  opensNestedPrompter: true,
  providesObjectCandidates: true,
  closesWindow: false
};

/** ホスト → UI。 */
export type HostMessage =
  | {
      readonly type: "load";
      readonly definition: PrompterDefinition;
      /** 入力欄名 → 初期値。ソース行から読み取ったもの。 */
      readonly values: Record<string, string>;
      readonly objectCandidates: ObjectCandidates;
      readonly host: PrompterHost;
    }
  /** 入れ子のプロンプターで確定した値を欄に戻す。 */
  | { readonly type: "setValue"; readonly name: string; readonly value: string };

/** UI → ホスト。 */
export type EditorMessage =
  | { readonly type: "ready" }
  /** 確定。複数値の欄だけが配列になる。 */
  | { readonly type: "submit"; readonly values: Record<string, string | string[]> }
  | { readonly type: "cancel" }
  /**
   * 値そのものがコマンドの欄（`SBMJOB` の `CMD` など）で、さらにプロンプターを開く。
   *
   * **開く手段はホストが持つ**（VSCode なら定義を読んで別パネル、単独起動なら重ね表示）。
   * UI は「この欄のいまの値で開いてほしい」と言うだけ。
   */
  | { readonly type: "promptCommand"; readonly name: string; readonly value: string };

/**
 * UI から来たメッセージを検証する。**不正なら `undefined`**。
 *
 * 例外を投げないのは、投げてもホスト側で握り潰すしかなく、
 * **1 通の不正メッセージでプロンプターが死ぬ**ほうが害が大きいため。
 */
export function parsePrompterMessage(value: unknown): EditorMessage | undefined {
  if (!isRecord(value)) return undefined;

  switch (value.type) {
    case "ready":
      return { type: "ready" };
    case "cancel":
      return { type: "cancel" };
    case "promptCommand":
      return typeof value.name === "string" && typeof value.value === "string"
        ? { type: "promptCommand", name: value.name, value: value.value }
        : undefined;
    case "submit": {
      const values = parseValues(value.values);
      return values === undefined ? undefined : { type: "submit", values };
    }
    default:
      return undefined;
  }
}

/**
 * 確定値の表を検証する。**1 つでも不正なら表ごと捨てる。**
 *
 * 半分だけ書き戻された行を作らない——桁で書き戻すので、
 * 欠けた値は「空欄で上書き」と区別が付かない。
 */
function parseValues(
  value: unknown
): Record<string, string | string[]> | undefined {
  if (!isRecord(value)) return undefined;

  const values: Record<string, string | string[]> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      values[name] = raw;
      continue;
    }
    if (Array.isArray(raw) && raw.every(item => typeof item === "string")) {
      values[name] = raw as string[];
      continue;
    }
    return undefined;
  }
  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
