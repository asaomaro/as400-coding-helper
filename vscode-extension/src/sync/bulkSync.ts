import { resolveMemberTarget } from "./memberTarget";

/**
 * ソース・ファイル ⇔ ローカルのフォルダ（`src/<LIB>/<SRCFILE>/`）を単位にした一括の送受信。
 *
 * **vscode を import しない。** 一覧の読み取り・突き合わせ・上書きの確認対象・新しいファイルの名前だけを持つ。
 * 転送そのものは transport、画面とファイルの読み書きは `bulkSyncPanel.ts`。
 *
 * ## 状態は更新日時の新旧だけ（2026-09-27 利用者の判断）
 *
 * 前回の転送の記録は持たない。比べるのは両側の更新日時（秒単位）で、同じなら「同じ」。
 * ダウンロードしただけでローカルが新しくならないよう、転送の後はローカルの更新日時を
 * IBM i の更新日時に揃える（ホスト側の仕事）。
 */

export type SyncDirection = "download" | "upload";

/** IBM i のメンバー 1 件。`changed` は UTC のエポック・ミリ秒（秒単位）。 */
export interface RemoteMember {
  readonly name: string;
  readonly sourceType: string;
  readonly text: string;
  readonly lines: number;
  readonly changed: number;
}

export interface RemoteListing {
  /** ソース物理ファイルがあるか。ソースでない物理ファイルは false。 */
  readonly exists: boolean;
  readonly members: readonly RemoteMember[];
}

/** フォルダの中のファイル 1 件（ホストが読む）。 */
export interface LocalFile {
  readonly fileName: string;
  readonly lines: number;
  /** 更新日時（エポック・ミリ秒）。 */
  readonly modified: number;
}

/** 一覧の片側。 */
export interface SyncSide {
  readonly changed: number;
  readonly lines: number;
  readonly text: string;
  readonly sourceType: string;
  /** ローカル側のファイル名。 */
  readonly fileName?: string;
}

export interface SyncRow {
  /** メンバー名。読めないファイルはファイル名。 */
  readonly name: string;
  readonly source?: SyncSide;
  readonly target?: SyncSide;
  /** 両側があるときだけ。 */
  readonly newer?: "source" | "target" | "same";
  /** 選べない理由。 */
  readonly problem?: string;
}

/**
 * メンバー一覧を 1 つの UTF-8 JSON にまとめる SQL（`RUNSQL` → `QSYS2.IFS_WRITE_UTF8` の LINE）。
 *
 * 日時は `LAST_SOURCE_UPDATE_TIMESTAMP`（無ければ `LAST_CHANGE_TIMESTAMP`）を UTC に直す
 * （`- CURRENT TIMEZONE`）。`VARCHAR_FORMAT` は `"T"` のような文字を書式に入れられない（SQLCODE -20447、実機）。
 * `exists` は `SYSTABLES` の `FILE_TYPE = 'S'`（ソース）で見る。メンバーが無いときの `members` は null。
 * 名前は `isIbmiObjectName` で検査済みのものだけを渡す。
 */
export function buildMemberListSql(library: string, sourceFile: string): string {
  return [
    "SELECT JSON_OBJECT(",
    `'exists' VALUE (SELECT COUNT(*) FROM QSYS2.SYSTABLES WHERE SYSTEM_TABLE_SCHEMA = '${library}' AND SYSTEM_TABLE_NAME = '${sourceFile}' AND FILE_TYPE = 'S'),`,
    "'members' VALUE JSON_ARRAYAGG(JSON_OBJECT(",
    "'name' VALUE RTRIM(SYSTEM_TABLE_MEMBER), 'type' VALUE RTRIM(COALESCE(SOURCE_TYPE, '')),",
    "'text' VALUE RTRIM(COALESCE(PARTITION_TEXT, '')), 'lines' VALUE NUMBER_ROWS,",
    "'changed' VALUE VARCHAR_FORMAT(COALESCE(LAST_SOURCE_UPDATE_TIMESTAMP, LAST_CHANGE_TIMESTAMP) - CURRENT TIMEZONE, 'YYYY-MM-DD HH24:MI:SS'))",
    "ORDER BY SYSTEM_TABLE_MEMBER) FORMAT JSON)",
    `FROM QSYS2.SYSPARTITIONSTAT WHERE SYSTEM_TABLE_SCHEMA = '${library}' AND SYSTEM_TABLE_NAME = '${sourceFile}'`
  ].join(" ");
}

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u;

/** `buildMemberListSql` が書いた JSON を読む。形が違えば undefined。 */
export function parseMemberListing(text: string): RemoteListing | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/u, ""));
  } catch {
    return undefined;
  }
  if (typeof json !== "object" || json === null) return undefined;
  const { exists, members } = json as { exists?: unknown; members?: unknown };
  if (typeof exists !== "number") return undefined;
  if (members !== null && members !== undefined && !Array.isArray(members)) return undefined;
  const parsed: RemoteMember[] = [];
  for (const entry of (members ?? []) as unknown[]) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const { name, type, text: description, lines, changed } = entry as Record<string, unknown>;
    if (typeof name !== "string" || typeof changed !== "string") return undefined;
    const time = TIMESTAMP.exec(changed);
    if (time === null) return undefined;
    const [, year, month, day, hour, minute, second] = time.map(Number);
    parsed.push({
      name,
      sourceType: typeof type === "string" ? type : "",
      text: typeof description === "string" ? description : "",
      lines: typeof lines === "number" ? lines : 0,
      changed: Date.UTC(year, month - 1, day, hour, minute, second)
    });
  }
  return { exists: exists > 0, members: parsed };
}

/** 行数。最後の改行の後の空行は数えない（メンバーのレコード数と揃える）。 */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  const lines = text.split(/\r\n|\r|\n/u);
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

interface LocalMember extends SyncSide {
  readonly name: string;
  readonly fileName: string;
}

interface LocalReading {
  readonly members: readonly LocalMember[];
  /** 選べないもの（メンバー名 or ファイル名 → 理由）。 */
  readonly problems: ReadonlyMap<string, string>;
}

/** フォルダの中のファイルをメンバーとして読む。`.` で始まるファイルは見ない。 */
export function readLocalMembers(files: readonly LocalFile[]): LocalReading {
  const byName = new Map<string, LocalMember[]>();
  const problems = new Map<string, string>();
  for (const file of files) {
    if (file.fileName.startsWith(".")) continue;
    // 既存の 1 メンバーの同期と同じ規則で読む（ライブラリー・ファイルの部分は形を合わせるだけ）。
    const resolution = resolveMemberTarget(`src/LIB/FILE/${file.fileName}`);
    if (!resolution.ok) {
      problems.set(file.fileName, resolution.reason === "textDescription"
        ? "テキスト記述（ファイル名の '-' より後）が 50 文字を超えています。"
        : "ファイル名がメンバー名として読めません（先頭は英字または $ # @、10 文字以内）。");
      continue;
    }
    const { member, extension, textDescription } = resolution.target;
    const list = byName.get(member) ?? [];
    list.push({
      name: member,
      fileName: file.fileName,
      changed: file.modified,
      lines: file.lines,
      text: textDescription ?? "",
      sourceType: extension.toUpperCase()
    });
    byName.set(member, list);
  }
  const members: LocalMember[] = [];
  for (const [name, list] of byName) {
    if (list.length > 1) {
      problems.set(name, `同じメンバーのファイルが複数あります（${list.map(entry => entry.fileName).join("、")}）。`);
      continue;
    }
    members.push(list[0]);
  }
  return { members, problems };
}

const seconds = (time: number): number => Math.floor(time / 1000);

/** 転送元・転送先を突き合わせて一覧の行を作る。メンバー名の順。 */
export function buildSyncRows(
  direction: SyncDirection,
  remote: readonly RemoteMember[],
  local: LocalReading
): SyncRow[] {
  const remoteSides = new Map<string, SyncSide>(
    remote.map(member => [member.name, {
      changed: member.changed,
      lines: member.lines,
      text: member.text,
      sourceType: member.sourceType
    }])
  );
  const localSides = new Map<string, SyncSide>(local.members.map(member => [member.name, member]));
  const names = new Set([...remoteSides.keys(), ...localSides.keys(), ...local.problems.keys()]);
  return [...names].sort().map(name => {
    const remoteSide = remoteSides.get(name);
    const localSide = localSides.get(name);
    const [source, target] = direction === "download" ? [remoteSide, localSide] : [localSide, remoteSide];
    const problem = local.problems.get(name);
    let newer: SyncRow["newer"];
    if (source !== undefined && target !== undefined) {
      const difference = seconds(source.changed) - seconds(target.changed);
      newer = difference === 0 ? "same" : difference > 0 ? "source" : "target";
    }
    return {
      name,
      ...(source ? { source } : {}),
      ...(target ? { target } : {}),
      ...(newer ? { newer } : {}),
      ...(problem ? { problem } : source === undefined ? { problem: "転送元にありません。" } : {})
    };
  });
}

/** 転送できる行か（転送元があり、選べない理由が無い）。 */
export function isTransferable(row: SyncRow): boolean {
  return row.source !== undefined && row.problem === undefined;
}

/** 上書きの前に確認するメンバー: 選んだもののうち、転送先の方が新しいもの。 */
export function overwriteConfirmations(rows: readonly SyncRow[], selected: readonly string[]): string[] {
  const chosen = new Set(selected);
  return rows.filter(row => chosen.has(row.name) && isTransferable(row) && row.newer === "target").map(row => row.name);
}

/** ファイル名に使えない文字（Windows を含む）と制御文字。 */
const UNSAFE_FILE_NAME = /[\\/:*?"<>|\u0000-\u001f\u007f]/u;

/**
 * ダウンロードで新しく作るファイルの名前: `メンバー名-テキスト記述.<ソース・タイプ小文字>`。
 *
 * 記述がファイル名に使えない文字を含む・空・末尾が `.` や空白のときは記述を付けない。
 * **置き換えない**——置き換えた名前でアップロードすると IBM i の記述が変わってしまうため。
 * ソース・タイプが空なら `.txt`。
 */
export function downloadFileName(member: Pick<RemoteMember, "name" | "sourceType" | "text">): string {
  const extension = (member.sourceType.trim() || "TXT").toLowerCase();
  const text = member.text.trim();
  const usable = text.length > 0 && text.length <= 50 && !UNSAFE_FILE_NAME.test(text) && !/[. ]$/u.test(text);
  return `${member.name}${usable ? `-${text}` : ""}.${extension}`;
}
