import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { applyOps, parse } from "@as400/dds-core";
import {
  applyPatchToDocument,
  DDS_EDITOR_VIEW_TYPE
} from "../../src/dds/editorProvider";
import { isInScopeUri } from "../../src/utils/fileScope";

/** リポジトリ内のフィクスチャ（out-test/test/integration から 4 つ上がリポジトリ根）。 */
const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "dds-core",
  "test",
  "fixtures",
  "golden-a.dspf"
);

async function openFixture(): Promise<vscode.TextDocument> {
  // ファイルそのものを編集すると作業ツリーが汚れるので、内容だけ借りた無題の文書を使う。
  return vscode.workspace.openTextDocument({
    content: readFileSync(FIXTURE, "utf8")
  });
}

suite("DDS ビジュアルエディタ（統合）", () => {
  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("AC8: `.dspf` は従来どおりテキストエディタで開く（既定を奪わない）", async () => {
    const uri = vscode.Uri.file(FIXTURE);
    await vscode.commands.executeCommand("vscode.open", uri);

    const active = vscode.window.activeTextEditor;
    assert.ok(active, "テキストエディタが開いていない（既定を奪っている可能性）");
    assert.equal(active?.document.uri.fsPath, uri.fsPath);
  });

  test("AC8: `.dspf` は表示系（ルーラー / SOSI）の対象のまま", () => {
    // 表示系は languageId ではなく拡張子で有効化する（AGENTS.md の方針）。
    assert.ok(isInScopeUri(vscode.Uri.file(FIXTURE)));
  });

  test("ビジュアルエディタは指定したときだけ開く", async () => {
    const uri = vscode.Uri.file(FIXTURE);
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      DDS_EDITOR_VIEW_TYPE
    );
    // カスタムエディタが前面にあるとき、アクティブな**テキスト**エディタは無い。
    assert.equal(
      vscode.window.activeTextEditor,
      undefined,
      "カスタムエディタが開いていない"
    );
  });

  test("AC1 / AC2: 移動を適用すると 39-44 桁だけが変わる（実文書への WorkspaceEdit）", async () => {
    const document = await openFixture();
    await vscode.window.showTextDocument(document);
    const before = document.getText().split("\n");

    const target = before.findIndex(line => /^ {5}A {12}\S/.test(line));
    assert.ok(target >= 0, "フィールド行が見つからない");

    const record = /^ {5}A {10}R (\S+)/.exec(
      before.find(line => /^ {5}A {10}R /.test(line)) ?? ""
    );
    assert.ok(record, "レコード様式が見つからない");

    // 最初のアイテムを動かす（ID は出現順の採番＝`<様式>#1`）。
    const outcome = await applyPatchToDocument(document, [
      { op: "moveItem", id: `${record[1]}#1`, line: 12, pos: 40 }
    ]);
    assert.ok(outcome.applied, `適用されなかった: ${outcome.reason ?? ""}`);

    const after = document.getText().split("\n");
    assert.equal(after.length, before.length, "行数が変わった");

    const changed = after
      .map((line, index) => (line === before[index] ? -1 : index))
      .filter(index => index >= 0);
    assert.equal(changed.length, 1, `変更行が 1 行でない: ${JSON.stringify(changed)}`);

    const line = after[changed[0]];
    assert.equal(line.slice(38, 41), " 12", "39-41 桁（行）が更新されていない");
    assert.equal(line.slice(41, 44), " 40", "42-44 桁（桁）が更新されていない");
    assert.equal(
      line.slice(0, 38),
      before[changed[0]].slice(0, 38),
      "38 桁目までが変わった"
    );
    assert.equal(
      line.slice(44),
      before[changed[0]].slice(44),
      "45 桁目以降が変わった"
    );
  });

  test("AC3: 削除しても他の行はバイト不変（行が正しく 1 本減る）", async () => {
    const document = await openFixture();
    await vscode.window.showTextDocument(document);
    const before = document.getText().split("\n");
    const record = /^ {5}A {10}R (\S+)/.exec(
      before.find(line => /^ {5}A {10}R /.test(line)) ?? ""
    );
    assert.ok(record);

    // **どの行が消えるかを当てにいかない**（`#1` が定数かフィールドかはソース次第）。
    // 「1 行だけが抜けて、残りは順序も内容もそのまま」であることを構造で確かめる。
    const outcome = await applyPatchToDocument(document, [
      { op: "removeItem", id: `${record[1]}#1` }
    ]);
    assert.ok(outcome.applied, `適用されなかった: ${outcome.reason ?? ""}`);

    const after = document.getText().split("\n");
    assert.equal(after.length, before.length - 1, "行がちょうど 1 本減っていない");

    const firstDiff = after.findIndex((line, index) => line !== before[index]);
    assert.ok(firstDiff >= 0, "何も変わっていない");
    assert.deepEqual(
      after.slice(firstDiff),
      before.slice(firstDiff + 1),
      "抜けた 1 行以外にも差分がある"
    );
    assert.deepEqual(
      after.slice(0, firstDiff),
      before.slice(0, firstDiff),
      "抜けた行より前が変わった"
    );
  });

  test("AC4: GUI 経路の結果が core の `applyOps` と**完全に一致**する", async () => {
    // AC4 は「CLI が GUI の L1 と同等」。CLI 側は parity テストで固定済み（06）。
    // ここでは **GUI 側**——provider が VSCode の WorkspaceEdit を経由しても、
    // 文書が core の出力と 1 バイトも違わないことを示す。
    // 経路が違っても結果が同じ、が「同じコアを叩いている」ことの実証になる。
    const document = await openFixture();
    await vscode.window.showTextDocument(document);
    const source = document.getText();
    const record = /^ {5}A {10}R (\S+)/.exec(
      source.split("\n").find(line => /^ {5}A {10}R /.test(line)) ?? ""
    );
    assert.ok(record);

    const ops = [
      { op: "moveItem" as const, id: `${record[1]}#2`, line: 15, pos: 33 }
    ];
    const expected = applyOps(parse(source), ops).text;

    const outcome = await applyPatchToDocument(document, ops);
    assert.ok(outcome.applied, `適用されなかった: ${outcome.reason ?? ""}`);
    assert.equal(document.getText(), expected, "GUI 経路の結果が core と食い違う");
  });

  test("undo は VSCode 側で成立する（自前の undo を持たない）", async () => {
    const document = await openFixture();
    await vscode.window.showTextDocument(document);
    const before = document.getText();
    const record = /^ {5}A {10}R (\S+)/.exec(
      before.split("\n").find(line => /^ {5}A {10}R /.test(line)) ?? ""
    );
    assert.ok(record);

    await applyPatchToDocument(document, [
      { op: "moveItem", id: `${record[1]}#1`, line: 20, pos: 5 }
    ]);
    assert.notEqual(document.getText(), before, "適用されていない");

    await vscode.commands.executeCommand("undo");
    assert.equal(document.getText(), before, "undo で元に戻らない");
  });
});
