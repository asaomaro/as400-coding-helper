import {
  DDS_COLUMNS,
  ddsField,
  ddsReplaceField,
  isDdsBlankLine,
  isDdsCommentLine
} from "../ddsLayout";
import {
  buildAlternatePositionLine,
  buildItemLine,
  writeBackAttributes,
  buildKeywordLine,
  foldKeywordArea,
  writeBackKeywordArea,
  writeBackLength,
  type ItemAttributePatch,
  type NewDspfItem
} from "./ddsEditWriteBack";
import {
  keywordAreaOf,
  readConstant,
  readNumber,
  replaceLeadingConstant,
  startsContinuation,
  joinContinuations,
  toLogicalUnits,
  unitItemKind,
  unitRunEnd,
  fileLevelKeywordLines,
  type AlternatePosition,
  type FileKeywordLine,
  type LogicalUnit,
  type RawKeywordGroup
} from "./ddsLogicalUnits";
import {
  CONDITION_LIMITS,
  writeBackCondition,
  writeBackScreenSizeCondition,
  type ConditionGroups
} from "./ddsConditionWriteBack";
import {
  conditionNameFor,
  isScreenSizeConditionName,
  resolveScreenSizes
} from "./dspfScreenSize";
import { findAlternatePosition } from "./ddsConditioning";
import { renameFieldReferences, renameRecordReferences } from "./ddsReferences";
import { COLUMN_ONE_MESSAGE, isRowOneColumnOne } from "./dspfLayout";
import { DDS_POSITION_ROW } from "./ddsPositionColumns";
import { writeBackColumn, writeBackPosition } from "./ddsPositionWriteBack";

/**
 * DDS ソースへの編集操作。**vscode を import しない**（行の配列 → 置き換え指示）。
 *
 * ## 判定は持たない
 *
 * ここが見るのは「**ソースに書けるか**」だけ。重なり・はみ出し・1 桁目の予約といった
 * 規則違反は `dspfLayout` が診断として返すもので、**編集は止めない**。
 * 既存の移動が無検証で適用される（`dspfPreview.ts`）のと同じ扱いにしてある——
 * 直すために動かしたい項目が、違反を理由に凍るのを避けるため。
 *
 * ## 戻り値は「旧行のどの範囲を、どの行で置き換えるか」
 *
 * 適用後の全文を返さないのは、**座標の取り違えを起こしようがなくする**ため。
 * 「適用後テキスト＋変更範囲」を返す設計は、その範囲を旧文書の座標として使った時点で
 * 行数が変わる操作（追加・削除）で壊れる（実際に踏んだ事例が
 * `.aidev/works/20260825-dds-visual-editor/07-editor-webview/review.md` の must-1）。
 *
 * ## 削除は論理単位ごと
 *
 * DDS の項目は 1 行とは限らない。キーワード継続行は直前に付き、条件付けの行は次に付く
 * （`ddsLogicalUnits`）。代表行だけ消すと**継続行が孤児として残る**。
 * 注記行・空行はどの単位にも属さないので消さない——結果として範囲は連続とは限らず、
 * だから戻り値は**配列**になっている。
 */

/**
 * 編集できる DDS の種別。
 *
 * **`DDS-PF` は入らない。** 物理/論理ファイルには配置の概念が無く、編集の対象になりえない
 * ——受け取れる形にすると「PF を編集しようとしたらどうなるか」を考え続けることになる。
 */
export type EditableDdsType = "DDS-DSPF" | "DDS-PRTF";

export type DdsEdit =
  | {
      readonly kind: "move";
      readonly sourceLine: number;
      readonly row: number;
      readonly column: number;
      /**
       * どちらの画面サイズの位置を動かすか。**省略時は 1 次**（いままでと同じ）。
       *
       * `"secondary"` のとき、書き込む先は項目の行ではなく**位置の上書き行**になる
       * （無ければ作る）。項目の行を書き換えると 1 次の位置が黙って変わる。
       *
       * 値は `DspfLayoutOptions.screenSize` と**同じ語**。絵を解く側と編集する側で
       * 言葉が違うと、UI が変換を持つことになる。
       */
      readonly screenSize?: "primary" | "secondary";
    }
  /**
   * **桁だけ**動かす（帳票）。
   *
   * 実務の PRTF は位置欄に行番号を書かず、行は `SPACE` / `SKIP` で決まる。
   * `move` は行も書き込むので使えない——書き込むと行送りが**無効になる**。
   */
  | { readonly kind: "moveColumn"; readonly sourceLine: number; readonly column: number }
  | { readonly kind: "resize"; readonly sourceLine: number; readonly length: number }
  | { readonly kind: "remove"; readonly sourceLine: number }
  /**
   * 項目の中身を変える。**与えた欄だけ**に触る。
   *
   * 欄ごとに操作を分けないのは、プロパティが「複数欄を直して 1 回確定する」使い方をするため。
   * 分けると 1 回の確定が N 個のパッチになり、**途中で 1 つ拒否されたときの状態が説明できない**。
   */
  | {
      readonly kind: "setAttributes";
      readonly sourceLine: number;
      readonly attributes: ItemAttributePatch & { readonly text?: string };
    }
  /**
   * キーワード欄（45-80 桁）を**まるごと**置き換える。
   *
   * 与えるのは**結合後のテキスト**（`OutlineItem.attributes.keywords` と同じ形）。
   * 36 桁に収まらなければ `foldKeywordArea` が折るので、呼び出し側は桁を数えない。
   *
   * `setAttributes` と分けているのは**宛先が違う**ため——あちらは代表行 1 本、
   * こちらは代表行から続くキーワード行の**区間**を置き換える。
   */
  | { readonly kind: "setKeywords"; readonly sourceLine: number; readonly keywords: string }
  /**
   * 条件標識（7-16 桁）を**まるごと**置き換える。
   *
   * 与えるのは OR で結ばれる AND の組（`ConditionGroups`）。**空なら条件を消す。**
   * 原典より項目は「最後の (または唯一の) 標識と同じ行」に置くので、
   * OR や 4 つ以上の AND では**行が増える**——宛先は代表行だけでなく、
   * 先行する条件行を含む**区間**になる。
   */
  | {
      readonly kind: "setCondition";
      readonly sourceLine: number;
      readonly condition: ConditionGroups;
      /**
       * **画面サイズ条件名**（`*DS3` 等）を書くとき。標識とは**別の欄の使い方**で、
       * AND も OR もしないので `condition` とは**同時に指定できない**（検証で弾く）。
       *
       * `move.screenSize`（`"primary" | "secondary"`）と**別物**。
       * こちらは欄に書く**名前そのもの**なので `Name` を付けて分けてある。
       */
      readonly screenSizeName?: string;
    }
  /**
   * **キーワード行**の条件標識を置き換える（`30 DSPATR(RI)` の `30`）。
   *
   * `setCondition` と宛先が違う。あちらは項目そのもの（項目が出るかどうか）、
   * こちらは**そのキーワードが効くかどうか**——原典は条件が付く対象を
   * 「フィールド**または**キーワード」としている。
   *
   * `sourceLine` は**キーワードが書かれている行**（`KeywordGroup.sourceLine`）。
   */
  | {
      readonly kind: "setKeywordCondition";
      readonly sourceLine: number;
      readonly condition: ConditionGroups;
      /** 画面サイズ条件名（`move.screenSize` と別物）。`condition` とは同時に指定できない。 */
      readonly screenSizeName?: string;
    }
  /**
   * 位置の上書き行を**消す**（2 次でも 1 次と同じ位置に出るようにする）。
   *
   * `remove` に画面サイズを足す形は採らない。**`remove` は「項目を消す」**で、
   * 同じ語が 2 次では「上書き行だけ消す」に化けると、押した人の予想と食い違う。
   *
   * `sourceLine` は**項目の代表行**（上書き行ではない）。
   */
  | { readonly kind: "clearAlternatePosition"; readonly sourceLine: number }
  /**
   * **様式（レコード）の名前**を変える。指している参照も一緒に直す。
   *
   * `setAttributes` を広げる形は採らない。あちらは長さ・型・用途・定数の文字列を
   * 受け取れるが、様式にはどれも無い——受け取れる形にすると
   * 「様式に長さを送ったらどうなるか」を考え続けることになる。
   * 追う参照も別（項目は `&名前` / `CSRLOC`、様式は `SFLCTL` / `ERASE` …）。
   */
  | { readonly kind: "renameRecord"; readonly sourceLine: number; readonly name: string }
  | { readonly kind: "add"; readonly recordName: string; readonly item: NewDspfItem };

/** 置き換え指示。0 始まり・`replaceTo` は含まない。 */
export interface DdsEditResult {
  readonly replaceFrom: number;
  readonly replaceTo: number;
  /** 置き換え後の行。**空配列なら削除**。`replaceFrom === replaceTo` なら挿入。 */
  readonly lines: readonly string[];
}

/** 適用できない理由。**「ソースに書けない」ものだけ**が並ぶ。 */
export type DdsEditRejectionCode =
  | "line-not-found"
  | "length-out-of-range"
  | "position-out-of-range"
  | "record-not-found"
  | "constant-has-length"
  | "field-needs-name"
  | "name-too-long"
  | "decimals-out-of-range"
  | "field-column-on-constant"
  | "text-on-field"
  | "invalid-column-value"
  | "line-too-long"
  /** 定数の欄がリテラルで始まらなくなる（項目として認識されなくなる）。 */
  | "constant-needs-literal"
  /** 項目のキーワード行の間に注記行が挟まっている（区間で置き換えると注記が消える）。 */
  | "keyword-lines-not-contiguous"
  /**
   * 行が**行送り**（`SPACE` / `SKIP`）で決まっている項目の行を変えようとした（PRTF）。
   *
   * 位置欄に行番号を書き込むと `SPACE` / `SKIP` は**無効になる**——原典の規定で、
   * `prtfLayout` も `spacing-with-line-number` として診断している。
   * 行を動かしたいなら `SPACEA` / `SKIPB` を直す話で、位置欄の書き換えではない。
   * **桁だけを変える移動は通す。**
   */
  | "row-from-spacing"
  /** 標識が 01-99 でない。 */
  | "condition-indicator-invalid"
  /** 1 つの条件に 10 個以上の標識、または 10 個以上の条件（原典の上限は 9 と 9）。 */
  | "condition-too-many"
  /** 条件行と代表行の間に注記行が挟まっている（区間で置き換えると注記が消える）。 */
  | "condition-lines-not-contiguous"
  /** 指定した行にキーワード行が無い（`setKeywordCondition` の宛先が見つからない）。 */
  | "keyword-line-not-found"
  /** 画面サイズ条件名が原典の形（2-8 文字・先頭 `*`）でない、または標識と混ざっている。 */
  | "screen-size-name-invalid"
  /**
   * 1 行 1 桁に置こうとした（**表示装置ファイルだけ**）。
   *
   * 名前は `resolveDspfLayout` の診断コードと**そろえてある**——同じ規則なので、
   * 別の名前にすると「同じことを 2 つの名前で言っている」状態になる。
   *
   * **これは書き方の好みではなく、実機がコンパイルを通さない形**（`CPF7311`）。
   * 重なり・はみ出しは実機が通すので拒否しない（直すために動かせる必要がある）。
   */
  | "column-one-reserved"
  /**
   * 2 次画面サイズの位置を動かそうとしたが、`DSPSIZ` に 2 次が宣言されていない。
   *
   * 上書き行の条件付け欄には**その 2 次を指す名前**しか書けない
   * （`20260828-dds-undeclared-screen-size` で確認済み）。宣言が無ければ書く名前が無い。
   */
  | "screen-size-not-declared"
  /**
   * 2 次画面サイズの位置を**帳票**で動かそうとした。
   *
   * `DSPSIZ` は表示装置ファイルのキーワードで、帳票に 2 次画面サイズは無い。
   */
  | "screen-size-not-editable"
  /** 消そうとした位置の上書き行が無い（`clearAlternatePosition` の宛先）。 */
  | "alternate-position-not-found"
  /** 指定した行に様式（`R XXXX`）が無い。 */
  | "record-line-not-found"
  /** 様式には名前が必要（空にできない）。 */
  | "record-needs-name"
  /**
   * その名前の様式が既にある。
   *
   * **実機が通さない**（同じ名前の様式を 2 つ置くとコンパイルできない。IBM i 7.3。
   * `.aidev/works/20260828-dds-record-rename/verify/probe-record-names.mjs` の N1）。
   */
  | "record-name-duplicate";

export interface DdsEditRejection {
  readonly code: DdsEditRejectionCode;
  readonly message: string;
  /** 1 始まり。宛先が行に紐づかない操作では undefined。 */
  readonly sourceLine?: number;
}

const LENGTH_WIDTH = DDS_COLUMNS.length[1] - DDS_COLUMNS.length[0] + 1;
const NAME_WIDTH = DDS_COLUMNS.name[1] - DDS_COLUMNS.name[0] + 1;
const DECIMALS_WIDTH = DDS_COLUMNS.decimals[1] - DDS_COLUMNS.decimals[0] + 1;
/**
 * 行の上限。lint の `line-length` と同じ 100 桁にそろえる。
 *
 * 原典は「仕様書の注記以外は 7-80 桁」としつつ、**81-100 桁の目盛りを持つ**ので
 * 80 では切らない（`src/lint/rules/lineLength.ts`）。判定を 2 か所に持たないため同じ値を使う。
 */
const MAX_LINE_COLUMNS = 100;
/** 位置欄は行・桁とも 3 桁ずつ。 */
const POSITION_WIDTH = 3;

/**
 * 事前検証。**何も書かない。**
 *
 * 空配列なら適用できる。`applyDdsEdits` は同じ検査を通してから適用する。
 */
export function validateDdsEdits(
  lines: readonly string[],
  edits: readonly DdsEdit[],
  ddsType: EditableDdsType
): readonly DdsEditRejection[] {
  const units = toLogicalUnits(lines);
  const rejections: DdsEditRejection[] = [];

  for (const edit of edits) {
    if (edit.kind === "add") {
      rejections.push(...validateAdd(units, edit.recordName, edit.item, ddsType));
      continue;
    }

    if (edit.kind === "setKeywordCondition") {
      const group = keywordGroupAt(units, edit.sourceLine);
      if (!group) {
        rejections.push({
          code: "keyword-line-not-found",
          message:
            `${edit.sourceLine} 行目にキーワードの行がありません` +
            "（ソースが変わっている可能性があります）",
          sourceLine: edit.sourceLine
        });
        continue;
      }
      rejections.push(
        ...validateConditionShape(edit.condition, edit.sourceLine, edit.screenSizeName)
      );
      if (!contiguous(group.sourceLines)) {
        rejections.push({
          code: "condition-lines-not-contiguous",
          message:
            "条件の行とキーワードの行の間に注記行が挟まっています" +
            "（まとめて置き換えると注記が消えるため書き換えません）",
          sourceLine: edit.sourceLine
        });
      }
      continue;
    }

    // キーワードの編集は**様式も、ファイル・レベルの行も対象**。
    // `OVERLAY` / `CFnn` は様式にしか、`DSPSIZ` / `REF` はファイル・レベルにしか書けない。
    if (edit.kind === "setKeywords") {
      const fileLevel = fileLevelAt(lines, edit.sourceLine);
      if (fileLevel !== undefined) {
        if (!contiguous(fileLevel.sourceLines)) {
          rejections.push({
            code: "keyword-lines-not-contiguous",
            message:
              "キーワードの行の間に注記行が挟まっています" +
              "（まとめて置き換えると注記が消えるため書き換えません）",
            sourceLine: edit.sourceLine
          });
        }
        continue;
      }
    }

    // **様式の改名は宛先が様式**。`itemUnitAt` では引けないので先に処理する。
    if (edit.kind === "renameRecord") {
      rejections.push(...validateRecordRename(units, edit.sourceLine, edit.name));
      continue;
    }

    const unit =
      edit.kind === "setKeywords"
        ? unitAt(units, edit.sourceLine)
        : itemUnitAt(units, edit.sourceLine);
    if (!unit) {
      rejections.push({
        code: "line-not-found",
        message: `${edit.sourceLine} 行目に編集できる項目がありません（ソースが変わっている可能性があります）`,
        sourceLine: edit.sourceLine
      });
      continue;
    }

    if (edit.kind === "setCondition") {
      rejections.push(
        ...validateCondition(unit, edit.condition, edit.sourceLine, edit.screenSizeName)
      );
      continue;
    }

    if (edit.kind === "move") {
      rejections.push(...validatePosition(edit.row, edit.column, edit.sourceLine));
      rejections.push(...validateColumnOne(edit.row, edit.column, ddsType, edit.sourceLine));
      if (edit.screenSize === "secondary") {
        // **上書き行に書く。** 行送りの検査は要らない（`SPACE`/`SKIP` は帳票のもので、
        // 帳票はこの下で丸ごと弾かれる）。
        rejections.push(...validateSecondary(lines, ddsType, edit.sourceLine));
      } else {
        rejections.push(...validateRowMove(unit, ddsType, edit.sourceLine));
      }
    }

    if (edit.kind === "clearAlternatePosition") {
      rejections.push(...validateSecondary(lines, ddsType, edit.sourceLine));
      if (alternateFor(lines, unit) === undefined) {
        rejections.push({
          code: "alternate-position-not-found",
          message:
            `${edit.sourceLine} 行目の項目に位置の上書き行がありません` +
            "（2 次画面サイズでも 1 次と同じ位置に出ます）",
          sourceLine: edit.sourceLine
        });
      }
    }

    if (edit.kind === "moveColumn") {
      // 行は触らないので見ない。
      rejections.push(...validatePosition(undefined, edit.column, edit.sourceLine));
      // 行は変えないので、**いまの行**と突き合わせる。
      rejections.push(
        ...validateColumnOne(
          readNumber(ddsField(unit.line, DDS_POSITION_ROW)) ?? 0,
          edit.column,
          ddsType,
          edit.sourceLine
        )
      );
    }

    if (edit.kind === "setAttributes") {
      rejections.push(...validateAttributes(lines, unit, edit.attributes, edit.sourceLine));
    }

    if (edit.kind === "setKeywords") {
      rejections.push(...validateKeywords(unit, edit.keywords, edit.sourceLine));
    }

    if (edit.kind === "resize") {
      if (unitItemKind(unit) === "constant") {
        rejections.push({
          code: "constant-has-length",
          message: "固定情報（定数）には桁数を指定できません",
          sourceLine: edit.sourceLine
        });
      } else if (!fitsInColumn(edit.length, LENGTH_WIDTH) || edit.length < 1) {
        rejections.push({
          code: "length-out-of-range",
          message: `長さ ${edit.length} は桁数欄（${LENGTH_WIDTH} 桁）に書けません`,
          sourceLine: edit.sourceLine
        });
      }
    }
  }

  return rejections;
}

/**
 * 適用する。**1 つでも書けない操作があれば空配列を返し、何も適用しない。**
 *
 * 返る指示は**行番号の降順**。先頭から順に適用しても、後続の指示の行番号がずれない。
 */
export function applyDdsEdits(
  lines: readonly string[],
  edits: readonly DdsEdit[],
  ddsType: EditableDdsType
): readonly DdsEditResult[] {
  if (validateDdsEdits(lines, edits, ddsType).length > 0) {
    return [];
  }

  const units = toLogicalUnits(lines);
  const results: DdsEditResult[] = [];

  for (const edit of edits) {
    switch (edit.kind) {
      case "moveColumn": {
        const unit = itemUnitAt(units, edit.sourceLine);
        if (!unit) break;
        const index = edit.sourceLine - 1;
        // **行欄には触らない。** 行送りで決まる行を書き換えないため。
        results.push({
          replaceFrom: index,
          replaceTo: index + 1,
          lines: [writeBackColumn(lines[index], edit.column)]
        });
        break;
      }
      case "move":
      case "resize": {
        const unit = itemUnitAt(units, edit.sourceLine);
        if (!unit) break; // 検証済みなので通常は起きない。

        // **2 次は宛先が違う。** 項目の行を書き換えると 1 次の位置が黙って変わる。
        if (edit.kind === "move" && edit.screenSize === "secondary") {
          results.push(...moveSecondary(lines, unit, edit.row, edit.column));
          break;
        }

        const index = edit.sourceLine - 1;
        const rewritten =
          edit.kind === "move"
            ? writeBackPosition({ line: lines[index], row: edit.row, column: edit.column })
            : writeBackLength(lines[index], edit.length);
        results.push({ replaceFrom: index, replaceTo: index + 1, lines: [rewritten] });
        break;
      }
      case "renameRecord": {
        const unit = units.find(
          candidate => candidate.kind === "record" && candidate.sourceLine === edit.sourceLine
        );
        if (!unit) break; // 検証済み。
        const index = edit.sourceLine - 1;
        results.push({
          replaceFrom: index,
          replaceTo: index + 1,
          lines: [ddsReplaceField(lines[index], DDS_COLUMNS.name, edit.name.trim().toUpperCase()).trimEnd()]
        });
        results.push(
          ...renameReferenceResults(
            lines,
            ddsName(unit.line),
            edit.name,
            edit.sourceLine,
            renameRecordReferences
          )
        );
        break;
      }
      case "clearAlternatePosition": {
        const unit = itemUnitAt(units, edit.sourceLine);
        if (!unit) break;
        const alternate = alternateFor(lines, unit);
        if (!alternate) break; // 検証済み。
        const index = alternate.sourceLine - 1;
        results.push({ replaceFrom: index, replaceTo: index + 1, lines: [] });
        break;
      }
      case "setAttributes": {
        const unit = itemUnitAt(units, edit.sourceLine);
        if (!unit) break;
        const index = edit.sourceLine - 1;

        // 継続にまたがるリテラルは、代表行だけでは差し替えられない。
        // **欄全体を作り直して折る**（区間の置き換えになる）。
        if (edit.attributes.text !== undefined && startsContinuation(unit.line)) {
          const run = keywordRunOf(unit);
          const replaced = replaceLeadingConstant(unit.keywords, edit.attributes.text);
          if (run && replaced !== undefined) {
            const head = writeBackAttributes(lines[index], edit.attributes);
            results.push({
              replaceFrom: run.from,
              replaceTo: run.to,
              lines: keywordLines(head, replaced)
            });
            break;
          }
        }

        results.push({
          replaceFrom: index,
          replaceTo: index + 1,
          lines: [applyAttributes(lines[index], edit.attributes)]
        });

        // **名前を変えたら、それを指しているキーワードも直す。**
        // 参照は**別の行**にあるので、同じ確定の中で一緒に積む
        // ——名前だけ変わって参照が古いままの状態は、実機が通さない。
        if (edit.attributes.name !== undefined) {
          results.push(
            ...renameReferenceResults(
              lines,
              ddsName(unit.line),
              edit.attributes.name,
              edit.sourceLine
            )
          );
        }
        break;
      }
      case "setKeywords": {
        // **ファイル・レベルの行は論理単位にならない**ので先に見る。
        const fileLevel = fileLevelAt(lines, edit.sourceLine);
        if (fileLevel !== undefined) {
          const last = fileLevel.sourceLines[fileLevel.sourceLines.length - 1];
          results.push({
            replaceFrom: fileLevel.sourceLines[0] - 1,
            replaceTo: last,
            lines: keywordLines(lines[edit.sourceLine - 1], edit.keywords)
          });
          break;
        }

        const unit = unitAt(units, edit.sourceLine);
        if (!unit) break;
        const run = keywordRunOf(unit);
        if (!run) break; // 検証済みなので通常は起きない。
        results.push({
          replaceFrom: run.from,
          replaceTo: run.to,
          lines: keywordLines(lines[edit.sourceLine - 1], edit.keywords)
        });
        break;
      }
      case "setCondition": {
        const unit = itemUnitAt(units, edit.sourceLine);
        if (!unit) break;
        const run = conditionRunOf(unit);
        if (!run) break; // 検証済みなので通常は起きない。
        results.push({
          replaceFrom: run.from,
          replaceTo: run.to,
          lines:
            edit.screenSizeName === undefined
              ? writeBackCondition(unit.line, edit.condition)
              : writeBackScreenSizeCondition(unit.line, edit.screenSizeName)
        });
        break;
      }
      case "setKeywordCondition": {
        const group = keywordGroupAt(units, edit.sourceLine);
        if (!group) break; // 検証済みなので通常は起きない。
        const first = group.sourceLines[0];
        // **書き戻しは項目のときと同じ**——最後の 1 本が「条件を担う行」で、
        // ここではキーワードの行がそれにあたる。
        results.push({
          replaceFrom: first - 1,
          replaceTo: edit.sourceLine,
          lines:
            edit.screenSizeName === undefined
              ? writeBackCondition(lines[edit.sourceLine - 1], edit.condition)
              : writeBackScreenSizeCondition(lines[edit.sourceLine - 1], edit.screenSizeName)
        });
        break;
      }
      case "remove": {
        const unit = itemUnitAt(units, edit.sourceLine);
        if (!unit) break;
        results.push(...removalRuns(unit));
        break;
      }
      case "add": {
        const at = insertionPoint(units, edit.recordName);
        if (at === undefined) break;
        results.push({ replaceFrom: at, replaceTo: at, lines: [buildItemLine(edit.item)] });
        break;
      }
    }
  }

  // 降順にすると、先に適用した指示が後続の行番号を動かさない。
  return [...results].sort((a, b) => b.replaceFrom - a.replaceFrom);
}

/**
 * キーワード欄の置き換えが**ソースに書けるか**。
 *
 * 桁は `foldKeywordArea` が必ず収めるので見ない。見るのは 2 つだけ:
 * **定数がリテラルで始まらなくなっていないか**（始まらないと項目として認識されず、
 * キャンバスから消える）と、**区間が連続しているか**（注記行を巻き込まない）。
 */
function validateKeywords(
  unit: LogicalUnit,
  keywords: string,
  sourceLine: number
): DdsEditRejection[] {
  const rejections = validateKeywordRun(unit, sourceLine);

  if (unitItemKind(unit) === "constant" && readConstant(keywords) === undefined) {
    rejections.push({
      code: "constant-needs-literal",
      message: "固定情報（定数）のキーワード欄はリテラル（'…'）で始まる必要があります",
      sourceLine
    });
  }

  return rejections;
}

/**
 * 行を変える移動が**書けるか**。
 *
 * 位置欄の行番号が空の項目は、行が**行送り**（`SPACE` / `SKIP`）で決まっている。
 * そこへ行番号を書き込むと行送りが無効になり、**別のものになる**。
 * 実務の PRTF はほとんどの項目が行番号を持たないので、**桁だけの移動は通す**。
 *
 * DSPF では位置欄が空の項目は配置できず、キャンバスに出ない（＝移動の宛先にならない）ので、
 * この判定が効くのは実質 PRTF だけ。
 */
function validateRowMove(
  unit: LogicalUnit,
  ddsType: EditableDdsType,
  sourceLine: number
): DdsEditRejection[] {
  // **帳票だけの話。** 画面ファイルに `SPACE` / `SKIP` は無く、行番号が空の項目は
  // そもそも配置されない（`missing-position`）。種別を見ないと、画面ファイルで
  // 意味を成さない理由（「行送りで決まります」）を返すことになる。
  if (ddsType !== "DDS-PRTF") return [];
  // 行番号が書いてあるなら、位置欄の書き換えでそのまま動く。
  if (readNumber(ddsField(unit.line, DDS_POSITION_ROW)) !== undefined) return [];
  return [
    {
      code: "row-from-spacing",
      message:
        "この項目の行は行送り（SPACE / SKIP）で決まります。" +
        "行番号を書き込むと行送りが無効になるため、行は変えません（桁は変えられます）",
      sourceLine
    }
  ];
}

/**
 * その項目の**キーワード欄の区間**（代表行から続く行）。
 *
 * 返すのは 0 始まりの半開区間。`sourceLines` のうち代表行以降が対象で、
 * **連続していなければ `undefined`**——間に注記行が挟まっていると、
 * 区間で置き換えたときに注記が消える。
 */
function keywordRunOf(unit: LogicalUnit): { from: number; to: number } | undefined {
  const after = unit.sourceLines.filter(line => line >= unit.sourceLine).sort((a, b) => a - b);
  if (after.length === 0) return undefined;
  for (let i = 1; i < after.length; i += 1) {
    if (after[i] !== after[i - 1] + 1) return undefined;
  }
  return { from: after[0] - 1, to: after[after.length - 1] };
}

function validateKeywordRun(unit: LogicalUnit, sourceLine: number): DdsEditRejection[] {
  if (keywordRunOf(unit) !== undefined) return [];
  return [
    {
      code: "keyword-lines-not-contiguous",
      message: "キーワードの行の間に注記行が挟まっています（この形は書き換えません）",
      sourceLine
    }
  ];
}

/** キーワード欄を折って、代表行から続く行を組み立てる。 */
function keywordLines(representative: string, keywords: string): string[] {
  const chunks = foldKeywordArea(keywords);
  if (chunks.length === 0) return [writeBackKeywordArea(representative, "")];
  return [
    writeBackKeywordArea(representative, chunks[0]),
    ...chunks.slice(1).map(buildKeywordLine)
  ];
}

/** 属性を書き換えた行を作る。定数のリテラルは**先頭の 1 つだけ**を差し替える。 */
function applyAttributes(
  line: string,
  attributes: ItemAttributePatch & { text?: string }
): string {
  let next = writeBackAttributes(line, attributes);
  if (attributes.text !== undefined) {
    const replaced = replaceLeadingConstant(keywordAreaOf(next), attributes.text);
    if (replaced !== undefined) {
      next = writeBackKeywordArea(next, replaced);
    }
  }
  return next;
}

/**
 * 属性の変更が**ソースに書けるか**を見る。
 *
 * 規則違反（重なり・はみ出し）は見ない——それは `dspfLayout` の診断の担当で、
 * 編集は止めない（直すために変えたい、が成立するため）。
 */
function validateAttributes(
  lines: readonly string[],
  unit: LogicalUnit,
  attributes: ItemAttributePatch & { text?: string },
  sourceLine: number
): DdsEditRejection[] {
  const rejections: DdsEditRejection[] = [];
  const isConstant = unitItemKind(unit) === "constant";
  const at = (code: DdsEditRejectionCode, message: string): DdsEditRejection => ({
    code,
    message,
    sourceLine
  });

  const touchesFieldColumns =
    attributes.name !== undefined ||
    attributes.length !== undefined ||
    attributes.dataType !== undefined ||
    attributes.decimals !== undefined ||
    attributes.usage !== undefined;

  if (isConstant && touchesFieldColumns) {
    rejections.push(
      at("field-column-on-constant", "固定情報（定数）には名前や桁数を指定できません")
    );
  }
  if (!isConstant && attributes.text !== undefined) {
    rejections.push(at("text-on-field", "フィールドにリテラルは書けません"));
  }

  // 継続にまたがる定数のリテラルは、**欄全体を折り直して**書き出す（`applyDdsEdits`）。
  // その経路は区間を置き換えるので、注記行が挟まっていると注記が消える。
  if (attributes.text !== undefined && startsContinuation(unit.line)) {
    rejections.push(...validateKeywordRun(unit, sourceLine));
  }

  if (attributes.name !== undefined) {
    const name = attributes.name.trim();
    if (name.length === 0) {
      rejections.push(at("field-needs-name", "フィールドには名前が必要です"));
    } else if (name.length > NAME_WIDTH) {
      rejections.push(
        at("name-too-long", `名前は ${NAME_WIDTH} 桁までです（${name.length} 桁）`)
      );
    }
  }
  if (
    attributes.length !== undefined &&
    (!fitsInColumn(attributes.length, LENGTH_WIDTH) || attributes.length < 1)
  ) {
    rejections.push(
      at("length-out-of-range", `長さ ${attributes.length} は桁数欄に書けません`)
    );
  }
  if (
    attributes.decimals !== undefined &&
    (!fitsInColumn(attributes.decimals, DECIMALS_WIDTH) || attributes.decimals < 0)
  ) {
    rejections.push(
      at("decimals-out-of-range", `小数桁 ${attributes.decimals} は小数点以下桁数欄に書けません`)
    );
  }
  for (const [label, value] of [
    ["データ・タイプ", attributes.dataType],
    ["使用", attributes.usage]
  ] as const) {
    if (value !== undefined && value.trim().length > 1) {
      rejections.push(at("invalid-column-value", `${label}は 1 桁です（"${value}"）`));
    }
  }

  // 書き換えた結果が行の上限を超えるなら書けない。
  const next = applyAttributes(lines[sourceLine - 1] ?? "", attributes);
  if (next.length > MAX_LINE_COLUMNS) {
    rejections.push(
      at("line-too-long", `書き換えると ${next.length} 桁になり、${MAX_LINE_COLUMNS} 桁を超えます`)
    );
  }

  return rejections;
}

/** 論理単位の行を、連続する塊ごとの削除指示に分ける（注記行を挟むと分かれる）。 */
function removalRuns(unit: LogicalUnit): DdsEditResult[] {
  const indexes = [...unit.sourceLines].sort((a, b) => a - b).map(line => line - 1);
  const runs: DdsEditResult[] = [];

  let start = indexes[0];
  let previous = indexes[0];
  for (const index of indexes.slice(1)) {
    if (index === previous + 1) {
      previous = index;
      continue;
    }
    runs.push({ replaceFrom: start, replaceTo: previous + 1, lines: [] });
    start = index;
    previous = index;
  }
  runs.push({ replaceFrom: start, replaceTo: previous + 1, lines: [] });
  return runs;
}

/**
 * 追加する位置＝**その様式の最後の論理単位の直後**（0 始まりの挿入点）。
 *
 * 様式が見つからなければ undefined（検証で弾かれている）。
 */
function insertionPoint(
  units: readonly LogicalUnit[],
  recordName: string
): number | undefined {
  const start = units.findIndex(
    unit => unit.kind === "record" && ddsName(unit.line).toUpperCase() === recordName.toUpperCase()
  );
  if (start < 0) {
    return undefined;
  }

  let last = units[start];
  for (const unit of units.slice(start + 1)) {
    if (unit.kind === "record") break;
    last = unit;
  }
  return Math.max(...last.sourceLines);
}

function validateAdd(
  units: readonly LogicalUnit[],
  recordName: string,
  item: NewDspfItem,
  ddsType: EditableDdsType
): DdsEditRejection[] {
  const rejections: DdsEditRejection[] = [];

  if (insertionPoint(units, recordName) === undefined) {
    rejections.push({
      code: "record-not-found",
      message: `レコード様式 ${recordName} が見つかりません`
    });
  }

  if (item.kind === "field") {
    if ((item.name ?? "").trim().length === 0) {
      rejections.push({ code: "field-needs-name", message: "フィールドには名前が必要です" });
    }
    if (
      item.length !== undefined &&
      (!fitsInColumn(item.length, LENGTH_WIDTH) || item.length < 1)
    ) {
      rejections.push({
        code: "length-out-of-range",
        message: `長さ ${item.length} は桁数欄（${LENGTH_WIDTH} 桁）に書けません`
      });
    }
  } else if (item.length !== undefined) {
    rejections.push({
      code: "constant-has-length",
      message: "固定情報（定数）には桁数を指定できません"
    });
  }

  rejections.push(...validatePosition(item.row, item.column));
  // **追加でも同じ**（移動だけ塞いでも、追加から入れれば同じ状態になる）。
  rejections.push(...validateColumnOne(item.row, item.column, ddsType, item.row));
  return rejections;
}

/**
 * その行がファイル・レベルのキーワード行なら返す。
 *
 * **論理単位にならない**（最初の様式より前にあり、置けるものではない）ので、
 * 単位から探しても見つからない。`setKeywords` の宛先として別に引く。
 */
function fileLevelAt(
  lines: readonly string[],
  sourceLine: number
): FileKeywordLine | undefined {
  return fileLevelKeywordLines(lines).find(entry => entry.sourceLine === sourceLine);
}

/** 行番号が連続しているか（間に注記行が挟まっていないか）。 */
function contiguous(lines: readonly number[]): boolean {
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] !== lines[i - 1] + 1) return false;
  }
  return true;
}

/** その行にあるキーワード群（`30 DSPATR(RI)` のような**キーワードだけの行**）。 */
function keywordGroupAt(
  units: readonly LogicalUnit[],
  sourceLine: number
): RawKeywordGroup | undefined {
  for (const unit of units) {
    // **先頭の群は代表行**（項目自身の条件で決まる）。宛先にしない。
    for (const group of unit.keywordGroups.slice(1)) {
      if (group.sourceLine === sourceLine) return group;
    }
  }
  return undefined;
}

/**
 * 条件標識を書けるか。**原典の上限を見る。**
 *
 * > 1 つのフィールドまたはキーワードについて**最大 9 つの条件**を指定することができ、
 * > 1 つの条件について**最大 9 つの標識**を指定することができます。
 *
 * 標識そのものは 01-99（原典「オプション標識は、01 - 99 の 2 桁の数字で指定します」）。
 */
function validateCondition(
  unit: LogicalUnit,
  groups: ConditionGroups,
  sourceLine: number,
  screenSizeName?: string
): DdsEditRejection[] {
  const rejections: DdsEditRejection[] = [
    ...validateConditionShape(groups, sourceLine, screenSizeName)
  ];

  // **条件が空でも 1 本は残る**（代表行）ので、区間が連続しているかだけ見る。
  if (!conditionRunOf(unit)) {
    rejections.push({
      code: "condition-lines-not-contiguous",
      message:
        "条件の行と項目の行の間に注記行が挟まっています" +
        "（まとめて置き換えると注記が消えるため書き換えません）",
      sourceLine
    });
  }

  return rejections;
}

/**
 * 条件の**形**（上限と標識、画面サイズ条件名）を見る。
 * 項目にもキーワードにも同じ規則が効く。
 */
function validateConditionShape(
  groups: ConditionGroups,
  sourceLine: number,
  screenSizeName?: string
): DdsEditRejection[] {
  const rejections: DdsEditRejection[] = [];

  if (screenSizeName !== undefined) {
    // **標識と混ぜられない。** 画面サイズ条件名は AND でも OR でもない。
    if (groups.length > 0) {
      rejections.push({
        code: "screen-size-name-invalid",
        message: "画面サイズ条件名と標識は同時に指定できません（欄の使い方が別です）",
        sourceLine
      });
    }
    if (!isScreenSizeConditionName(screenSizeName)) {
      rejections.push({
        code: "screen-size-name-invalid",
        message:
          `画面サイズ条件名 '${screenSizeName}' が無効です` +
          "（原典: 2 - 8 文字で、最初の文字はアスタリスク (*)）",
        sourceLine
      });
    }
    return rejections;
  }

  if (groups.length > CONDITION_LIMITS.groups) {
    rejections.push({
      code: "condition-too-many",
      message:
        `条件は ${CONDITION_LIMITS.groups} つまでです（${groups.length} つ指定されています）` +
        "（原典: 最大 9 つの条件）",
      sourceLine
    });
  }

  for (const terms of groups) {
    if (terms.length > CONDITION_LIMITS.termsPerGroup) {
      rejections.push({
        code: "condition-too-many",
        message:
          `1 つの条件に書ける標識は ${CONDITION_LIMITS.termsPerGroup} 個までです` +
          `（${terms.length} 個指定されています）（原典: 1 つの条件について最大 9 つの標識）`,
        sourceLine
      });
    }
    for (const term of terms) {
      if (!/^\d{1,2}$/u.test(term.indicator) || Number(term.indicator) < 1) {
        rejections.push({
          code: "condition-indicator-invalid",
          message:
            `標識 '${term.indicator}' は書けません` +
            "（原典: オプション標識は、01 - 99 の 2 桁の数字で指定します）",
          sourceLine
        });
      }
    }
  }

  return rejections;
}

/**
 * 条件を置き換える区間（0 始まり・`to` は含まない）。
 *
 * 先行する条件行から代表行まで。**キーワード継続行は含めない**——あちらは代表行の
 * 後ろに続くので、条件の書き換えでは触らない。
 *
 * 注記行が挟まっていたら `undefined`（区間で置き換えると注記が消える）。
 */
function conditionRunOf(unit: LogicalUnit): { from: number; to: number } | undefined {
  // `conditioningLines` は「先行する条件行 → 代表行」の順。
  const leading = unit.conditioningLines.length - 1;
  const first = unit.sourceLines[0];
  const representative = unit.sourceLine;
  if (first === undefined) return undefined;
  // 連続していること（間に注記行が無いこと）。
  if (representative - first !== leading) return undefined;
  return { from: first - 1, to: representative };
}

/**
 * **1 行 1 桁**に置こうとしていないか。**表示装置ファイルだけ**の規則。
 *
 * 判定と文面は `dspfLayout` の診断と共有する（同じ規則を 2 か所に書かない）。
 *
 * ■ ここだけ拒否する理由
 *   重なり・はみ出しは**実機が通す**ので拒否しない——直すために一度重ねる、
 *   といった動かし方ができなくなる（既存の判断）。1 行 1 桁は違う。
 *   **実機がコンパイルを通さない**（`CPF7311`。2026-08-27 / IBM i 7.3 で確認）ので、
 *   書けてしまうと壊れたと気付くのは実機に持っていったときになる。
 *
 * ■ 帳票は対象外
 *   属性文字が無いので手前の桁が要らない。原典の
 *   `位置 (印刷装置ファイルの 39 から 44 桁目)` にも 1 桁目の制限は無い。
 */
function validateColumnOne(
  row: number,
  column: number,
  ddsType: EditableDdsType,
  sourceLine: number
): DdsEditRejection[] {
  if (ddsType !== "DDS-DSPF" || !isRowOneColumnOne(row, column)) return [];
  return [{ code: "column-one-reserved", message: COLUMN_ONE_MESSAGE, sourceLine }];
}

/** 位置欄に書けるか。`row` を省くと桁だけを見る（帳票の `moveColumn`）。 */
function validatePosition(
  row: number | undefined,
  column: number,
  sourceLine?: number
): DdsEditRejection[] {
  const bad = (what: string, value: number): DdsEditRejection => ({
    code: "position-out-of-range",
    message: `${what} ${value} は位置欄（${POSITION_WIDTH} 桁）に書けません`,
    ...(sourceLine !== undefined ? { sourceLine } : {})
  });

  const rejections: DdsEditRejection[] = [];
  if (row !== undefined && (!fitsInColumn(row, POSITION_WIDTH) || row < 1)) {
    rejections.push(bad("行", row));
  }
  if (!fitsInColumn(column, POSITION_WIDTH) || column < 1) {
    rejections.push(bad("桁", column));
  }
  return rejections;
}

/**
 * 様式の改名が書けるか。
 *
 * **同じ名前の様式を 2 つ置けない**——実機がコンパイルを通さない（IBM i 7.3。
 * `.aidev/works/20260828-dds-record-rename/verify/probe-record-names.mjs` の N1）。
 * 名前の長さの上限は項目と同じ 10 桁（同 probe の NC / ND）。
 */
function validateRecordRename(
  units: readonly LogicalUnit[],
  sourceLine: number,
  name: string
): DdsEditRejection[] {
  const target = units.find(
    unit => unit.kind === "record" && unit.sourceLine === sourceLine
  );
  if (!target) {
    return [
      {
        code: "record-line-not-found",
        message: `${sourceLine} 行目に様式がありません（ソースが変わっている可能性があります）`,
        sourceLine
      }
    ];
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return [{ code: "record-needs-name", message: "様式には名前が必要です", sourceLine }];
  }
  if (trimmed.length > NAME_WIDTH) {
    return [
      {
        code: "name-too-long",
        message: `名前は ${NAME_WIDTH} 桁までです（${trimmed.length} 桁）`,
        sourceLine
      }
    ];
  }

  const upper = trimmed.toUpperCase();
  const clash = units.some(
    unit =>
      unit.kind === "record" &&
      unit.sourceLine !== sourceLine &&
      ddsName(unit.line).toUpperCase() === upper
  );
  if (clash) {
    return [
      {
        code: "record-name-duplicate",
        message: `様式 ${upper} は既にあります（同じ名前の様式は 2 つ置けません）`,
        sourceLine
      }
    ];
  }
  return [];
}

/**
 * 名前の変更に追随してキーワード欄を書き換える指示。
 *
 * ## 何を追うか
 *
 * `findFieldReferences` が決める（`ddsReferences.ts`）——`&名前` と、原典が
 * 「このファイル内の項目」と書いている定位置の引数だけ。**外部のファイル・
 * フォント・メッセージを指す引数は触らない**（黙って書き換わると原因が掴めない）。
 *
 * ## 継続でつながった行は**まとめて**、それ以外は**その場で**
 *
 * **論理単位の区間をまとめて置き換えない。** 区間で置き換えると `foldKeywordArea` が
 * 走り、**参照と関係のない行まで畳まれる**（`R MAIN` の次の `CSRLOC` 行が
 * `R MAIN` の行に吸い込まれた）。改名で他の行の見た目が変わるのは驚きなので、
 * 既定は**参照が書かれている物理行のキーワード欄だけ**を差し替える。
 *
 * ただし**継続（`-` / `+` / 引用符の開き）でつながった run は別**。
 * `CSRLOC(ROW +` / `COL)` のように**参照が行をまたいで書かれている**と、
 * 物理行だけを見ても名前が見つからない（`COL` の側には `CSRLOC(` が無い）。
 * そこで継続の run は**結合したテキストで探し、まとめて折り直す**。
 *
 * この 2 つは衝突しない——単独のキーワード行は `joinContinuations` が
 * **別の run** として返すので、`R MAIN` の次の `CSRLOC` 行が吸い込まれることはない。
 *
 * ## 改名した行そのものは対象外
 *
 * 代表行は既に別の指示で書き換えている。同じ行に 2 つの指示が出ると区間が重なる。
 */
function renameReferenceResults(
  lines: readonly string[],
  from: string,
  to: string,
  skipSourceLine: number,
  rename: (keywords: string, from: string, to: string) => string = renameFieldReferences
): DdsEditResult[] {
  const results: DdsEditResult[] = [];
  if (from.trim().length === 0 || from.trim().toUpperCase() === to.trim().toUpperCase()) {
    return results;
  }

  for (const joined of joinContinuations(lines)) {
    const head = lines[joined.index];
    if (isDdsCommentLine(head) || isDdsBlankLine(head)) continue;
    // 代表行が改名の宛先なら触らない（別の指示が同じ行を書き換えている）。
    if (joined.index + 1 === skipSourceLine) continue;

    // ■ 継続でつながっていない run は**その場で**（見た目を変えない）。
    if (joined.sourceLines.length === 1) {
      const area = keywordAreaOf(head);
      const renamed = rename(area, from, to);
      if (renamed === area) continue;
      results.push({
        replaceFrom: joined.index,
        replaceTo: joined.index + 1,
        lines: keywordLines(head, renamed)
      });
      continue;
    }

    // ■ 継続の run は**結合したテキストで探して折り直す**。
    const renamed = rename(joined.keywords, from, to);
    if (renamed === joined.keywords) continue;
    const last = joined.sourceLines[joined.sourceLines.length - 1];
    results.push({
      replaceFrom: joined.index,
      replaceTo: last,
      lines: keywordLines(head, renamed)
    });
  }

  return results;
}

/**
 * 2 次画面サイズの位置を書く。**上書き行があれば置き換え、無ければ作る。**
 *
 * 作る行の形と置き場所は実機に判定させた（IBM i 7.3 / `CRTDSPF`。原典に規定が無い。
 * `.aidev/works/20260828-dds-secondary-edit/verify/`）:
 *
 * - 置き場所は**項目の run の直後**。run の途中（継続行の間）に挟むと通らない。
 *   項目の**前**にも置けない（直前の項目に付くため）。
 * - 条件付け欄に書けるのは**画面サイズ条件名だけ**。標識を混ぜると通らない。
 * - **長さ欄を持てない**。だから空の A 仕様書行から作り、位置だけを書く。
 * - 1 項目 **1 本**。だから既存があれば置き換える（足さない）。
 */
function moveSecondary(
  lines: readonly string[],
  unit: LogicalUnit,
  row: number,
  column: number
): DdsEditResult[] {
  const name = secondaryConditionName(lines);
  if (name === undefined) return []; // 検証済み。

  const existing = alternateFor(lines, unit);
  if (existing) {
    const index = existing.sourceLine - 1;
    return [
      {
        replaceFrom: index,
        replaceTo: index + 1,
        lines: [writeBackPosition({ line: lines[index], row, column })]
      }
    ];
  }

  // run の**次**に挿す（`replaceFrom === replaceTo` が挿入）。
  const at = unitRunEnd(unit);
  return [
    { replaceFrom: at, replaceTo: at, lines: [buildAlternatePositionLine(name, row, column)] }
  ];
}

/**
 * 2 次画面サイズの位置を触れるか。触れないなら理由を返す。
 *
 * 「書けない形」だけを弾く（`DdsEditRejectionCode` の方針）——
 * 画面をはみ出す位置は実機が通すので、いままでどおり診断で出す。
 */
function validateSecondary(
  lines: readonly string[],
  ddsType: EditableDdsType,
  sourceLine: number
): DdsEditRejection[] {
  if (ddsType !== "DDS-DSPF") {
    return [
      {
        code: "screen-size-not-editable",
        message:
          "帳票に 2 次画面サイズはありません（DSPSIZ は表示装置ファイルのキーワードです）",
        sourceLine
      }
    ];
  }

  if (secondaryConditionName(lines) === undefined) {
    return [
      {
        code: "screen-size-not-declared",
        message:
          "DSPSIZ に 2 次画面サイズが宣言されていません" +
          "（上書き行の条件付け欄に書く名前が決まりません）",
        sourceLine
      }
    ];
  }
  return [];
}

/**
 * 上書き行に書く**画面サイズ条件名**。2 次が無ければ undefined。
 *
 * 読む側（`resolveDspfLayout`）と同じ `resolveScreenSizes` を通す。
 * ここで `DSPSIZ` を読み直すと、同じ解釈が 2 通りになる。
 */
function secondaryConditionName(lines: readonly string[]): string | undefined {
  const { sizes } = resolveScreenSizes(lines);
  return sizes.secondary === undefined ? undefined : conditionNameFor(sizes.secondary);
}

/** その項目の、2 次画面サイズを指す位置の上書き行。 */
function alternateFor(
  lines: readonly string[],
  unit: LogicalUnit
): AlternatePosition | undefined {
  const { sizes } = resolveScreenSizes(lines);
  return sizes.secondary === undefined
    ? undefined
    : findAlternatePosition(unit, sizes.secondary);
}

/** その行にある「編集できる項目」の論理単位。レコード宣言行は対象外。 */
function itemUnitAt(
  units: readonly LogicalUnit[],
  sourceLine: number
): LogicalUnit | undefined {
  return units.find(unit => unit.kind === "item" && unit.sourceLine === sourceLine);
}

/**
 * 項目でも**様式でも**引く。
 *
 * キーワード欄は様式（`R XXXX`）も持つ——`OVERLAY` / `CFnn` はそこにしか書けない。
 * 位置や長さは様式に無いので、**キーワードの編集だけ**がこちらを使う。
 */
function unitAt(
  units: readonly LogicalUnit[],
  sourceLine: number
): LogicalUnit | undefined {
  return units.find(unit => unit.sourceLine === sourceLine);
}

function fitsInColumn(value: number, width: number): boolean {
  return Number.isInteger(value) && String(Math.trunc(Math.abs(value))).length <= width;
}

function ddsName(line: string): string {
  return ddsField(line, DDS_COLUMNS.name).trim();
}
