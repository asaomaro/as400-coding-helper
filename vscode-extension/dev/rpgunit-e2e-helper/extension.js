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
    // IFS 方式: 現行ライブラリー（テスト・プログラムを作る先）とデプロイ先。E2E_DEPLOY_DIR が無ければデプロイ先を外す
    // （起動ごとに変数で決める。デプロイ先は Code for IBM i のストレージに残るため）。
    if (r && r.success) {
      const connection = api.instance.getConnection();
      if (process.env.E2E_CURLIB) connection.getConfig().currentLibrary = process.env.E2E_CURLIB;
      const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
      const storage = api.instance.getStorage();
      if (folder && storage) {
        const deployments = storage.getDeployment();
        delete deployments[folder.uri.fsPath];
        if (process.env.E2E_DEPLOY_DIR) deployments[folder.uri.fsPath] = process.env.E2E_DEPLOY_DIR;
        await storage.setDeployment(deployments);
      }
    }
    write("connect:" + JSON.stringify({ success: r && r.success, error: r && r.error, errorCode: r && r.errorCode }));
  } catch (e) { write("connect-error:" + (e && e.message)); }
};
exports.deactivate = () => {};
