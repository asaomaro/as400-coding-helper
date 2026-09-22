/**
 * RPGUnit（iRPGUnit）が出す JUnit 形式 XML（v4/v6 両対応）を解析する。
 * `tools/run-rpgunit.mjs` の `summarize` の移植（接続層に依存しない純粋ロジック）。
 */

export interface TestCaseFailure {
  readonly kind: "failure" | "error";
  readonly message: string;
  readonly detail: string;
}

export interface TestCaseResult {
  readonly name: string;
  readonly classname: string;
  readonly failure?: TestCaseFailure;
}

export interface TestSuiteResult {
  readonly name: string;
  readonly tests: number;
  readonly failures: number;
  readonly errors: number;
  readonly cases: readonly TestCaseResult[];
}

/** v6 は本文を CDATA で包む（v4 は素）。両方を読めるようにする。 */
function stripCdata(text: string): string {
  const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(text);
  return m ? m[1] : text;
}

/** `&amp;` は最後に戻す（先に戻すと `&amp;apos;` が壊れる）。 */
function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function attr(source: string, key: string): string {
  const m = new RegExp(`\\b${key}="([^"]*)"`).exec(source);
  return m ? m[1] : "";
}

function numAttr(source: string, key: string): number {
  return Number(attr(source, key) || 0);
}

/** 実機が出した XML をそのまま読む。件数と失敗の内訳を取り出す。 */
export function parseJUnitXml(xml: string): TestSuiteResult {
  const suite = /<testsuite\b([^>]*)>/.exec(xml);
  const head = suite?.[1] ?? "";

  const cases: TestCaseResult[] = [];
  const caseRe = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m: RegExpExecArray | null;
  while ((m = caseRe.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[3] ?? "";
    const failureMatch = /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>/.exec(body);
    const failure: TestCaseFailure | undefined = failureMatch
      ? {
          kind: failureMatch[1] as "failure" | "error",
          message: unescapeXml(attr(failureMatch[2], "message")),
          detail: unescapeXml(stripCdata(failureMatch[3])).trim()
        }
      : undefined;
    cases.push({
      name: attr(attrs, "name"),
      classname: attr(attrs, "classname"),
      ...(failure ? { failure } : {})
    });
  }

  return {
    name: attr(head, "name"),
    tests: numAttr(head, "tests"),
    failures: numAttr(head, "failures"),
    errors: numAttr(head, "errors"),
    cases
  };
}

/** 失敗した場所（`NAME (PGM->MODULE:NNN)`）を本文から拾う。無ければ先頭行。 */
export function failureLocation(detail: string): string {
  const m = /^\s*(\S+\s+\([^)]*:\d+\))\s*$/m.exec(detail);
  if (m) {
    return m[1];
  }
  const firstNonEmpty = detail.split("\n").find(line => line.trim());
  return (firstNonEmpty ?? "").trim();
}
