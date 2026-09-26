import type { IbmiTestingConnection } from "./codeForIbmi";

/**
 * `CODECOV`（5770WDS付属）の実機可用性を検出する。
 *
 * コマンド構築・実行・`.cczip`解析は実装しない（`.aidev/works/20260922-rpgunit-vscode-testing/decisions.md` D6）。本PJが検証に使える
 * 唯一の実機（SR-OSAKA）にCODECOV自体が導入されておらず、構文・出力形式を確認する
 * 手段が無いため。検出できなければ `testController.ts` はCoverageプロファイルを
 * 登録しない（`.aidev/works/20260922-rpgunit-vscode-testing/decisions.md` D3）。
 */
const CODECOV_CANDIDATE_LIBRARIES = ["QGPL", "QDEVTOOLS"] as const;

export async function isCodeCoverageAvailable(connection: IbmiTestingConnection): Promise<boolean> {
  for (const library of CODECOV_CANDIDATE_LIBRARIES) {
    const exists = await connection.checkObjectExists({ library, name: "CODECOV", type: "*CMD" });
    if (exists) {
      return true;
    }
  }
  return false;
}
