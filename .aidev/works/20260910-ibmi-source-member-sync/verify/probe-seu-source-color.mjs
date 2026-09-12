/**
 * SEU 色属性の生バイトと CPYTOSTMF の UTF-8 変換を確認する使い捨てプローブ。
 *
 * `AS400_LIB` と `AS400_IFS_DIR` を使う。接続情報・パスワードは一切表示しない。
 * 作成済みでない名前を使い、作成に成功した物だけ finally で消すため、既存資源は削除しない。
 *
 * 実行は検証用の ts5250 workspace から行う:
 * `for mode in map red dbcs; do SEU_PROBE_MODE=$mode node --env-file=.env --env-file=.env.verify <このファイル>; done`
 * - map: 7基底色が source bytes `C120C222C328C430C532C638C73AC8` と UTF-8 wire に残る。
 * - red: U+0088 が source byte x'28' に残る（VS Code の `Ŕ` は unit test で U+0088 に変換する）。
 * - dbcs: 赤属性と `顧客` が `DBFCCSID(*FILE)` の往復で同じ text に戻る。
 * どの mode でも IFS temporary files と temporary source PF の cleanup に失敗すれば失敗にする。
 */
import { join } from "node:path";

const TS5250 = "/workspaces/ts5250";
const {
  CommandConnection,
  DbConnection,
  IfsConnection,
  query
} = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const { readFileSync } = await import("node:fs");

const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const system = profiles.systems.find(
  (entry) => entry.id === process.env.AS400_SYSTEM || entry.name === process.env.AS400_SYSTEM
);
const library = process.env.AS400_LIB;
const ifsDir = process.env.AS400_IFS_DIR;
const sourceCcsid = 5035; // Japanese EBCDIC used by the target source-PF probe.
const mode = process.env.SEU_PROBE_MODE ?? "red";

if (!system || !library || !ifsDir || !/^[A-Za-z0-9_$#@]{1,10}$/.test(library)) {
  throw new Error("required IBM i probe configuration is unavailable");
}
if (ifsDir.includes("'")) {
  throw new Error("IFS directory contains an unsupported quote");
}
if (mode !== "red" && mode !== "map" && mode !== "dbcs") {
  throw new Error("SEU_PROBE_MODE must be red, map, or dbcs");
}

const credentials = {
  host: system.host,
  user: system.signon.user,
  password: SecretCrypto.fromEnv()?.decrypt(system.signon.passwordEnc)
};
if (!credentials.password) {
  throw new Error("IBM i probe credential is unavailable");
}

// IBM i object names are limited to 10 characters. The timestamp/random suffix avoids
// touching a pre-existing source file even if a previous run was interrupted.
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  .replace(/[^a-z0-9]/gi, "")
  .slice(-8)
  .toUpperCase();
const file = `Z${suffix}`;
const memberPath = `/QSYS.LIB/${library.toUpperCase()}.LIB/${file}.FILE/${file}.MBR`;
const rawPath = `${ifsDir.replace(/\/$/, "")}/seu-color-${suffix}.raw`;
const utf8Path = `${ifsDir.replace(/\/$/, "")}/seu-color-${suffix}.utf8`;

let command;
let database;
let ifs;
let sourceCreated = false;
let rawCreated = false;
let utf8Created = false;
let primaryFailure;

function requireSuccess(result, operation) {
  if (!result.success) {
    const ids = result.messages.map((message) => message.id).join(",");
    // Command IDs alone do not tell whether the CL syntax or a data invariant failed.
    // The host's diagnostic text has no credentials; limit it so this probe never dumps data.
    const diagnostic = result.messages
      .map((message) => String(message.text ?? "").replace(/\s+/g, " ").slice(0, 160))
      .filter(Boolean)
      .join(" / ");
    throw new Error(`${operation} failed (${ids})${diagnostic ? `: ${diagnostic}` : ""}`);
  }
}

try {
  command = await CommandConnection.connect(credentials);
  database = await DbConnection.connect(credentials);
  ifs = await IfsConnection.connect(credentials);

  requireSuccess(
    await command.run(`CRTSRCPF FILE(${library.toUpperCase()}/${file}) RCDLEN(112) CCSID(${sourceCcsid}) TEXT('temporary SEU colour probe')`),
    "CRTSRCPF"
  );
  sourceCreated = true;

  // `red`: Japanese EBCDIC CCSID 5035 maps U+0088 to x'28'.
  // `map`: raw CCSID 37 controls exercise the seven base 5250 colour bytes together.
  // `dbcs`: one red attribute and DBCS text must round-trip together through *FILE.
  const input = mode === "red"
    ? { bytes: new TextEncoder().encode("ABC\u0088DEF\n"), ccsid: 1208, sourceCcsid: 1208,
        expected: "C1C2C328C4C5C6" }
    : mode === "map"
      ? { bytes: Uint8Array.of(0xc1, 0x20, 0xc2, 0x22, 0xc3, 0x28, 0xc4, 0x30, 0xc5, 0x32, 0xc6, 0x38, 0xc7, 0x3a, 0xc8, 0x0a),
          ccsid: 37, sourceCcsid: 37, expected: "C120C222C328C430C532C638C73AC8",
          expectedUtf8Hex: "41C28042C28243C28844C290451646C29847C29A48C28E0D0A" }
      : { bytes: new TextEncoder().encode("A\u0088顧客B\n"), ccsid: 1208, sourceCcsid: 1208,
          roundTripText: "A\u0088顧客B\n" };
  await ifs.writeFile(rawPath, input.bytes, { dataCcsid: input.ccsid });
  rawCreated = true;
  // CPYFRMSTMF needs an exclusive handle. SFTP likewise must finish and close before
  // invoking it; the IBM i file-server session can otherwise keep the stream file busy.
  ifs.close();
  ifs = undefined;
  requireSuccess(
    await command.run(
      `CPYFRMSTMF FROMSTMF('${rawPath}') TOMBR('${memberPath}') MBROPT(*REPLACE) STMFCCSID(${input.sourceCcsid})`
    ),
    "CPYFRMSTMF"
  );
  ifs = await IfsConnection.connect(credentials);
  const source = await query(database, `SELECT HEX(SRCDTA) AS RAW FROM ${library.toUpperCase()}.${file}`);
  const raw = String(source.rows[0]?.RAW ?? "");
  if (input.expected && !raw.startsWith(input.expected)) {
    throw new Error("candidate source colour bytes were not retained");
  }

  requireSuccess(
    await command.run(
      `CPYTOSTMF FROMMBR('${memberPath}') TOSTMF('${utf8Path}') STMFOPT(*REPLACE) STMFCCSID(1208) DBFCCSID(*FILE)`
    ),
    "CPYTOSTMF"
  );
  utf8Created = true;
  const utf8 = await ifs.readFile(utf8Path);
  const utf8Hex = Buffer.from(utf8).toString("hex").toUpperCase();
  if (input.expectedUtf8Hex && utf8Hex !== input.expectedUtf8Hex) {
    throw new Error("candidate UTF-8 wire colour controls were not retained");
  }
  const output = new TextDecoder().decode(utf8).replace(/\r\n/g, "\n");
  if (input.roundTripText && output !== input.roundTripText) {
    throw new Error("DBCS and red colour attribute did not round-trip through *FILE");
  }

  // Output only observed byte facts; no source text, host name, path, or credentials.
  console.log(`mode=${mode}`);
  if (input.expected) console.log(`source-prefix-hex=${raw.slice(0, input.expected.length)}`);
  console.log(`utf8-hex=${utf8Hex}`);
} catch (error) {
  primaryFailure = error;
  throw error;
} finally {
  const cleanupFailures = [];
  // A failed CPYFRMSTMF occurs after the file-server session was deliberately closed
  // to release its lock. Reconnect solely for cleanup so an unsuccessful probe does
  // not leave its generated stream files behind.
  if (!ifs && (rawCreated || utf8Created)) {
    try {
      ifs = await IfsConnection.connect(credentials);
    } catch {
      cleanupFailures.push("IFS cleanup connection");
    }
  }
  if (ifs && utf8Created) {
    try { await ifs.deleteFile(utf8Path); } catch { cleanupFailures.push("IFS UTF-8 temporary file"); }
  }
  if (ifs && rawCreated) {
    try { await ifs.deleteFile(rawPath); } catch { cleanupFailures.push("IFS raw temporary file"); }
  }
  if (command && sourceCreated) {
    try {
      const result = await command.run(`DLTF FILE(${library.toUpperCase()}/${file})`);
      if (!result.success) cleanupFailures.push("temporary source physical file");
    } catch {
      cleanupFailures.push("temporary source physical file");
    }
  }
  ifs?.close();
  database?.close();
  command?.close();
  if (cleanupFailures.length > 0 && !primaryFailure) {
    throw new Error(`cleanup failed for ${cleanupFailures.join(", ")}`);
  }
}
