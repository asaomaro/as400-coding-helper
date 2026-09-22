import { strict as assert } from "node:assert";
import { failureLocation, parseJUnitXml } from "../../src/testing/resultParser";

suite("RPGUnit result parser", () => {
  test("v4形式（本文が素のCDATAなし）の見出しと件数を読む", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuite errors="0" failures="1" hostname="" id="0" name="ASAOLIB/MSGTST" tests="2" >
    <testcase name="TESTASCII" assertions="0" classname="MSGTST" time="0.001" >
        <failure message="ASCII failure text">
TESTASCII (MSGTST-&gt;MSGTST:500)
        </failure>
    </testcase>
    <testcase name="TESTOK" assertions="1" classname="MSGTST" time="0.000" >
    </testcase>
</testsuite>`;
    const s = parseJUnitXml(xml);
    assert.deepEqual([s.name, s.tests, s.failures, s.errors], ["ASAOLIB/MSGTST", 2, 1, 0]);
    assert.equal(s.cases.length, 2);
    assert.equal(s.cases[0].failure?.message, "ASCII failure text");
    assert.equal(s.cases[0].failure?.detail, "TESTASCII (MSGTST->MSGTST:500)");
    assert.equal(s.cases[1].failure, undefined);
  });

  test("自己終了タグの <testcase .../> も拾う", () => {
    const xml = `<testsuite errors="0" failures="0" name="X" tests="1"><testcase name="A" classname="X" time="0"/></testsuite>`;
    assert.equal(parseJUnitXml(xml).cases.length, 1);
  });

  test("v6形式（CDATA と &apos; エンティティ）を読む", () => {
    const xml = `<testsuite errors="0" failures="1" name="ASAOLIB/V2TST" tests="1">
  <testcase name="TESTNG" assertions="1" classname="V2TST" time="1.29" timeUnit="s">
    <failure message="Expected &apos;2&apos;, but was &apos;3&apos;."><![CDATA[
Callstack:
  TESTNG (V2TST->V2TST:1300)

Expected:
  2,00000000000000000000
]]></failure>
  </testcase>
</testsuite>`;
    const s = parseJUnitXml(xml);
    assert.equal(s.cases[0].failure?.message, "Expected '2', but was '3'.");
    assert.equal(s.cases[0].failure?.detail.startsWith("Callstack:"), true);
    assert.equal(failureLocation(s.cases[0].failure!.detail), "TESTNG (V2TST->V2TST:1300)");
  });

  test("&amp; を最後に戻す（&amp;apos; を壊さない）", () => {
    const xml = `<testsuite errors="0" failures="1" name="X" tests="1">
  <testcase name="A" classname="X">
    <failure message="&amp;apos;"><![CDATA[d]]></failure>
  </testcase>
</testsuite>`;
    assert.equal(parseJUnitXml(xml).cases[0].failure?.message, "&apos;");
  });

  test("errorタグ(failureでなくerror)もkind付きで拾う", () => {
    const xml = `<testsuite errors="1" failures="0" name="X" tests="1">
  <testcase name="A" classname="X">
    <error message="MCH1211"><![CDATA[boom]]></error>
  </testcase>
</testsuite>`;
    const c = parseJUnitXml(xml).cases[0];
    assert.equal(c.failure?.kind, "error");
    assert.equal(c.failure?.detail, "boom");
  });
});
