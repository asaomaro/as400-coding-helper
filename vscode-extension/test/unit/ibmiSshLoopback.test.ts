import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Server, utils, type Connection } from "ssh2";
import { createIbmiSourceTransport, IbmiSourceSyncError, type IbmiSourceSyncSettings } from "../../src/sync/ibmiSourceTransport";

/**
 * **本物の SSH**（ssh2 のサーバー機能を 127.0.0.1 に立てる）で transport を通す。
 *
 * 偽の ssh2 クライアント（`memberSync.test.ts` の FakeClient）では、exec の `close` をテストが自分で
 * 呼んでいたので見えなかった欠陥がある: **ssh2 は標準出力を読み終えるまで `close` を出さない**
 * （`lib/utils.js` の `onCHANNEL_CLOSE` は `end` を待ち、`end` は Readable が読まれて初めて出る）。
 * 標準エラーしか読んでいなかったため、IBM i でコマンドが終わっても永久に待っていた
 * （2026-09-27 利用者の画面で「メンバーの一覧を取得しています…」のまま止まった）。
 *
 * IBM i の CL は、サーバー側で `system "..."` を読んで IFS（メモリ上）とメンバーを真似る。
 * 検証するのは SSH・SFTP・コマンドの往復で、IBM i の CL そのものは実機の検証（verify/）が見る。
 */

interface FakeIbmi {
  readonly ifs: Map<string, Buffer>;
  readonly members: Map<string, string>;
  readonly commands: string[];
  /** 標準出力に出す文（`system` はコマンドのメッセージを出す）。 */
  stdout: string;
  /** 次の exec を失敗させる（終了コード 1 と標準エラー）。 */
  failWith?: string;
}

async function startServer(ibmi: FakeIbmi): Promise<{ settings: IbmiSourceSyncSettings; close: () => Promise<void> }> {
  const hostKey = utils.generateKeyPairSync("ed25519").private;
  const parsed = utils.parseKey(hostKey);
  if (parsed instanceof Error) throw parsed;
  const publicKey = (Array.isArray(parsed) ? parsed[0] : parsed).getPublicSSH();
  const { OPEN_MODE, STATUS_CODE } = utils.sftp;

  // 後片付けで切るために持つ。止まったテストの接続が残ると mocha ごと終わらなくなる。
  const connections = new Set<Connection>();
  const server = new Server({ hostKeys: [hostKey] }, (client: Connection) => {
    connections.add(client);
    client.on("close", () => connections.delete(client));
    client.on("error", () => undefined);
    client.on("authentication", context => {
      if (context.method === "password" && context.username === "TESTUSER" && context.password === "secret") context.accept();
      else context.reject(["password"]);
    });
    client.on("ready", () => {
      client.on("session", acceptSession => {
        const session = acceptSession();
        session.on("exec", (accept, _reject, info) => {
          const stream = accept();
          const command = /^system "(.*)"$/su.exec(info.command)?.[1].replace(/\\(.)/gu, "$1") ?? info.command;
          ibmi.commands.push(command);
          if (ibmi.failWith !== undefined) {
            stream.stderr.write(ibmi.failWith);
            ibmi.failWith = undefined;
            stream.exit(1);
            stream.end();
            return;
          }
          runCl(ibmi, command);
          stream.write(ibmi.stdout);
          stream.exit(0);
          stream.end();
        });
        session.on("sftp", acceptSftp => {
          const sftp = acceptSftp();
          // OpenSSH の sftp-server と同じく、クライアントが送信を終えたら閉じ返す。
          sftp.on("end", () => sftp.end());
          const handles = new Map<number, { path: string; chunks: Buffer[]; writing: boolean }>();
          let next = 0;
          sftp.on("OPEN", (reqid, path, flags) => {
            const writing = (flags & OPEN_MODE.WRITE) !== 0;
            if (!writing && !ibmi.ifs.has(path)) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            const id = next++;
            handles.set(id, { path, chunks: [], writing });
            const handle = Buffer.alloc(4);
            handle.writeUInt32BE(id);
            sftp.handle(reqid, handle);
          });
          const entry = (handle: Buffer) => handles.get(handle.readUInt32BE(0));
          sftp.on("FSTAT", (reqid, handle) => {
            const file = entry(handle);
            sftp.attrs(reqid, { mode: 0o100644, size: ibmi.ifs.get(file?.path ?? "")?.length ?? 0, uid: 0, gid: 0, atime: 0, mtime: 0 });
          });
          sftp.on("READ", (reqid, handle, offset, length) => {
            const content = ibmi.ifs.get(entry(handle)?.path ?? "") ?? Buffer.alloc(0);
            if (offset >= content.length) return sftp.status(reqid, STATUS_CODE.EOF);
            sftp.data(reqid, content.subarray(offset, offset + length));
          });
          sftp.on("WRITE", (reqid, handle, _offset, data) => {
            entry(handle)?.chunks.push(Buffer.from(data));
            sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on("CLOSE", (reqid, handle) => {
            const file = entry(handle);
            if (file?.writing) ibmi.ifs.set(file.path, Buffer.concat(file.chunks));
            sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on("REMOVE", (reqid, path) => {
            ibmi.ifs.delete(path);
            sftp.status(reqid, STATUS_CODE.OK);
          });
        });
      });
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    settings: {
      host: "127.0.0.1",
      port,
      user: "TESTUSER",
      authMethod: "password",
      ifsTempDirectory: "/tmp/sync",
      hostKeySha256: createHash("sha256").update(publicKey).digest("hex")
    },
    close: () => new Promise(resolve => {
      connections.forEach(connection => connection.end());
      server.close(() => resolve());
    })
  };
}

/** IBM i の CL を、IFS とメンバーの出し入れだけ真似る。 */
function runCl(ibmi: FakeIbmi, command: string): void {
  const runsql = /PATH_NAME => ''([^']+)''/u.exec(command);
  if (command.startsWith("RUNSQL") && runsql !== null) {
    const members = [...ibmi.members.keys()].map(name => ({ name, type: "RPGLE", text: "", lines: 1, changed: "2026-09-27 01:02:03" }));
    ibmi.ifs.set(runsql[1], Buffer.from(JSON.stringify({ exists: 1, members: members.length > 0 ? members : null }), "utf8"));
    return;
  }
  const toStream = /^CPYTOSTMF FROMMBR\('\/QSYS\.LIB\/[^/]+\/[^/]+\/([^.]+)\.MBR'\) TOSTMF\('([^']+)'\)/u.exec(command);
  if (toStream !== null) {
    ibmi.ifs.set(toStream[2], Buffer.from(ibmi.members.get(toStream[1]) ?? "", "utf8"));
    return;
  }
  const fromStream = /^CPYFRMSTMF FROMSTMF\('([^']+)'\) TOMBR\('\/QSYS\.LIB\/[^/]+\/[^/]+\/([^.]+)\.MBR'\)/u.exec(command);
  if (fromStream !== null) {
    ibmi.members.set(fromStream[2], ibmi.ifs.get(fromStream[1])?.toString("utf8") ?? "");
  }
}

/** 止まったら落とす（mocha の既定 2 秒より短く、理由が分かるように）。 */
function within<T>(promise: Promise<T>, ms = 1500): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${ms}ms 以内に終わらない（exec の close を待ったまま止まっている）`)), ms))
  ]);
}

suite("IBM i 同期: 本物の SSH で transport を通す", function () {
  // 鍵の生成と SSH の握手に時間がかかる。止まったかどうかは `within` が 1.5 秒で見る。
  this.timeout(10000);
  let ibmi: FakeIbmi;
  let server: Awaited<ReturnType<typeof startServer>>;

  setup(async () => {
    ibmi = { ifs: new Map(), members: new Map([["ORDR01", "C     ORDR01\n"]]), commands: [], stdout: "" };
    server = await startServer(ibmi);
  });

  teardown(async () => {
    await server.close();
  });

  test("コマンドが標準出力に何か出しても、一覧を取って終わる（IBM i の system はメッセージを出す）", async () => {
    ibmi.stdout = "CPC7C01: 実行されました。\n";
    const transport = await createIbmiSourceTransport(server.settings, "secret");
    try {
      const listing = await within(transport.listMembers("MYLIB", "QRPGSRC"));
      assert.deepEqual(listing.members.map(member => member.name), ["ORDR01"]);
      assert.equal(ibmi.ifs.size, 0, "一時ファイルを消していない");
    } finally {
      transport.dispose();
    }
  });

  test("標準出力が空でも止まらない", async () => {
    const transport = await createIbmiSourceTransport(server.settings, "secret");
    try {
      await within(transport.listMembers("MYLIB", "QRPGSRC"));
    } finally {
      transport.dispose();
    }
  });

  test("ダウンロードとアップロードも SSH・SFTP を往復して終わる", async () => {
    ibmi.stdout = "CPCA083: コピーされました。\n";
    const transport = await createIbmiSourceTransport(server.settings, "secret");
    try {
      const target = { library: "MYLIB", sourceFile: "QRPGSRC", member: "ORDR01", extension: "rpgle" };
      assert.equal(await within(transport.download(target)), "C     ORDR01\n");
      await within(transport.upload({ ...target, member: "NEW01" }, "C     NEW01\n", { sourceType: "RPGLE" }));
      assert.equal(ibmi.members.get("NEW01"), "C     NEW01\n");
      assert.ok(ibmi.commands.some(command => command.startsWith("CHGPFM FILE(MYLIB/QRPGSRC) MBR(NEW01) SRCTYPE(RPGLE)")));
      assert.equal(ibmi.ifs.size, 0, "一時ファイルを消していない");
    } finally {
      transport.dispose();
    }
  });

  test("コマンドが失敗したら、IBM i のメッセージを理由に含めて失敗する", async () => {
    ibmi.failWith = "CPF9810: ライブラリー MYLIB が見つかりません。\n";
    const transport = await createIbmiSourceTransport(server.settings, "secret");
    try {
      await assert.rejects(
        () => within(transport.listMembers("MYLIB", "QRPGSRC")),
        (error: unknown) => error instanceof IbmiSourceSyncError && error.kind === "list" && error.message.includes("CPF9810")
      );
    } finally {
      transport.dispose();
    }
  });
});
