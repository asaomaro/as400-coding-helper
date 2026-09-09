import * as assert from "assert";
import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyDdsEdits,
  validateDdsEdits,
  type DdsEdit
} from "../../src/core/dds/ddsEdit";
import { buildDspfRenderModel } from "../../src/core/dds/dspfRenderModel";
import {
  DDS_EDITOR_VIEW_TYPE,
  OPEN_DDS_EDITOR_COMMAND,
  registerDdsVisualEditor
} from "../../src/dds/editorProvider";

/**
 * エディタの配線と、編集が文書に届くまでの経路。
 *
 * AGENTS.md「追加したリソースは『到達可能』になって初めて完了」——
 * `ddsEdit` が正しくても、登録されていなければ画面には何も出ない。
 *
 * WebView の**中**は拡張ホストから触れないので、操作そのものは
 * 単独起動ハーネスの e2e（`dev/e2e.mjs`）が受け持つ。ここは**両端**を見る。
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const SAMPLE = join(ROOT, "docs", "src", "CUSTMNT.dspf");
const LINES = readFileSync(SAMPLE, "utf8").split(/\r?\n/u);

suite("DDS エディタ: 配線", () => {
  test("カスタムエディタとして登録される", () => {
    const context = { subscriptions: [], extensionUri: { fsPath: ROOT } };
    (vscode.window as unknown as { __customEditors?: unknown[] }).__customEditors = [];

    registerDdsVisualEditor(context as unknown as vscode.ExtensionContext);

    const registered = (
      vscode.window as unknown as {
        __customEditors: Array<{ viewType: string; options: Record<string, unknown> }>;
      }
    ).__customEditors;
    assert.strictEqual(registered.length, 1, "登録されていない");
    assert.strictEqual(registered[0].viewType, DDS_EDITOR_VIEW_TYPE);
    assert.strictEqual(
      registered[0].options.supportsMultipleEditorsPerDocument,
      false,
      "同じ文書を複数のエディタで開けてしまう"
    );
    assert.strictEqual(
      context.subscriptions.length,
      4,
      "後片付けが登録されていない" +
        "（エディタ ＋ 開くコマンド ＋ 新規作成 2 つ（DSPF / PRTF）の 4 つ）"
    );
  });

  /**
   * **開く手段があること**まで見る。
   *
   * `customEditors` の `priority` は `option` なので、コマンドが無い間は
   * 「エディターで開く…」を知る利用者にしか届かない。登録の有無だけでは
   * この死蔵を検出できない（登録は最初から通っていた）。
   */
  test("コマンドから開ける（対象のファイル）", async () => {
    const context = { subscriptions: [], extensionUri: { fsPath: ROOT } };
    (vscode.window as unknown as { __customEditors?: unknown[] }).__customEditors = [];
    registerDdsVisualEditor(context as unknown as vscode.ExtensionContext);

    // 組み込みコマンドを差し替えて、渡された引数を捕まえる。
    const opened: unknown[][] = [];
    vscode.commands.registerCommand("vscode.openWith", (...args: unknown[]) => {
      opened.push(args);
    });
    vscode.window.activeTextEditor = {
      document: { uri: { fsPath: SAMPLE } }
    } as unknown as vscode.TextEditor;

    await vscode.commands.executeCommand(OPEN_DDS_EDITOR_COMMAND);

    assert.strictEqual(opened.length, 1, "vscode.openWith が呼ばれていない");
    // **引数の順は (uri, viewType)。** 逆にすると無言で失敗する。
    assert.deepStrictEqual(opened[0][0], { fsPath: SAMPLE });
    assert.strictEqual(opened[0][1], DDS_EDITOR_VIEW_TYPE);
  });

  test("対象外のファイルでは開かず案内を出す", async () => {
    const context = { subscriptions: [], extensionUri: { fsPath: ROOT } };
    (vscode.window as unknown as { __customEditors?: unknown[] }).__customEditors = [];
    registerDdsVisualEditor(context as unknown as vscode.ExtensionContext);

    const opened: unknown[][] = [];
    vscode.commands.registerCommand("vscode.openWith", (...args: unknown[]) => {
      opened.push(args);
    });
    // `.pf` は DDS だがこのエディタの対象ではない（DDS-PF）。
    vscode.window.activeTextEditor = {
      document: { uri: { fsPath: join(ROOT, "sample.pf") } }
    } as unknown as vscode.TextEditor;
    // `messages` はスタブだけが持つ（実物の API には無い）。
    const stub = vscode.window as unknown as { messages: string[] };
    stub.messages.length = 0;

    await vscode.commands.executeCommand(OPEN_DDS_EDITOR_COMMAND);

    assert.strictEqual(opened.length, 0, "対象外なのに開いた");
    assert.strictEqual(stub.messages.length, 1, "案内が出ていない");
  });

  test("viewType は package.json の customEditors と一致する", () => {
    const manifest = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "..", "package.json"), "utf8")
    ) as {
      contributes: {
        customEditors?: Array<{ viewType: string; priority: string; selector: unknown[] }>;
      };
    };
    const editors = manifest.contributes.customEditors ?? [];
    assert.strictEqual(editors.length, 1);
    assert.strictEqual(editors[0].viewType, DDS_EDITOR_VIEW_TYPE);
    // **既定のエディタを奪わない。** option でないと .dspf をダブルクリックしたときに
    // テキストエディタが開かなくなり、ルーラー / SOSI / lint が使えなくなる。
    assert.strictEqual(editors[0].priority, "option", "既定エディタを奪っている");
  });

  /**
   * 右クリックから**両方**選べること。
   *
   * 拡張子の一致は `verify-contributes.mjs` が `resolveDdsType` と
   * `customEditors[].selector` の両方に対して見る。ここで見るのは
   * 「読む器と編集する器が同じメニューに並ぶ」ことだけ。
   */
  test("プレビューとエディタが同じ右クリックメニューに並ぶ", () => {
    const manifest = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "..", "package.json"), "utf8")
    ) as {
      contributes: {
        menus?: { "editor/context"?: Array<{ command: string; group: string }> };
      };
    };
    const items = manifest.contributes.menus?.["editor/context"] ?? [];
    const editor = items.find(entry => entry.command === OPEN_DDS_EDITOR_COMMAND);
    assert.ok(editor, "エディタが右クリックから開けない");

    const previews = items.filter(entry => entry.command.endsWith("Preview"));
    assert.strictEqual(previews.length, 2, "プレビューの導線が欠けている");
    // **読む方を先に置く。** 確認だけの用途の方が頻度が高い。
    for (const preview of previews) {
      assert.ok(
        preview.group < editor.group,
        `${preview.command} がエディタより後に並んでいる`
      );
    }
  });
});

suite("DDS エディタ: 編集が文書に届くまで", () => {
  /** provider が通す経路をそのまま組み立てる（VSCode API に触るのは WorkspaceEdit だけ）。 */
  function apply(edits: readonly DdsEdit[]): string[] {
    assert.deepStrictEqual(validateDdsEdits(LINES, edits, "DDS-DSPF"), [], "検証で弾かれた");
    const lines = [...LINES];
    for (const result of applyDdsEdits(LINES, edits, "DDS-DSPF")) {
      lines.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
    }
    return lines;
  }

  test("描画モデルの項目は、そのまま編集の宛先になる", () => {
    const model = buildDspfRenderModel(LINES);
    const item = model.items.find(candidate => candidate.resizable);
    assert.ok(item, "長さを変えられる項目が無い");

    const after = apply([{ kind: "resize", sourceLine: item.sourceLine, length: 12 }]);
    assert.strictEqual(Number(after[item.sourceLine - 1].slice(29, 34)), 12);
    assert.strictEqual(after.length, LINES.length, "行数が変わった");
  });

  test("移動しても対象行以外はバイト不変", () => {
    const model = buildDspfRenderModel(LINES);
    const item = model.items[0];
    const after = apply([
      { kind: "move", sourceLine: item.sourceLine, row: item.row + 1, column: item.column + 1 }
    ]);
    const changed = after
      .map((line, index) => (line === LINES[index] ? -1 : index))
      .filter(index => index >= 0);
    assert.deepStrictEqual(changed, [item.sourceLine - 1]);
  });

  test("実サンプルの項目がすべて描画モデルに載る", () => {
    const model = buildDspfRenderModel(LINES);
    assert.ok(model.items.length > 0);
    assert.ok(model.records.length >= 2, "複数様式のサンプルのはず");
    for (const item of model.items) {
      assert.ok(item.sourceLine > 0 && item.row > 0 && item.column > 0);
    }
  });
});

/**
 * **新規作成の導線**（AC1）。
 *
 * 「コマンドが登録されている」だけでは足りない——押したときに
 * **ファイルができて、ビジュアルエディタで開く**ところまでが完了条件。
 * `verify-contributes.mjs` は宣言の一致（到達できる形か）を見るので、
 * ここでは**実際に押したときの振る舞い**を見る。
 */
suite("DDS エディタ: 新規作成", () => {
  const setup = (): { subscriptions: unknown[] } => {
    const context = { subscriptions: [], extensionUri: { fsPath: ROOT } };
    (vscode.window as unknown as { __customEditors?: unknown[] }).__customEditors = [];
    const win = vscode.window as unknown as Record<string, unknown>;
    win.__saveDialogResult = undefined;
    win.__saveDialogOptions = undefined;
    win.errors = [];
    const fs = (vscode.workspace as unknown as { fs: Record<string, unknown> }).fs;
    fs.__written = [];
    fs.__failWrite = false;
    registerDdsVisualEditor(context as unknown as vscode.ExtensionContext);
    return context as unknown as { subscriptions: unknown[] };
  };

  const captureOpenWith = (): unknown[][] => {
    const opened: unknown[][] = [];
    vscode.commands.registerCommand("vscode.openWith", (...args: unknown[]) => {
      opened.push(args);
    });
    return opened;
  };

  const written = (): Array<{ uri: { fsPath: string }; content: Buffer }> =>
    (vscode.workspace as unknown as {
      fs: { __written: Array<{ uri: { fsPath: string }; content: Buffer }> };
    }).fs.__written;

  test("新規 DSPF が雛形を書き、ビジュアルエディタで開く", async () => {
    setup();
    const opened = captureOpenWith();
    (vscode.window as unknown as Record<string, unknown>).__saveDialogResult =
      vscode.Uri.file("/tmp/NEWDSPF.dspf");

    await vscode.commands.executeCommand("rpgClSupport.newDspf");

    assert.strictEqual(written().length, 1, "ファイルが書かれていない");
    assert.strictEqual(written()[0].uri.fsPath, "/tmp/NEWDSPF.dspf");
    assert.strictEqual(
      written()[0].content.toString("utf8"),
      "     A                                      DSPSIZ(24 80 *DS3)\n" +
        "     A          R REC1\n",
      "core の雛形と同じ内容で書かれていない"
    );
    // **引数は (uri, viewType) の順**——逆にすると無言で失敗する。
    assert.strictEqual(opened.length, 1, "ビジュアルエディタで開いていない");
    assert.strictEqual(
      (opened[0][0] as { fsPath: string }).fsPath,
      "/tmp/NEWDSPF.dspf"
    );
    assert.strictEqual(opened[0][1], DDS_EDITOR_VIEW_TYPE);
  });

  test("新規 PRTF は画面サイズを書かない", async () => {
    setup();
    captureOpenWith();
    (vscode.window as unknown as Record<string, unknown>).__saveDialogResult =
      vscode.Uri.file("/tmp/NEWPRTF.prtf");

    await vscode.commands.executeCommand("rpgClSupport.newPrtf");

    assert.strictEqual(
      written()[0].content.toString("utf8"),
      "     A          R REC1\n",
      "帳票に DSPSIZ 相当が入っている（紙面は CRTPRTF の PAGESIZE）"
    );
  });

  /**
   * **拡張子が種別に合わなければ足す。** 合わないまま作ると、ファイルはできても
   * ビジュアルエディタで開かない（`customEditors` の selector に載らない）。
   */
  test("拡張子が無ければ種別のものを足す", async () => {
    setup();
    const opened = captureOpenWith();
    (vscode.window as unknown as Record<string, unknown>).__saveDialogResult =
      vscode.Uri.file("/tmp/SCREEN");

    await vscode.commands.executeCommand("rpgClSupport.newDspf");

    assert.strictEqual(written()[0].uri.fsPath, "/tmp/SCREEN.dspf");
    assert.strictEqual((opened[0][0] as { fsPath: string }).fsPath, "/tmp/SCREEN.dspf");
  });

  /** `.mnudds` も DSPF なので**そのまま通す**（拡張子を付け直さない）。 */
  test(".mnudds はそのまま通す（DSPF と同じ A 仕様書）", async () => {
    setup();
    captureOpenWith();
    (vscode.window as unknown as Record<string, unknown>).__saveDialogResult =
      vscode.Uri.file("/tmp/MENU.mnudds");

    await vscode.commands.executeCommand("rpgClSupport.newDspf");

    assert.strictEqual(written()[0].uri.fsPath, "/tmp/MENU.mnudds");
  });

  /** 取り消したら**何も起きない**（通知も出さない）。 */
  test("保存ダイアログを取り消すと何も作らない", async () => {
    setup();
    const opened = captureOpenWith();
    // __saveDialogResult は undefined のまま＝取り消し。

    await vscode.commands.executeCommand("rpgClSupport.newDspf");

    assert.strictEqual(written().length, 0, "ファイルができている");
    assert.strictEqual(opened.length, 0, "エディタが開いている");
    assert.deepStrictEqual(
      (vscode.window as unknown as { errors: string[] }).errors,
      [],
      "取り消しただけなのに通知が出ている"
    );
  });

  /** 書き出しに失敗したら**黙らせない**。エディタも開かない。 */
  test("書き出しに失敗したら理由を出し、エディタは開かない", async () => {
    setup();
    const opened = captureOpenWith();
    (vscode.window as unknown as Record<string, unknown>).__saveDialogResult =
      vscode.Uri.file("/tmp/NEWDSPF.dspf");
    (vscode.workspace as unknown as { fs: Record<string, unknown> }).fs.__failWrite = true;

    await vscode.commands.executeCommand("rpgClSupport.newDspf");

    assert.strictEqual(opened.length, 0, "書けていないのにエディタを開いた");
    const errors = (vscode.window as unknown as { errors: string[] }).errors;
    assert.strictEqual(errors.length, 1, "理由が出ていない");
    assert.ok(errors[0].includes("作成できませんでした"), errors[0]);
  });
});

/**
 * **保存ダイアログが確かめていないパスに書かない。**
 *
 * `showSaveDialog` は**利用者が打ったパス**の衝突しか見ない。こちらが拡張子を足して
 * **別のパス**へ書くなら、ダイアログが出したはずの確認をやり直す必要がある
 * ——**上書きに undo は無い**（開いていないファイルなので `WorkspaceEdit` でもない）。
 *
 * この PJ が「確認を出さず undo に委ねる」のは**取り消せる操作**の話で、
 * 消えたら戻らないものには当てはまらない。
 */
suite("DDS エディタ: 新規作成が既存ファイルを消さない", () => {
  const prepare = (existing: string[]): void => {
    const context = { subscriptions: [], extensionUri: { fsPath: ROOT } };
    (vscode.window as unknown as { __customEditors?: unknown[] }).__customEditors = [];
    const win = vscode.window as unknown as Record<string, unknown>;
    win.__saveDialogResult = undefined;
    win.__warningAnswer = undefined;
    win.messages = [];
    win.errors = [];
    const fs = (vscode.workspace as unknown as { fs: Record<string, unknown> }).fs;
    fs.__written = [];
    fs.__failWrite = false;
    fs.__existing = existing;
    registerDdsVisualEditor(context as unknown as vscode.ExtensionContext);
    vscode.commands.registerCommand("vscode.openWith", () => undefined);
  };

  const written = (): Array<{ uri: { fsPath: string } }> =>
    (vscode.workspace as unknown as { fs: { __written: Array<{ uri: { fsPath: string } }> } })
      .fs.__written;

  test("拡張子を足した先が既にあれば、確認するまで書かない", async () => {
    prepare(["/tmp/CUSTMNT.dspf"]);
    // 利用者は拡張子なしで打った。ダイアログは `/tmp/CUSTMNT` の衝突しか見ていない。
    (vscode.window as unknown as Record<string, unknown>).__saveDialogResult =
      vscode.Uri.file("/tmp/CUSTMNT");

    await vscode.commands.executeCommand("rpgClSupport.newDspf");

    assert.strictEqual(written().length, 0, "確認せずに既存ファイルを上書きした");
    const warnings = (vscode.window as unknown as { messages: string[] }).messages;
    assert.strictEqual(warnings.length, 1, "確認していない");
    assert.ok(warnings[0].includes("CUSTMNT.dspf"), warnings[0]);
  });

  test("確認で承知すれば上書きする", async () => {
    prepare(["/tmp/CUSTMNT.dspf"]);
    const win = vscode.window as unknown as Record<string, unknown>;
    win.__saveDialogResult = vscode.Uri.file("/tmp/CUSTMNT");
    win.__warningAnswer = "上書きする";

    await vscode.commands.executeCommand("rpgClSupport.newDspf");

    assert.strictEqual(written().length, 1);
    assert.strictEqual(written()[0].uri.fsPath, "/tmp/CUSTMNT.dspf");
  });

  /**
   * **ダイアログが答えたパスのままなら聞き直さない。** そこはダイアログが
   * 既に衝突を確かめている——二度聞くのは邪魔なだけ。
   */
  test("拡張子を足していなければ聞き直さない", async () => {
    prepare(["/tmp/CUSTMNT.dspf"]);
    (vscode.window as unknown as Record<string, unknown>).__saveDialogResult =
      vscode.Uri.file("/tmp/CUSTMNT.dspf");

    await vscode.commands.executeCommand("rpgClSupport.newDspf");

    assert.deepStrictEqual(
      (vscode.window as unknown as { messages: string[] }).messages,
      [],
      "ダイアログが確認済みのパスで聞き直している"
    );
    assert.strictEqual(written().length, 1);
  });

  test("拡張子を足した先が無ければそのまま書く", async () => {
    prepare([]);
    (vscode.window as unknown as Record<string, unknown>).__saveDialogResult =
      vscode.Uri.file("/tmp/BRANDNEW");

    await vscode.commands.executeCommand("rpgClSupport.newDspf");

    assert.deepStrictEqual((vscode.window as unknown as { messages: string[] }).messages, []);
    assert.strictEqual(written()[0].uri.fsPath, "/tmp/BRANDNEW.dspf");
  });
});
