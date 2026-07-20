import * as vscode from "vscode";
import { CMD_EXTENSIONS, toDocumentSelector } from "../utils/fileScope";
import {
  isContinuedLine,
  joinContinuationLines,
  parseClCommand,
  type ParsedClCommand
} from "../prompter/clCommandParser";
import {
  expandToChildren,
  toDocumentSymbols,
  type LineReader,
  type OutlineKind,
  type OutlineNode,
  type OutlineRange
} from "./outlineTypes";

/**
 * `.cmd`（コマンド定義ソース）のアウトライン。
 *
 * `.cmd` に書くのは CL コマンドではなくコマンド定義ステートメント
 * （CMD / PARM / ELEM / QUAL / DEP / PMTCTL）。解析は CL と同じ経路
 * （`parseClCommand` / 継続行の連結）を通す。
 *
 * **`.cmd` は自由形式**で桁の規定が原典に無い（実機も 1 桁目から書ける）。
 * したがってアウトラインは桁を一切見ず、解析結果だけで組み立てる。
 * `cmd-keyword-columns.json` の `[1, 14, 25]` は SEU の書き方であって構文ではない。
 */

/** 論理行（継続行をまたいだ 1 文）。 */
interface Statement {
  readonly parsed: ParsedClCommand;
  /** ラベル。`Q1:` を単独行に書く形にも対応するため、解析結果とは別に持つ。 */
  readonly label: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly endChar: number;
}

/**
 * ラベルだけの行（`Q1:`）。CL / .cmd で合法な書き方。
 * IBM i の名前は英数字に加えて `$ # @ _` を含められる（`Q_1` `A#1` など）。
 */
const LABEL_ONLY = /^\s*([A-Za-z$#@][A-Za-z0-9$#@_]*)\s*:\s*$/u;

/**
 * ラベル・TYPE 参照の突き合わせ用に正規化する。
 * IBM i の名前は**大小文字を区別しない**ので、`TYPE(q1)` と `Q1:` は同じものを指す。
 * 空白の混入（`TYPE( Q1 )`）も吸収する。
 */
function normalizeLabel(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

/**
 * 論理行に切り出す。継続行（末尾 `+` / `-`）をまたぐ。
 *
 * 行は一度だけ読む。`lineAt` は `document.lineAt(i).text` を呼ぶので、
 * 同じ行を読み直すとアウトライン更新のたびに無駄が積み上がる。
 *
 * **ラベルだけの行は次の文のラベルとして持ち越す**。`parseClCommand("Q1:")` は
 * キーワードが無いので undefined を返し、そのまま捨てるとグループが名前を失う。
 */
function readStatements(lineAt: LineReader, lineCount: number): Statement[] {
  const statements: Statement[] = [];
  let pendingLabel = "";
  let pendingLabelLine = -1;

  let lineIndex = 0;
  while (lineIndex < lineCount) {
    const startLine = lineIndex;
    let text = lineAt(lineIndex);

    const labelOnly = LABEL_ONLY.exec(text);
    if (labelOnly && !isContinuedLine(text)) {
      pendingLabel = labelOnly[1];
      pendingLabelLine = lineIndex;
      lineIndex += 1;
      continue;
    }

    const lines: string[] = [text];
    while (lineIndex + 1 < lineCount && isContinuedLine(text)) {
      lineIndex += 1;
      text = lineAt(lineIndex);
      lines.push(text);
    }

    const parsed = parseClCommand(joinContinuationLines(lines));
    if (parsed?.keyword) {
      // 持ち越したラベルを使うのは、**その直後の行から始まる文**で、かつ
      // その文が自前のラベルを持たないときだけ。
      // 無期限に持ち越すと、間に挟まった別の行がラベルを横取りして
      // 無関係な文に付き、range もラベル行まで引き戻される。
      const inherits =
        pendingLabel !== "" &&
        !parsed.label &&
        pendingLabelLine === startLine - 1;

      statements.push({
        parsed,
        label: normalizeLabel(parsed.label || (inherits ? pendingLabel : "")),
        // ラベル行から続く文のときだけ、その行から始まる文として扱う。
        startLine: inherits ? pendingLabelLine : startLine,
        endLine: lineIndex,
        endChar: text.length
      });
      pendingLabel = "";
      pendingLabelLine = -1;
    }

    lineIndex += 1;
  }

  return statements;
}

/** ELEM / QUAL のまとまり。先頭のラベルが名前になり、TYPE から参照される。 */
interface Group {
  readonly label: string;
  readonly keyword: "ELEM" | "QUAL";
  readonly kind: OutlineKind;
  readonly members: Statement[];
}

function isMemberKeyword(keyword: string): keyword is "ELEM" | "QUAL" {
  return keyword === "ELEM" || keyword === "QUAL";
}

/**
 * ELEM / QUAL のグループを集める。
 *
 * ELEM / QUAL は PARM に字句的にネストせず、**ラベル付きの兄弟文**として書かれ、
 * 参照側が `TYPE(ラベル)` で指す。グループは
 *   開始: ラベルを持つ QUAL / ELEM
 *   継続: 直後に続く**同じキーワードの**ラベルなしの文
 *   終了: 次のラベル付き文、キーワードの変化、または QUAL / ELEM 以外の文
 * で決まる。
 *
 * ELEM と QUAL を交換可能な継続として扱わないこと。ELEM グループの直後の
 * 無ラベル QUAL を取り込むと、QUAL が elem 種別で表示されて嘘の構造になる。
 */
function collectGroups(statements: readonly Statement[]): Group[] {
  const groups: Group[] = [];
  let current: Group | undefined;

  for (const statement of statements) {
    const keyword = statement.parsed.keyword;

    if (!isMemberKeyword(keyword)) {
      current = undefined;
      continue;
    }

    // ラベルが出たら必ず新しいグループを開く。キーワードが変わったときも同じ
    // （ELEM の続きに QUAL は来ない）。
    if (statement.label || !current || current.keyword !== keyword) {
      current = {
        label: statement.label,
        keyword,
        kind: keyword === "ELEM" ? "elem" : "qual",
        members: [statement]
      };
      groups.push(current);
      continue;
    }

    current.members.push(statement);
  }

  return groups;
}

function rangeOf(statement: Statement): OutlineRange {
  return {
    startLine: statement.startLine,
    startChar: 0,
    endLine: statement.endLine,
    endChar: statement.endChar
  };
}

/**
 * 名前の範囲は**論理行の先頭の物理行**とする。必ず range に含まれる。
 * 継続行をまたぐ文でも、飛び地にならない。
 */
function selectionRangeOf(statement: Statement, lineAt: LineReader): OutlineRange {
  const text = lineAt(statement.startLine);
  return {
    startLine: statement.startLine,
    startChar: 0,
    endLine: statement.startLine,
    endChar: text.length
  };
}

/**
 * 文字列リテラルの引用符を外す。`PROMPT('顧客名')` の値は `'顧客名'` で返るので、
 * detail に出すときは引用符を落とす（表示用。値そのものは書き換えない）。
 */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** 値のあるものだけを空白区切りで連結する。引用符は外す。 */
function joinDetail(...parts: (string | undefined)[]): string {
  return parts
    .filter((part): part is string => part !== undefined && part.length > 0)
    .map(unquote)
    .filter(part => part.length > 0)
    .join(" ");
}

/**
 * 空にならない名前を返す。
 *
 * **空文字の name は実機の VSCode が `name must not be falsy` で弾く**。
 * provider が throw するとアウトラインが固まるので、`??` ではなく
 * 「空文字も空とみなす」判定にする（`PARM KWD()` のような編集途中の行で起きる）。
 */
function nameOr(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * `.cmd` のアウトラインを組み立てる。
 *
 * - `CMD` … ルート。名前はファイル名（コマンド名は本文に無く、メンバー名で決まる）
 * - `PARM` … ルートの子。名前は `KWD` の値
 * - `DEP` / `PMTCTL` … **ルートの子**。`DEP CTL(REPLACE) PARM(NAME)` は複数の PARM を
 *   横断的に参照するので、特定の PARM にぶら下げると嘘の階層になる
 * - `QUAL` / `ELEM` … 参照元（PARM または ELEM）の `TYPE(ラベル)` が一致し、かつ
 *   **その直後に書かれている**ときだけ子にする（下記）
 *
 * ## 入れ子にするのは「直後にあるとき」だけ
 *
 * VSCode は子の range が親の range に含まれることを要求する。しかしグループは
 * 参照元と離れた場所に書けるので、離れたグループを子にすると親の range を
 * そこまで伸ばすことになり、**間にある兄弟の PARM を飲み込んでしまう**
 * （カーソル位置から別の PARM が引かれ、パンくずが誤ったパラメータを指す）。
 *
 * 当初は無条件に入れ子にして「包含違反」を作り、次に無条件に range を伸ばして
 * 「兄弟の飲み込み」を作った。両立しないので、**直後に書かれている場合だけ入れ子**にし、
 * 離れているグループはルート直下に出す（参照元の detail に TYPE の値が出るので辿れる）。
 *
 * `CMD` 文が無いソースでも `PARM` 以下をトップレベルに並べて返す。**例外は投げない**。
 *
 * @param commandName ルートに使う名前（拡張子を除いたファイル名を想定）
 */
export function buildCmdOutline(
  lineAt: LineReader,
  lineCount: number,
  commandName: string
): OutlineNode[] {
  const statements = readStatements(lineAt, lineCount);
  const groups = collectGroups(statements);

  /** ラベル → グループ。同じラベルが 2 度定義されていたら先勝ち。 */
  const byLabel = new Map<string, Group>();
  for (const group of groups) {
    if (group.label && !byLabel.has(group.label)) {
      byLabel.set(group.label, group);
    }
  }

  /** 子として取り込んだグループ。残りはルート直下に出す。 */
  const claimed = new Set<Group>();

  /**
   * 文が参照するグループのうち、**直後に書かれているもの**を返す。
   * 離れているものは入れ子にしない（上記の理由）。
   */
  const adjacentGroupOf = (
    statement: Statement,
    /** 参照元がグループの要素である場合、そのグループ（自己参照の打ち切り用）。 */
    owningGroup?: Group
  ): Group | undefined => {
    const type = normalizeLabel(statement.parsed.parameters.TYPE);
    if (!type) return undefined;

    const group = byLabel.get(type);
    if (!group || claimed.has(group) || group === owningGroup) return undefined;

    const first = group.members[0];
    if (!first) return undefined;

    // **参照元の文の直後にあるときだけ**入れ子にする。
    // 「参照元が属するグループの直後」まで許すと、要素リストの途中の要素が
    // リスト末尾の後ろにあるグループを引き取り、間の兄弟の要素を飲み込む
    // （実際にそうなった: `E1: ELEM TYPE(Q1)` が L2-5 に伸びて L3 の兄弟を覆った）。
    return first.startLine === statement.endLine + 1 ? group : undefined;
  };

  /** グループの要素をノードにする。要素がさらにグループを参照することがある。 */
  const memberNode = (statement: Statement, group: Group): OutlineNode => {
    const parameters = statement.parsed.parameters;
    const node: OutlineNode = {
      // 名前は TYPE の値（`*NAME` / `*DEC`）。表示は原文のまま（突き合わせだけ正規化する）。
      name: nameOr(parameters.TYPE, statement.parsed.keyword),
      detail: joinDetail(parameters.LEN, parameters.PROMPT),
      kind: group.kind,
      range: rangeOf(statement),
      selectionRange: selectionRangeOf(statement, lineAt),
      children: []
    };

    // 要素リストの要素がさらに修飾名になっている形
    // （AGENTS.md が名指しする CHGPRTF の USRDFNOBJ）。
    const nested = adjacentGroupOf(statement, group);
    if (nested) {
      claimed.add(nested);
      node.children.push(...nested.members.map(member => memberNode(member, nested)));
    }
    return node;
  };

  const topLevel: OutlineNode[] = [];
  let root: OutlineNode | undefined;

  const push = (node: OutlineNode): void => {
    if (root) {
      root.children.push(node);
    } else {
      topLevel.push(node);
    }
  };

  for (const statement of statements) {
    const { keyword, parameters } = statement.parsed;

    if (keyword === "CMD") {
      // CMD が複数あるソース（貼り間違い・マージ事故）でも、2 つ目が 1 つ目を
      // 取り込まないようにする。**兄弟として並べる**。
      root = {
        name: nameOr(commandName, "CMD"),
        detail: joinDetail(parameters.PROMPT),
        kind: "command",
        range: rangeOf(statement),
        selectionRange: selectionRangeOf(statement, lineAt),
        children: []
      };
      topLevel.push(root);
      continue;
    }

    if (keyword === "PARM") {
      const node: OutlineNode = {
        name: nameOr(parameters.KWD, "PARM"),
        detail: joinDetail(parameters.TYPE, parameters.PROMPT),
        kind: "parm",
        range: rangeOf(statement),
        selectionRange: selectionRangeOf(statement, lineAt),
        children: []
      };

      const group = adjacentGroupOf(statement);
      if (group) {
        claimed.add(group);
        node.children.push(...group.members.map(member => memberNode(member, group)));
      }

      push(node);
      continue;
    }

    if (keyword === "DEP" || keyword === "PMTCTL") {
      push({
        name: keyword,
        detail: joinDetail(parameters.CTL),
        kind: keyword === "DEP" ? "dep" : "pmtctl",
        range: rangeOf(statement),
        selectionRange: selectionRangeOf(statement, lineAt),
        children: []
      });
      continue;
    }

    // ELEM / QUAL はグループとして扱うのでここでは出さない。
    // それ以外の未知の文も、構造が分からないので出さない。
  }

  // 引き取られなかったグループは、**その位置を含むコマンド**の直下に出す
  // （隠すと情報が消えるため）。常に「最後の CMD」に付けると、CMD が 2 つある
  // ソースで 2 つ目の range が 1 つ目まで前方に広がり、兄弟が重なる。
  const rootsInOrder = topLevel.filter(node => node.kind === "command");
  const ownerOf = (line: number): OutlineNode | undefined => {
    let owner: OutlineNode | undefined;
    for (const candidate of rootsInOrder) {
      if (candidate.range.startLine <= line) {
        owner = candidate;
      }
    }
    return owner;
  };

  for (const group of groups) {
    if (claimed.has(group)) continue;

    const first = group.members[0];
    if (!first) continue;

    const owner = ownerOf(first.startLine);
    const place = (node: OutlineNode): void => {
      if (owner) {
        owner.children.push(node);
      } else {
        topLevel.push(node);
      }
    };

    place({
      name: nameOr(group.label, group.keyword),
      detail: "",
      kind: group.kind,
      range: rangeOf(first),
      selectionRange: selectionRangeOf(first, lineAt),
      children: group.members.map(member => memberNode(member, group))
    });
  }

  // 親の range が子を覆うようにする（VSCode の containment 要件）。
  // 入れ子にするのは直後のグループだけなので、兄弟を飛び越えて広がることはない。
  return topLevel.map(expandToChildren);
}

/** ファイル名から拡張子を除き、大文字にする（`ADDCUST.cmd` → `ADDCUST`）。 */
export function commandNameFromPath(fsPath: string): string {
  const base = fsPath.split(/[\\/]/u).pop() ?? fsPath;
  const stem = base.replace(/\.[^.]*$/u, "").toUpperCase();
  // `.cmd` のように名前が空になるファイルでも空文字を返さない
  // （空の name は実機の VSCode が弾く）。
  return stem.length > 0 ? stem : base.toUpperCase();
}

/**
 * `.cmd` 用の DocumentSymbolProvider を登録する。
 *
 * `.cmd` は言語登録していない（拡張子で判定する方針）ため scheme+pattern で絞る。
 */
export function registerCmdSymbols(): vscode.Disposable {
  const provider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(document) {
      const nodes = buildCmdOutline(
        index => document.lineAt(index).text,
        document.lineCount,
        commandNameFromPath(document.uri.fsPath)
      );
      return toDocumentSymbols(nodes);
    }
  };

  return vscode.languages.registerDocumentSymbolProvider(
    toDocumentSelector(CMD_EXTENSIONS),
    provider
  );
}
