import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import { registerDdsSymbols } from "../../src/language/ddsSymbols";
import { registerCmdSymbols } from "../../src/language/cmdSymbols";
import {
  registerDdsKeywordCompletion,
  resolveDdsType
} from "../../src/language/ddsKeywordCompletion";
import { buildDdsOutline } from "../../src/language/ddsSymbols";
import { toLineReader } from "../../src/language/outlineTypes";
import {
  CL_EXTENSIONS,
  DDS_EXTENSIONS,
  RPG_EXTENSIONS
} from "../../src/utils/fileScope";

/**
 * 「追加したリソースは到達可能になって初めて完了」（AGENTS.md）。
 *
 * provider を書いても、対象の拡張子が DocumentSelector に無ければ何も起きない。
 * ここでは**実際に登録された selector** を捕まえて検査する。
 * `toGlobPattern` を直接呼ぶだけのテストでは、登録側が glob を手書きに戻しても気付けない
 * ——実際に ddsKeywordCompletion の手書き glob が `.dds` を落としていた。
 */

interface Registration {
  kind: string;
  selector: unknown;
  triggers?: unknown[];
}

function captured(): Registration[] {
  return (vscode.languages as unknown as { registered: Registration[] }).registered;
}

function reset(): void {
  captured().length = 0;
}

/** 登録された selector に含まれる glob の中身（拡張子）を集める。 */
function extensionsOf(selector: unknown): string[] {
  const filters = Array.isArray(selector) ? selector : [selector];
  const found = new Set<string>();

  for (const filter of filters) {
    const pattern = (filter as { pattern?: string }).pattern;
    if (typeof pattern !== "string") continue;

    // 複数なら `**/*.{a,b}`、1 個なら `**/*.a`（単一候補の brace group を
    // 展開しない glob 実装があるため波括弧を付けない）。両方を読む。
    // glob には大文字の変種も並ぶ（IBM i のメンバー名は大文字が普通）。
    // 比較しやすいよう小文字に畳む。
    const braces = /\{([A-Za-z0-9,]+)\}$/u.exec(pattern);
    if (braces) {
      for (const extension of braces[1].split(",")) {
        found.add(extension.toLowerCase());
      }
      continue;
    }

    const single = /\.([A-Za-z0-9]+)$/u.exec(pattern);
    if (single) {
      found.add(single[1].toLowerCase());
    }
  }

  return [...found];
}

const context = {
  subscriptions: [] as { dispose(): void }[],
  extensionUri: vscode.Uri.file("/tmp/ext")
} as unknown as vscode.ExtensionContext;

suite("アウトラインの到達性", () => {
  test("DDS の DocumentSymbolProvider が全 DDS 拡張子で登録される", () => {
    reset();
    registerDdsSymbols();

    const registration = captured().find(r => r.kind === "documentSymbol");
    assert.ok(registration, "DocumentSymbolProvider が登録されていない");

    const extensions = extensionsOf(registration.selector);
    for (const extension of DDS_EXTENSIONS) {
      assert.ok(
        extensions.includes(extension),
        `.${extension} でアウトラインが出ない（selector: ${JSON.stringify(registration.selector)}）`
      );
    }
  });

  test(".cmd の DocumentSymbolProvider が登録される", () => {
    reset();
    registerCmdSymbols();

    const registration = captured().find(r => r.kind === "documentSymbol");
    assert.ok(registration, "DocumentSymbolProvider が登録されていない");
    assert.deepEqual(extensionsOf(registration.selector), ["cmd"]);
  });

  test("アウトラインは RPG / CL の拡張子で登録されない（既存拡張と二重にしない）", () => {
    reset();
    registerDdsSymbols();
    registerCmdSymbols();

    const registered = new Set(
      captured()
        .filter(r => r.kind === "documentSymbol")
        .flatMap(r => extensionsOf(r.selector))
    );

    for (const extension of [...RPG_EXTENSIONS, ...CL_EXTENSIONS]) {
      assert.ok(
        !registered.has(extension),
        `.${extension} にアウトラインを登録している（vscode-rpgle / vscode-clle と二重になる）`
      );
    }
  });

  test("DDS キーワード補完の selector も派生 const から作る", () => {
    reset();
    registerDdsKeywordCompletion(context);

    const registration = captured().find(r => r.kind === "completionItem");
    assert.ok(registration, "補完が登録されていない");

    const extensions = extensionsOf(registration.selector);
    for (const extension of DDS_EXTENSIONS) {
      assert.ok(
        extensions.includes(extension),
        `.${extension} が DDS 補完の selector から漏れている`
      );
    }
  });

  test("既知の限界: .dds は種別が決まらないのでキーワード補完は出ない", () => {
    // selector には `.dds` が入っているが、それだけでは補完は出ない。
    // resolveDdsType が `.dds` から PF / DSPF / PRTF を判別できないため
    // （拡張子に情報が無い）、provideCompletionItems は即 return する。
    //
    // アウトラインは構造が種別共通なのでこの制約を受けない（`.dds` でも出る）。
    // ここを「直った」と書いてしまうと、直っていない振る舞いを固定してしまう。
    assert.equal(resolveDdsType("/x/y/FOO.dds"), undefined);
    assert.equal(resolveDdsType("/x/y/FOO.pf"), "DDS-PF");
    assert.equal(resolveDdsType("/x/y/FOO.dspf"), "DDS-DSPF");
    assert.equal(resolveDdsType("/x/y/FOO.prtf"), "DDS-PRTF");
  });

  test("既知の限界に反して .dds でもアウトラインは出る", () => {
    const { lineAt, lineCount } = toLineReader(
      "     A          R TESTREC\n     A            FLD1          10A"
    );
    const outline = buildDdsOutline(lineAt, lineCount);

    assert.equal(outline.length, 1);
    assert.equal(outline[0].name, "TESTREC");
    assert.equal(outline[0].children[0].name, "FLD1");
  });
});
