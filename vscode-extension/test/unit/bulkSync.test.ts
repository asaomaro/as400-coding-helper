import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildMemberListSql,
  buildSyncRows,
  countLines,
  downloadFileName,
  isTransferable,
  overwriteConfirmations,
  parseMemberListing,
  readLocalMembers,
  type RemoteMember
} from "../../src/sync/bulkSync";

const at = (text: string): number => Date.parse(`${text}Z`);

const remote = (name: string, changed: string, extra: Partial<RemoteMember> = {}): RemoteMember => ({
  name,
  sourceType: "RPGLE",
  text: "",
  lines: 10,
  changed: at(changed),
  ...extra
});

suite("一括の送受信: IBM i のメンバー一覧", () => {
  test("SQL はソースかどうかを SYSTABLES の FILE_TYPE で見て、日時を UTC に直す", () => {
    const sql = buildMemberListSql("MYLIB", "QRPGSRC");
    assert.ok(sql.includes("FILE_TYPE = 'S'"), sql);
    assert.ok(sql.includes("- CURRENT TIMEZONE"), sql);
    // VARCHAR_FORMAT は "T" のような文字を書式に入れられない（実機で SQLCODE -20447）。
    assert.ok(sql.includes("'YYYY-MM-DD HH24:MI:SS'"), sql);
    assert.ok(sql.includes("ORDER BY SYSTEM_TABLE_MEMBER"), sql);
  });

  test("実機が書いた JSON を読む（日時は UTC、記述の引用符と日本語はそのまま）", () => {
    // 2026-09-27 実機（7.3）で IFS_WRITE_UTF8 が書いたものと同じ形（verify/probe-member-list.mjs）。
    const listing = parseMemberListing(
      '{"exists":1,"members":[{"name":"KWVALD","type":"DSPF","text":"受注入力 \\"A\\" \'B\'","lines":12,"changed":"2026-09-27 10:06:17"}]}'
    );
    assert.deepEqual(listing, {
      exists: true,
      members: [{ name: "KWVALD", sourceType: "DSPF", text: "受注入力 \"A\" 'B'", lines: 12, changed: at("2026-09-27T10:06:17") }]
    });
  });

  test("メンバーが無いソース・ファイルは members が null、無いファイルは exists が 0", () => {
    assert.deepEqual(parseMemberListing('{"exists":1,"members":null}'), { exists: true, members: [] });
    assert.deepEqual(parseMemberListing('{"exists":0,"members":null}'), { exists: false, members: [] });
  });

  test("形が違うものは読まない", () => {
    for (const text of ["", "null", "{}", '{"exists":1,"members":{}}', '{"exists":1,"members":[{"name":"A","changed":"2026/09/27"}]}']) {
      assert.equal(parseMemberListing(text), undefined, text);
    }
  });
});

suite("一括の送受信: ローカルとの突き合わせ", () => {
  test("行数は最後の改行の後を数えない", () => {
    assert.equal(countLines(""), 0);
    assert.equal(countLines("A\nB\n"), 2);
    assert.equal(countLines("A\r\nB"), 2);
  });

  test("ファイル名をメンバー名・記述・ソース・タイプとして読み、読めないものと重複は理由を付ける", () => {
    const local = readLocalMembers([
      { fileName: "ORDR01-受注入力.rpgle", lines: 3, modified: 0 },
      { fileName: "CUST10.rpgle", lines: 3, modified: 0 },
      { fileName: "CUST10-顧客.sqlrpgle", lines: 3, modified: 0 },
      { fileName: "1BAD.rpgle", lines: 1, modified: 0 },
      { fileName: ".gitkeep", lines: 0, modified: 0 }
    ]);
    assert.deepEqual(local.members.map(member => [member.name, member.text, member.sourceType, member.fileName]), [
      ["ORDR01", "受注入力", "RPGLE", "ORDR01-受注入力.rpgle"]
    ]);
    assert.deepEqual([...local.problems.keys()].sort(), ["1BAD.rpgle", "CUST10"]);
    assert.match(local.problems.get("CUST10") ?? "", /CUST10\.rpgle、CUST10-顧客\.sqlrpgle/u);
  });

  test("ダウンロードは IBM i が転送元。どちらが新しいかを秒単位で比べる", () => {
    const local = readLocalMembers([
      { fileName: "A.rpgle", lines: 1, modified: at("2026-09-27T10:00:00.900") },
      { fileName: "B.rpgle", lines: 1, modified: at("2026-09-27T09:00:00") },
      { fileName: "C.rpgle", lines: 1, modified: at("2026-09-27T11:00:00") },
      { fileName: "LOCAL.rpgle", lines: 1, modified: 0 }
    ]);
    const rows = buildSyncRows("download", [
      remote("A", "2026-09-27T10:00:00"),
      remote("B", "2026-09-27T10:00:00"),
      remote("C", "2026-09-27T10:00:00"),
      remote("NEW", "2026-09-27T10:00:00")
    ], local);
    assert.deepEqual(rows.map(row => [row.name, row.newer, row.target?.fileName, row.problem]), [
      ["A", "same", "A.rpgle", undefined],
      ["B", "source", "B.rpgle", undefined],
      ["C", "target", "C.rpgle", undefined],
      ["LOCAL", undefined, "LOCAL.rpgle", "転送元にありません。"],
      ["NEW", undefined, undefined, undefined]
    ]);
    assert.deepEqual(rows.filter(isTransferable).map(row => row.name), ["A", "B", "C", "NEW"]);
  });

  test("アップロードはローカルが転送元。IBM i にしか無いものは選べない", () => {
    const local = readLocalMembers([{ fileName: "A-説明.rpgle", lines: 1, modified: at("2026-09-27T11:00:00") }]);
    const rows = buildSyncRows("upload", [remote("A", "2026-09-27T10:00:00"), remote("ONLYIBMI", "2026-09-27T10:00:00")], local);
    assert.deepEqual(rows.map(row => [row.name, row.newer, row.source?.text, row.problem]), [
      ["A", "source", "説明", undefined],
      ["ONLYIBMI", undefined, undefined, "転送元にありません。"]
    ]);
  });

  test("上書きを確認するのは、選んだもののうち転送先の方が新しいものだけ", () => {
    const local = readLocalMembers([
      { fileName: "NEWER.rpgle", lines: 1, modified: at("2026-09-27T12:00:00") },
      { fileName: "OLDER.rpgle", lines: 1, modified: at("2026-09-27T08:00:00") },
      { fileName: "SAME.rpgle", lines: 1, modified: at("2026-09-27T10:00:00") },
      { fileName: "UNSEL.rpgle", lines: 1, modified: at("2026-09-27T12:00:00") }
    ]);
    const rows = buildSyncRows("download", ["NEWER", "OLDER", "SAME", "UNSEL", "ABSENT"].map(name => remote(name, "2026-09-27T10:00:00")), local);
    assert.deepEqual(overwriteConfirmations(rows, ["NEWER", "OLDER", "SAME", "ABSENT"]), ["NEWER"]);
  });
});

suite("一括の送受信: 新しく作るファイルの名前", () => {
  test("メンバー名-テキスト記述.ソース・タイプ小文字", () => {
    assert.equal(downloadFileName({ name: "ORDR01", sourceType: "RPGLE", text: "受注入力" }), "ORDR01-受注入力.rpgle");
  });

  test("記述が空・ファイル名に使えない文字を含む・末尾が . や空白なら記述を付けない（置き換えない）", () => {
    for (const text of ["", "  ", "A/B", "A:B", "何?", "A.", "<x>", "A|B", "A\"B"]) {
      assert.equal(downloadFileName({ name: "M", sourceType: "CLLE", text }), "M.clle", text);
    }
  });

  test("ソース・タイプが空なら .txt", () => {
    assert.equal(downloadFileName({ name: "M", sourceType: "", text: "" }), "M.txt");
  });

  test("作った名前は既存の同期でメンバー名・記述・ソース・タイプに読み戻せる", () => {
    const name = downloadFileName({ name: "ORDR01", sourceType: "SQLRPGLE", text: "受注 - 入力 'A' (改)" });
    const local = readLocalMembers([{ fileName: name, lines: 1, modified: 0 }]);
    assert.deepEqual(local.members.map(member => [member.name, member.text, member.sourceType]), [
      ["ORDR01", "受注 - 入力 'A' (改)", "SQLRPGLE"]
    ]);
  });
});

suite("一括の送受信: 画面に vscode を持ち込んでいない", () => {
  // 型検査でも締め出している（tsconfig.webview.json の types: []）が、実ファイルを機械で見る。
  const dir = join(__dirname, "../../../src/sync/webview");
  const sources = readdirSync(dir).filter(name => name.endsWith(".ts"));

  test("ファイルが揃っている", () => {
    assert.deepEqual(sources.sort(), ["bridge.ts", "css.d.ts", "main.ts", "protocol.ts", "ui.ts"]);
  });

  for (const name of [...sources, "../bulkSync.ts", "../memberTarget.ts"]) {
    test(`${name} は vscode を import しない`, () => {
      const text = readFileSync(join(dir, name), "utf8");
      assert.ok(!/from ["']vscode["']/u.test(text), `${name} が vscode を import している`);
      assert.ok(!/require\(["']vscode["']\)/u.test(text));
    });
  }
});
