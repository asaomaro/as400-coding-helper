// E2E専用: Code for IBM iへプログラムから接続する。資格情報は環境変数から受け取り、出力しない。
const vscode = require("vscode");
const fs = require("fs");
exports.activate = async () => {
  const write = s => fs.appendFileSync(process.env.E2E_STATUS_FILE, s + "\n");
  try {
    const ext = vscode.extensions.getExtension("halcyontechltd.code-for-ibmi");
    const api = ext.isActive ? ext.exports : await ext.activate();
    const r = await api.instance.connect({ data: {
      name: "E2E", host: process.env.E2E_HOST, port: 22,
      username: process.env.E2E_USER, password: process.env.E2E_PASSWORD } });
    write("connect:" + JSON.stringify({ success: r && r.success, error: r && r.error, errorCode: r && r.errorCode }));
  } catch (e) { write("connect-error:" + (e && e.message)); }
};
exports.deactivate = () => {};
