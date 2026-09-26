import * as vscode from "vscode";
import { resolveMemberTarget, type MemberTarget } from "../sync/memberTarget";
import { resolveStreamTestTarget, type StreamTestTarget } from "./streamTarget";

/**
 * ワークスペース内のRPGUnitテストソースを検出する。
 * `tools/run-rpgunit.mjs` の `parseOracleMarkers` の手続き列挙部分（固定長P仕様・
 * 自由形式・継続名前行）を参考にする（オラクル印の検査は行わない）。
 */

export interface DiscoveredTestProcedure {
  /** 大文字。RPGUnitのテストケース名。 */
  readonly name: string;
  /** 0-based。手続き定義行（継続名前行がある場合は最後の継続先の行）。 */
  readonly line: number;
}

/** メンバー方式（`src/<LIB>/<SRCFILE>/<MEMBER>.rpgle` をソースメンバーへ送る）。 */
export interface DiscoveredMemberTestFile {
  readonly uri: vscode.Uri;
  readonly target: MemberTarget;
  readonly procedures: readonly DiscoveredTestProcedure[];
}

/** IFS 方式（`*.test.rpgle` をデプロイした IFS のソースから作る）。 */
export interface DiscoveredStreamTestFile {
  readonly uri: vscode.Uri;
  readonly stream: StreamTestTarget;
  readonly procedures: readonly DiscoveredTestProcedure[];
}

/** どちらの方式かは `"stream" in file` で見分ける（メンバー方式の値の形はいままでと同じ）。 */
export type DiscoveredTestFile = DiscoveredMemberTestFile | DiscoveredStreamTestFile;

export function isDiscoveredStreamTest(file: DiscoveredTestFile): file is DiscoveredStreamTestFile {
  return "stream" in file;
}

/**
 * ソース本文から `test` 始まりの `EXPORT` 手続きを列挙する（純粋関数）。
 * `.claude/skills/rpgunit-test/SKILL.md:147-192` のRPGUnitテストの形
 * （`NOMAIN`サービスプログラム、`test`始まりのexport手続き）に基づく。
 */
export function findTestProcedures(source: string): readonly DiscoveredTestProcedure[] {
  const procedures: DiscoveredTestProcedure[] = [];
  const lines = source.split(/\r?\n/);
  let pendingName = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // 注記行（固定長は7桁目が`*`、自由形式は`//`）は飛ばす。
    if (line[6] === "*" || line.trimStart().startsWith("//")) {
      continue;
    }

    // 固定長のP仕様（6桁目`P`）。名前7-21桁 / 24桁目`B` / キーワード44-80桁。
    if (/^p$/i.test(line[5] ?? "")) {
      const body = line.slice(6, 80).trim();
      // 継続名前行。名前が15桁に収まらないと`...`で次行へ続く。
      if (body.endsWith("...")) {
        pendingName += body.slice(0, -3).trim();
        continue;
      }
      const name = pendingName || line.slice(6, 21).trim();
      pendingName = "";
      if (/^b$/i.test(line[23] ?? "") && /\bEXPORT\b/i.test(line.slice(43, 80)) && /^test/i.test(name)) {
        procedures.push({ name: name.toUpperCase(), line: i });
      }
      continue;
    }

    // 自由形式。
    const m = /^\s*dcl-proc\s+([A-Za-z0-9_#$@]+)\s+export\s*;/i.exec(line);
    if (m && /^test/i.test(m[1])) {
      procedures.push({ name: m[1].toUpperCase(), line: i });
    }
  }

  return procedures;
}

/**
 * 1ファイル分の `DiscoveredTestFile` を組み立てる（純粋関数）。
 * **`*.test.rpgle` / `*.test.sqlrpgle` は置き場所を問わず IFS 方式**、それ以外で `resolveMemberTarget` の規約
 * （`src/<LIB>/<SRCFILE>/<MEMBER>.<ext>`）に合えばメンバー方式。IFS 方式を先に見るのは、`src/L/F/calc-add.test.rpgle` が
 * メンバー方式の規則では「メンバー CALC・テキスト add.test」に当たってしまい、IFS 方式のつもりのファイルが既存メンバーを
 * 上書きしうるため（`.aidev/works/20260926-rpgunit-ifs-deploy/decisions.md` D14）。
 * `test`手続きが1件も無い、またはどちらでもなければ `undefined`。
 */
export function buildDiscoveredTestFile(
  uri: vscode.Uri,
  workspaceRelativePath: string,
  source: string
): DiscoveredTestFile | undefined {
  const procedures = findTestProcedures(source);
  if (procedures.length === 0) {
    return undefined;
  }
  const stream = resolveStreamTestTarget(workspaceRelativePath);
  if (stream) {
    return { uri, stream, procedures };
  }
  const resolved = resolveMemberTarget(workspaceRelativePath);
  return resolved.ok ? { uri, target: resolved.target, procedures } : undefined;
}

/** 大文字小文字を問わない IFS 方式の候補。最終の判定は `resolveStreamTestTarget`（道具と同じ関数）で行う。 */
const STREAM_TEST_GLOB = "**/*.[tT][eE][sS][tT].{[rR][pP][gG][lL][eE],[sS][qQ][lL][rR][pP][gG][lL][eE]}";

/**
 * ワークスペース内のテストを探す。メンバー方式は `src/**​/*.rpgle|*.sqlrpgle`、IFS 方式は `*.test.rpgle` 等
 * （IBM i Testing と同じ置き方。`node_modules` は除く）。RPG III（`.rpg`）はサブプロシージャーが無く
 * RPGUnit対象外（`.claude/skills/rpgunit-test/SKILL.md:145`）のため走査しない。
 */
export async function discoverTestFiles(
  workspaceFolders: readonly vscode.WorkspaceFolder[]
): Promise<readonly DiscoveredTestFile[]> {
  const results: DiscoveredTestFile[] = [];
  const seen = new Set<string>();
  for (const folder of workspaceFolders) {
    const uris = [
      ...await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "src/**/*.{rpgle,sqlrpgle}")),
      ...await vscode.workspace.findFiles(new vscode.RelativePattern(folder, STREAM_TEST_GLOB), "**/node_modules/**")
    ];
    for (const uri of uris) {
      // `src/L/F/x.test.rpgle` は両方の glob に当たる
      if (seen.has(uri.toString())) {
        continue;
      }
      seen.add(uri.toString());
      const bytes = await vscode.workspace.fs.readFile(uri);
      const source = Buffer.from(bytes).toString("utf8");
      // false: 複数のフォルダーを持つワークスペースでもフォルダー名を付けない（IFS 方式ではデプロイ先の最上位からの相対パス）
      const relativePath = vscode.workspace.asRelativePath(uri, false);
      const file = buildDiscoveredTestFile(uri, relativePath, source);
      if (file) {
        results.push(file);
      }
    }
  }
  return results;
}
