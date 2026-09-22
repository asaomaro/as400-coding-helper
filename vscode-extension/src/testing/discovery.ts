import * as vscode from "vscode";
import { resolveMemberTarget, type MemberTarget } from "../sync/memberTarget";

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

export interface DiscoveredTestFile {
  readonly uri: vscode.Uri;
  readonly target: MemberTarget;
  readonly procedures: readonly DiscoveredTestProcedure[];
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
 * `test`手続きが1件も無い、またはパスが `resolveMemberTarget` の規約
 * （`src/<LIB>/<SRCFILE>/<MEMBER>.<ext>`）に合わない場合は `undefined`。
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
  const resolved = resolveMemberTarget(workspaceRelativePath);
  if (!resolved.ok) {
    return undefined;
  }
  return { uri, target: resolved.target, procedures };
}

/**
 * ワークスペース内の `src/**​/*.rpgle|*.sqlrpgle` を走査し、`DiscoveredTestFile` の
 * 一覧を返す。RPG III（`.rpg`）はサブプロシージャーが無くRPGUnit対象外
 * （`.claude/skills/rpgunit-test/SKILL.md:145`）のため走査しない。
 */
export async function discoverTestFiles(
  workspaceFolders: readonly vscode.WorkspaceFolder[]
): Promise<readonly DiscoveredTestFile[]> {
  const results: DiscoveredTestFile[] = [];
  for (const folder of workspaceFolders) {
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, "src/**/*.{rpgle,sqlrpgle}")
    );
    for (const uri of uris) {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const source = Buffer.from(bytes).toString("utf8");
      const relativePath = vscode.workspace.asRelativePath(uri, false);
      const file = buildDiscoveredTestFile(uri, relativePath, source);
      if (file) {
        results.push(file);
      }
    }
  }
  return results;
}
