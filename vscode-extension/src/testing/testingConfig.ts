import * as path from "node:path";
import * as vscode from "vscode";

/**
 * IBM i Testing 拡張と同じ `testing.json` から、RPGUnit のバインド指定（`rpgunit.rucrtrpg.bndSrvPgm` /
 * `bndDir`）を読む。書式は `IBM/vscode-ibmi-testing` の `schemas/testing.json`、探し方は同 `api/config.ts`。
 * 合成だけは IBM i Testing（`lodash.merge` の要素ごとの合成）と変え、キー単位で置き換える
 * （`.aidev/works/20260926-rpgunit-bind-srvpgm/decisions.md` D5）。
 */

export interface BindingSpec {
  /** 大文字化済み。`NAME` または `LIB/NAME`。修飾の無い名前は `*LIBL` で解決される。 */
  readonly servicePrograms: readonly string[];
  readonly bindingDirectories: readonly string[];
}

export interface TestingConfigSource {
  /** メッセージに出すパス（ワークスペース相対）。 */
  readonly path: string;
  readonly text?: string;
  /** 存在するのに読めなかった理由（`text` とどちらか一方）。 */
  readonly readError?: string;
}

export type ResolveBindingResult =
  | { readonly ok: true; readonly binding: BindingSpec }
  | { readonly ok: false; readonly path: string; readonly reason: string };

const NAME = "[A-Z$#@][A-Z0-9$#@_.]{0,9}";

/** 上限と特殊値は実機の `RPGUNIT/QCMD(RUCRTRPG)` のコマンド定義による（2026-09-26 に直読）。 */
const KEYS = {
  bndSrvPgm: { max: 50, specialLibraries: ["*LIBL"] },
  bndDir: { max: 10, specialLibraries: ["*LIBL", "*CURLIB", "*USRLIBL"] }
} as const;
type BindingKey = keyof typeof KEYS;

const EMPTY: BindingSpec = { servicePrograms: [], bindingDirectories: [] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Parsed =
  | { readonly ok: true; readonly values: Partial<Record<BindingKey, string[]>> }
  | { readonly ok: false; readonly reason: string };

function parseSource(source: TestingConfigSource): Parsed {
  if (source.readError !== undefined) {
    return { ok: false, reason: `読めません: ${source.readError}` };
  }
  let json: unknown;
  try {
    json = JSON.parse(source.text ?? "");
  } catch (error) {
    return { ok: false, reason: `JSON として読めません: ${(error as Error).message}` };
  }
  if (!isPlainObject(json)) {
    return { ok: false, reason: "最上位はオブジェクトにしてください" };
  }
  if (!("rpgunit" in json)) {
    return { ok: true, values: {} };
  }
  const rpgunit = json.rpgunit;
  if (!isPlainObject(rpgunit)) {
    return { ok: false, reason: "rpgunit はオブジェクトにしてください" };
  }
  if (!("rucrtrpg" in rpgunit)) {
    return { ok: true, values: {} };
  }
  const rucrtrpg = rpgunit.rucrtrpg;
  if (!isPlainObject(rucrtrpg)) {
    return { ok: false, reason: "rpgunit.rucrtrpg はオブジェクトにしてください" };
  }

  const values: Partial<Record<BindingKey, string[]>> = {};
  for (const key of Object.keys(KEYS) as BindingKey[]) {
    if (!(key in rucrtrpg)) {
      continue;
    }
    const label = `rpgunit.rucrtrpg.${key}`;
    const raw = rucrtrpg[key];
    if (!Array.isArray(raw) || !raw.every(item => typeof item === "string")) {
      return { ok: false, reason: `${label} は文字列の配列にしてください` };
    }
    const { max, specialLibraries } = KEYS[key];
    if (raw.length > max) {
      return { ok: false, reason: `${label} は ${max} 件までです（${raw.length} 件）` };
    }
    const pattern = new RegExp(`^(?:(${NAME}|\\*[A-Z]+)/)?(${NAME})$`);
    const normalized: string[] = [];
    for (const item of raw as string[]) {
      const name = item.trim().toUpperCase();
      const match = pattern.exec(name);
      const library = match?.[1];
      if (!match || (library?.startsWith("*") && !(specialLibraries as readonly string[]).includes(library))) {
        return {
          ok: false,
          reason: `${label} の "${item}" は NAME か LIB/NAME の形で書いてください` +
            `（LIB に使える特殊値: ${specialLibraries.join(" ")}）`
        };
      }
      normalized.push(name);
    }
    values[key] = normalized;
  }
  return { ok: true, values };
}

/**
 * 最寄りの `testing.json`（`nearest`）と `.vscode/testing.json`（`global`）からバインド指定を決める。
 * 合成の前に両方を検査し（最寄り→`.vscode` の順。上書きされる側の誤りも返す）、キーごとに最寄りを優先する。
 */
export function resolveBinding(
  nearest: TestingConfigSource | undefined,
  global: TestingConfigSource | undefined
): ResolveBindingResult {
  const parsed: Partial<Record<BindingKey, string[]>>[] = [];
  for (const source of [nearest, global]) {
    if (!source) {
      parsed.push({});
      continue;
    }
    const result = parseSource(source);
    if (!result.ok) {
      return { ok: false, path: source.path, reason: result.reason };
    }
    parsed.push(result.values);
  }
  const [near, far] = parsed;
  const pick = (key: BindingKey) => near[key] ?? far[key] ?? [];
  if (!nearest && !global) {
    return { ok: true, binding: EMPTY };
  }
  return { ok: true, binding: { servicePrograms: pick("bndSrvPgm"), bindingDirectories: pick("bndDir") } };
}

const CONFIG_NAME = "testing.json";

async function readSource(uri: vscode.Uri): Promise<TestingConfigSource | undefined> {
  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(uri);
  } catch {
    return undefined;
  }
  const displayPath = vscode.workspace.asRelativePath(uri, false);
  if ((stat.type & vscode.FileType.Directory) !== 0) {
    return { path: displayPath, readError: "ファイルではなくディレクトリです" };
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return { path: displayPath, text: Buffer.from(bytes).toString("utf8") };
  } catch (error) {
    return { path: displayPath, readError: String((error as Error)?.message ?? error) };
  }
}

/**
 * テストファイルのディレクトリから親へ、ワークスペースフォルダーのルートまで遡って最寄りの `testing.json` を探し、
 * `<ワークスペース>/.vscode/testing.json` も読む。ワークスペースフォルダーに属さないファイルでは何も読まない。
 */
export async function readTestingConfigs(
  fileUri: vscode.Uri
): Promise<{ nearest?: TestingConfigSource; global?: TestingConfigSource }> {
  const folder = vscode.workspace.getWorkspaceFolder(fileUri);
  if (!folder) {
    return {};
  }
  const root = folder.uri.path.replace(/\/+$/, "");
  const inside = (dir: string) => dir === root || dir.startsWith(`${root}/`);

  let nearest: TestingConfigSource | undefined;
  for (let dir = path.posix.dirname(fileUri.path); inside(dir); dir = path.posix.dirname(dir)) {
    nearest = await readSource(fileUri.with({ path: path.posix.join(dir, CONFIG_NAME) }));
    if (nearest || dir === root) {
      break;
    }
  }
  const global = await readSource(fileUri.with({ path: path.posix.join(root, ".vscode", CONFIG_NAME) }));
  return { ...(nearest ? { nearest } : {}), ...(global ? { global } : {}) };
}
