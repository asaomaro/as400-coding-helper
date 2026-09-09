import type { EditableDdsType } from "./ddsEdit";
import { buildKeywordLine, buildRecordLine } from "./ddsEditWriteBack";

/**
 * 新しい DDS ファイルの中身（雛形）。**vscode を import しない。**
 *
 * ## なぜ core が持つのか
 *
 * 新規作成の**導線**はホストにある（VSCode はコマンドと右クリック、単独起動は帯のボタン）。
 * ファイル操作は `providesFileIO` ＝ ホストが肩代わりするものだから。
 * しかし**中身は core が持つ**——両ホストで同じファイルができないと、
 * 「スタンドアロンが本体で VSCode は埋め込み先の 1 つ」という設計が成り立たない。
 *
 * ## 最小限「動く」形にする
 *
 * ビジュアルエディタは**項目をレコード様式の中にしか置けない**。様式が 1 つも無いファイルを
 * 開くと、項目を置こうとしても `record-not-found` で行き止まりになる。
 * だから雛形には**必ず様式を 1 つ入れる**——これが「作った直後からデザイナだけで進められる」条件。
 *
 * 様式名は `REC1`。**中身のある名前を勝手に決めない**（何を作るかは利用者しか知らない）。
 * 改名は一覧のプロパティからできる。
 */

/** 雛形が置く様式の名前。**利用者が改名する前提**の仮の名前。 */
const TEMPLATE_RECORD = "REC1";

/**
 * 画面ファイルの雛形に書く画面サイズ。
 *
 * ■ なぜ省略しないか
 *   原典（`表示装置ファイルの DSPSIZ (画面サイズ) キーワード`）:
 *   > このキーワードを**指定しなかった場合**には、表示装置ファイルは、
 *   > **24 x 80 の画面**を備えた表示装置に対してのみオープンすることができます。
 *
 *   省いても既定は同じだが、**書かないと条件付けの拠り所が消える**。原典は
 *   「ユーザー定義の画面サイズ条件名を指定しない場合には、IBM 提供の画面サイズ条件名を
 *   使用して条件付ける」としており、条件名の無い形は
 *   `*DS3` を条件に付けた項目が黙って落ちる原因になる（実際に踏んだ）。
 *
 * ■ なぜこの値か
 *   原典: 「指定できるのは、**24 x 80、および 27 x 132 だけ**です」。既定の側を採り、
 *   **数値形式に IBM の条件名を添える**（既存の実ソース `docs/src/CUSTMNT.dspf` と同じ形）。
 */
const TEMPLATE_SCREEN_SIZE = "DSPSIZ(24 80 *DS3)";

/**
 * 新しいファイルの中身を返す（行の配列。改行はホストが決める）。
 *
 * **帳票に画面サイズ相当は入れない。** 紙面は DDS ではなく `CRTPRTF` の `PAGESIZE` で決まる
 * ——DDS に書かれないものを DDS の雛形に書くことはできない。
 */
export function buildDdsTemplate(ddsType: EditableDdsType): readonly string[] {
  const record = buildRecordLine(TEMPLATE_RECORD);
  return ddsType === "DDS-PRTF"
    ? [record]
    : [buildKeywordLine(TEMPLATE_SCREEN_SIZE), record];
}
