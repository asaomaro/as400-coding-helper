/**
 * ワークスペースのソースから、オブジェクト名の候補を集める。
 *
 * CDML には「この欄はファイル/プログラム/データ域を指す」という情報がある
 * (`IsFile` / `IsPgm` / `IsDtaAra`)。実機に問い合わせればオブジェクト一覧を
 * 出せるが、**本 PJ は接続不要を方針にしている**ので実機は使わない。
 *
 * 代わりに開いているワークスペースのソースを見る。`MYPGM.rpgle` があれば
 * PGM 欄の候補に `MYPGM` を出す、という程度のことしかしないが、実際に書く
 * オブジェクト名はたいてい同じプロジェクトの中にある。
 *
 * 判定の本体はここに置き、vscode API に触るのは collectWorkspaceObjects だけに
 * する（ユニットテストは vscode をスタブに差し替えるため）。
 */
import * as vscode from "vscode";

/** 欄が指すオブジェクトの種類。 */
export type ObjectKind = "file" | "program" | "dataArea";

/**
 * 拡張子から、その中身が表すオブジェクトの種類を決める。
 *
 * 対象の拡張子は `fileScope.ts` の TARGET_EXTENSIONS と同じ集合だが、ここでは
 * 「どの種類か」まで決める必要があるため対応表を持つ。増やすときは両方見ること。
 */
export function objectKindOfExtension(extension: string): ObjectKind | undefined {
  switch (extension.toLowerCase()) {
    // DDS で記述するファイル
    case "pf":
    case "lf":
    case "dspf":
    case "prtf":
    case "mnudds":
    case "dds":
      return "file";
    // プログラム・ソース
    case "rpg":
    case "rpgle":
    case "sqlrpg":
    case "sqlrpgle":
    case "clp":
    case "clle":
      return "program";
    default:
      return undefined;
  }
}

/**
 * ファイル名からオブジェクト名を作る。
 *
 * 実機のオブジェクト名は 10 文字・英大文字なので、拡張子を落として大文字にする。
 * 10 文字を超えるものはオブジェクト名になり得ないので候補にしない
 * （切り詰めると存在しない名前を勧めることになる）。
 */
export function objectNameOfFile(fileName: string): string | undefined {
  const base = fileName.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return undefined;
  }
  const name = base.slice(0, dot).toUpperCase();
  if (name.length === 0 || name.length > 10 || !/^[A-Z$#@][A-Z0-9$#@_.]*$/u.test(name)) {
    return undefined;
  }
  return name;
}

/** 候補の集合。種類ごとに名前を並べる。 */
export type ObjectCandidates = Partial<Record<ObjectKind, string[]>>;

/** ファイル名の一覧から候補を組み立てる（vscode に依存しない部分）。 */
export function buildObjectCandidates(fileNames: readonly string[]): ObjectCandidates {
  const byKind = new Map<ObjectKind, Set<string>>();

  for (const fileName of fileNames) {
    const dot = fileName.lastIndexOf(".");
    if (dot < 0) {
      continue;
    }
    const kind = objectKindOfExtension(fileName.slice(dot + 1));
    const name = objectNameOfFile(fileName);
    if (!kind || !name) {
      continue;
    }
    let names = byKind.get(kind);
    if (!names) {
      names = new Set<string>();
      byKind.set(kind, names);
    }
    names.add(name);
  }

  const result: ObjectCandidates = {};
  for (const [kind, names] of byKind) {
    result[kind] = [...names].sort();
  }
  return result;
}

/**
 * ワークスペースを走査して候補を集める。
 *
 * 件数の上限を置くのは、巨大なワークスペースでプロンプターを開くたびに全走査を
 * するのを避けるため。打ち切ったことは呼び出し側からは分からないので、
 * 上限は候補として十分な数にしてある。
 */
export async function collectWorkspaceObjects(
  maxFiles = 2000
): Promise<ObjectCandidates> {
  if (!vscode.workspace.workspaceFolders?.length) {
    return {};
  }
  const pattern =
    "**/*.{pf,lf,dspf,prtf,mnudds,dds,rpg,rpgle,sqlrpg,sqlrpgle,clp,clle}";
  const uris = await vscode.workspace.findFiles(
    pattern,
    "**/node_modules/**",
    maxFiles
  );
  return buildObjectCandidates(uris.map(uri => uri.path));
}
