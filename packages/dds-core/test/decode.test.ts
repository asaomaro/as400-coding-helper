import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeSource } from "../src/text/decode.js";
import { parseBytes } from "../src/dds/parse.js";

const FIXTURES = join(__dirname, "..", "..", "test", "fixtures");

describe("エンコーディング判定（AC10）", () => {
  test("純 ASCII は UTF-8 と判定される", () => {
    const bytes = new Uint8Array(Buffer.from("     A          R REC1\n", "utf8"));
    const result = decodeSource(bytes);
    assert.equal(result.encoding, "utf8");
    assert.equal(result.bom, false);
    assert.equal(result.warning, undefined);
  });

  test("UTF-8 の日本語は UTF-8 と判定される", () => {
    const bytes = new Uint8Array(
      readFileSync(join(FIXTURES, "dbcs-const.dspf"))
    );
    const result = decodeSource(bytes);
    assert.equal(result.encoding, "utf8");
    assert.ok(result.text.includes("社員マスタ保守"));
  });

  test("Shift_JIS の日本語は Shift_JIS と判定される", () => {
    const bytes = new Uint8Array(
      readFileSync(join(FIXTURES, "dbcs-const.sjis.dspf"))
    );
    const result = decodeSource(bytes);
    assert.equal(result.encoding, "shift_jis");
    assert.ok(result.text.includes("社員マスタ保守"));
  });

  test("UTF-8 BOM があれば取り除いて UTF-8 と判定する", () => {
    const bytes = new Uint8Array(
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("     A          R REC1\n", "utf8")
      ])
    );
    const result = decodeSource(bytes);
    assert.equal(result.encoding, "utf8");
    assert.equal(result.bom, true);
    assert.ok(!result.text.startsWith("﻿"), "BOM が本文に残っている");
  });

  test("どちらでも解釈できないバイト列には警告が付く（黙って化けさせない）", () => {
    // 0x81 の後に ASCII 未満の継続バイトが無い並び。UTF-8 でも Shift_JIS でも不正。
    const bytes = new Uint8Array([0x41, 0x81, 0x20, 0xff, 0xfe, 0x0a]);
    const result = decodeSource(bytes);
    assert.ok(result.warning, "警告が返っていない");
    assert.ok(result.warning!.includes("Shift_JIS"));
  });
});

describe("同一内容の UTF-8 版と Shift_JIS 版（AC10）", () => {
  const utf8 = new Uint8Array(readFileSync(join(FIXTURES, "dbcs-const.dspf")));
  const sjis = new Uint8Array(
    readFileSync(join(FIXTURES, "dbcs-const.sjis.dspf"))
  );

  test("バイト長は違う（同一ファイルではないことの確認）", () => {
    assert.notEqual(utf8.length, sjis.length);
  });

  test("同一のモデルが得られる（encoding 以外）", () => {
    const a = parseBytes(utf8).doc;
    const b = parseBytes(sjis).doc;

    assert.equal(a.encoding, "utf8");
    assert.equal(b.encoding, "shift_jis");

    // encoding 以外はすべて一致するはず。
    assert.deepEqual(
      { ...a, encoding: null },
      { ...b, encoding: null },
      "UTF-8 版と Shift_JIS 版でモデルが違う"
    );
  });

  test("定数の内容も一致する", () => {
    const textsOf = (bytes: Uint8Array): string[] =>
      parseBytes(bytes)
        .doc.lines.filter(l => l.kind === "item")
        .map(l => (l.kind === "item" ? l.item.text ?? "" : ""))
        .filter(t => t !== "");

    assert.deepEqual(textsOf(utf8), textsOf(sjis));
    assert.ok(textsOf(utf8).includes("社員マスタ保守"));
  });
});

describe("BOM 付きでも中身の妥当性は別に検査する（review should-1）", () => {
  test("BOM 付きで本文が壊れていれば警告が出る", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0x81, 0xff, 0x0a]);
    const result = decodeSource(bytes);
    assert.equal(result.encoding, "utf8");
    assert.equal(result.bom, true);
    assert.ok(result.warning, "BOM 付きだと警告が出ていない");
  });

  test("BOM の有無で警告の有無が変わらない", () => {
    const broken = [0x41, 0x81, 0xff, 0x0a];
    const withBom = decodeSource(new Uint8Array([0xef, 0xbb, 0xbf, ...broken]));
    const withoutBom = decodeSource(new Uint8Array(broken));
    assert.equal(Boolean(withBom.warning), Boolean(withoutBom.warning));
  });

  test("BOM 付きで本文が正常なら警告は出ない", () => {
    const bytes = new Uint8Array(
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("     A          R REC1\n", "utf8")
      ])
    );
    assert.equal(decodeSource(bytes).warning, undefined);
  });
});
