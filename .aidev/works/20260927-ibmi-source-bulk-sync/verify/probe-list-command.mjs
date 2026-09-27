/**
 * 製品が SSH で送る一覧のコマンド（`buildListMembersCommand`）を、**そのまま**実機で流して読み取れるかを見る。
 * 検証環境には SSH が無いので、remote shell の層（`system "..."` と `\` の逃がし）だけ外して、
 * 中の CL を host server の QCMDEXC で実行する。結果は製品の `parseMemberListing` で読む。
 *
 *   cd /workspaces/as400-coding-helper/vscode-extension && npm run compile
 *   cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify <このファイル>
 *
 * 書いた IFS ファイルは読んだ後に消す（自分で作ったものだけ）。メンバー・スプールには触れない。
 */
import { createRequire } from "node:module";
import { connectHostServer } from "../../../../vscode-extension/dev/rpgunit-e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { buildListMembersCommand } = require("../../../../vscode-extension/out/sync/ibmiSourceTransport.js");
const { parseMemberListing } = require("../../../../vscode-extension/out/sync/bulkSync.js");

const LIB = process.env.AS400_LIB.toUpperCase();
const IFS = process.env.AS400_IFS_DIR;
const { hs, creds } = await connectHostServer();
const db = await hs.DbConnection.connect({ ...creds, resolvePort: true, timeoutMs: 300000 });
const lastLog = async () => Number(Object.values((await hs.query(db, "SELECT COALESCE(MAX(ORDINAL_POSITION),0) FROM TABLE(QSYS2.JOBLOG_INFO('*'))")).rows[0])[0]);

for (const file of ["QDDSJ", "NOSUCHF", "KWVALF"]) {
  const path = `${IFS}/bulk-sync-${file}.json`;
  const command = buildListMembersCommand(LIB, file, path);
  const inner = /^system "(.*)"$/su.exec(command)[1].replace(/\\(.)/gu, "$1");
  const since = await lastLog();
  let ok = "OK";
  try { await hs.executeStatement(db, "CALL QSYS2.QCMDEXC(?)", { parameters: [inner] }); }
  catch {
    const log = (await hs.query(db, `SELECT MESSAGE_ID, MESSAGE_TEXT FROM TABLE(QSYS2.JOBLOG_INFO('*')) WHERE ORDINAL_POSITION > ${since}`)).rows;
    ok = `NG ${log.map(r => `${r.MESSAGE_ID}: ${String(r.MESSAGE_TEXT).trim()}`).join(" / ")}`;
  }
  console.log(`== ${file}: 送る CL ${inner.length} 文字 → ${ok}`);
  const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
  try {
    const listing = parseMemberListing(Buffer.from(await ifs.readFile(path)).toString("utf8"));
    console.log(`   parseMemberListing: exists=${listing?.exists} 件数=${listing?.members.length}`,
      listing?.members.length ? `先頭=${JSON.stringify(listing.members[0])} 名前順=${listing.members.every((m, i, a) => i === 0 || a[i - 1].name <= m.name)}` : "");
  } catch (e) { console.log("   読めない:", String(e.message ?? e).slice(0, 120)); }
  finally { ifs.close(); }
  await hs.executeStatement(db, "CALL QSYS2.QCMDEXC(?)", { parameters: [`RMVLNK OBJLNK('${path}')`] }).catch(() => undefined);
}
process.exit(0);
