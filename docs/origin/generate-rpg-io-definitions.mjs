#!/usr/bin/env node
/**
 * I/O 仕様書の定義 JSON を生成する。
 *
 * I/O 仕様書は 1 つの定義では表せない。桁の意味が2軸で変わるため:
 *   - レコード識別行 / フィールド記述行
 *   - プログラム記述ファイル / 外部記述ファイル
 * の組み合わせで 4 通りある（I・O それぞれ）。
 *
 * 桁は原典の以下から取っている（いずれも docs/origin/ilerpg/）:
 *   I-SPEC-record-id-entries / I-SPEC-field-entries
 *   O-SPEC-record-id-control-entries / O-SPEC-field-control-entries
 *   I-SPEC-layout-{program,external} / O-SPEC-layout-{program,external} のレイアウト図
 *
 * レイアウト図は 6 桁目（仕様書コード）始まりで、記入項目ページの「N 桁目」
 * 記述と一致することを確認済み。例:
 *   IFilename++SqNORiPos1+NCC...  → Filename++ が 7-16、Sq が 17-18、N=19、O=20、Ri=21-22
 *
 * 使い方:  node docs/origin/generate-rpg-io-definitions.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../vscode-extension/resources/prompter/rpg/ile");

const COMMENT = ["COMMENT", "注記", 81, 100, "仕様書の注記部分（81 から 100 桁目）。"];

/** [name, description, from, to, help?, options?] */
const LAYOUTS = {
  "I-SPEC-REC-PGM": {
    description: "入力仕様書 レコード識別（プログラム記述）",
    help: "プログラム記述ファイルのレコード識別項目（7 から 46 桁目）。ファイル中の入力レコードと他のレコードとの関係を記述します。",
    fields: [
      ["FILENAME", "ファイル名", 7, 16, "入力レコードが属するファイルの名前。"],
      ["SEQUENCE", "順序", 17, 18, "レコードの順序。英字はレコードの順序を検査しないことを示します。"],
      ["NUMBER", "番号", 19, 19, "1=順序内で1回だけ、N=複数回。"],
      ["OPTION", "オプション", 20, 20, "O=このレコード・タイプが任意であることを示します。"],
      ["RECIDIND", "レコード識別標識", 21, 22, "レコードを読み取ったときにオンにする標識。"],
      ["RECIDCODE", "レコード識別コード", 23, 46, "レコードを識別するコード（位置・否定・コード部分・文字の3組）。"],
      COMMENT
    ]
  },
  "I-SPEC-REC-EXT": {
    description: "入力仕様書 レコード識別（外部記述）",
    help: "外部記述ファイルのレコード識別項目（7 から 16 桁目および 21 から 22 桁目）。RPG の機能を追加する先の外部記述レコード様式を識別します。",
    fields: [
      ["RCDNAME", "レコード様式名", 7, 16, "機能を追加する外部記述レコード様式の名前。"],
      ["RECIDIND", "レコード識別標識", 21, 22, "レコードを読み取ったときにオンにする標識。"],
      COMMENT
    ]
  },
  "I-SPEC-FLD-PGM": {
    description: "入力仕様書 フィールド記述（プログラム記述）",
    help: "プログラム記述ファイルのフィールド記述項目。レコード内のフィールドを定義します。",
    fields: [
      ["DATAATTR", "データ属性", 31, 34, "外部データの属性。"],
      ["DTSEP", "日付/時刻区切り記号", 35, 35, "日付・時刻フィールドの区切り記号。"],
      ["DATAFMT", "データ形式", 36, 36, "フィールドのデータ形式。"],
      ["FIELDPOS", "フィールドの位置", 37, 46, "レコード内の開始位置と終了位置。"],
      ["DECPOS", "小数点以下の桁数", 47, 48, "数値フィールドの小数点以下の桁数。"],
      ["FIELDNAME", "フィールド名", 49, 62, "プログラム内で使用するフィールドの名前。"],
      ["CTLLEVEL", "制御レベル", 63, 64, "L1〜L9。制御break を起こすフィールドを示します。"],
      ["MATCHFLD", "突き合わせフィールド", 65, 66, "M1〜M9。複数ファイルの突き合わせに使います。"],
      ["FLDRECREL", "フィールドとレコードの関連", 67, 68, "フィールドを特定のレコードに関連付ける標識。"],
      ["FLDIND", "フィールド標識", 69, 74, "プラス/マイナス/ゼロまたはブランクで設定される標識。"],
      COMMENT
    ]
  },
  "I-SPEC-FLD-EXT": {
    description: "入力仕様書 フィールド記述（外部記述）",
    help: "外部記述ファイルのフィールド記述項目。外部記述のフィールドに RPG の機能を追加します。",
    fields: [
      ["EXTFIELD", "外部フィールド名", 21, 30, "外部記述で定義されているフィールドの名前。"],
      ["FIELDNAME", "フィールド名", 49, 62, "プログラム内で使用する名前（改名する場合）。"],
      ["CTLLEVEL", "制御レベル", 63, 64, "L1〜L9。制御break を起こすフィールドを示します。"],
      ["MATCHFLD", "突き合わせフィールド", 65, 66, "M1〜M9。複数ファイルの突き合わせに使います。"],
      ["FLDIND", "フィールド標識", 69, 74, "プラス/マイナス/ゼロまたはブランクで設定される標識。"],
      COMMENT
    ]
  },
  "O-SPEC-REC-PGM": {
    description: "出力仕様書 レコード識別および制御（プログラム記述）",
    help: "プログラム記述ファイルのレコード識別および制御項目（7 から 51 桁目）。",
    fields: [
      ["FILENAME", "ファイル名", 7, 16, "出力先のファイルの名前。"],
      ["OUTTYPE", "タイプ", 17, 17, "H=見出し、D=明細、T=合計、E=例外。"],
      ["FETCHOVF", "フェッチ・オーバーフロー/解放", 18, 18, "F=フェッチ・オーバーフロー、R=解放。"],
      ["ADDDEL", "レコードの追加/削除", 18, 20, "ADD=追加、DEL=削除。"],
      ["OUTIND", "ファイル・レコード ID 標識", 21, 29, "出力を条件付ける標識（3組）。"],
      ["EXCEPTNAME", "EXCEPT 名", 30, 39, "EXCEPT 命令から参照する名前。"],
      ["SPACEBEF", "印刷前スペース", 40, 42, "印刷前の行送り数。"],
      ["SPACEAFT", "印刷後スペース", 43, 45, "印刷後の行送り数。"],
      ["SKIPBEF", "印刷前スキップ", 46, 48, "印刷前にスキップする行。"],
      ["SKIPAFT", "印刷後スキップ", 49, 51, "印刷後にスキップする行。"],
      COMMENT
    ]
  },
  "O-SPEC-REC-EXT": {
    description: "出力仕様書 レコード識別および制御（外部記述）",
    help: "外部記述ファイルのレコード識別および制御項目（7 から 39 桁目）。",
    fields: [
      ["RCDNAME", "レコード様式名", 7, 16, "出力先の外部記述レコード様式の名前。"],
      ["OUTTYPE", "タイプ", 17, 17, "H=見出し、D=明細、T=合計、E=例外。"],
      ["ADDDEL", "レコードの追加/削除", 18, 20, "ADD=追加、DEL=削除。"],
      ["OUTIND", "ファイル・レコード ID 標識", 21, 29, "出力を条件付ける標識（3組）。"],
      ["EXCEPTNAME", "EXCEPT 名", 30, 39, "EXCEPT 命令から参照する名前。"],
      COMMENT
    ]
  },
  "O-SPEC-FLD-PGM": {
    description: "出力仕様書 フィールド記述および制御（プログラム記述）",
    help: "プログラム記述ファイルのフィールド記述および制御項目。",
    fields: [
      ["OUTIND", "ファイル・フィールド記述標識", 21, 29, "このフィールドの出力を条件付ける標識（3組）。"],
      ["FIELDNAME", "フィールド名", 30, 43, "出力するフィールドの名前。"],
      ["EDITCODE", "編集コード", 44, 44, "数値の編集コード。"],
      ["BLANKAFT", "後で消去", 45, 45, "B=出力後にフィールドをブランク/ゼロにする。"],
      ["ENDPOS", "終了位置", 47, 51, "レコード内の終了位置。"],
      ["DATAFMT", "データ形式", 52, 52, "日付・時刻フィールドのデータ形式。"],
      ["CONSTANT", "定数・編集語", 53, 80, "定数、編集語、データ属性、または形式名。"],
      COMMENT
    ]
  },
  "O-SPEC-FLD-EXT": {
    description: "出力仕様書 フィールド記述および制御（外部記述）",
    help: "外部記述ファイルのフィールド記述および制御項目。",
    fields: [
      ["OUTIND", "ファイル・フィールド記述標識", 21, 29, "このフィールドの出力を条件付ける標識（3組）。"],
      ["FIELDNAME", "フィールド名", 30, 43, "出力するフィールドの名前。"],
      ["BLANKAFT", "後で消去", 45, 45, "B=出力後にフィールドをブランク/ゼロにする。"],
      COMMENT
    ]
  }
};

const SOURCE = {
  url: "https://www.ibm.com/docs/ja/ssw_ibm_i_74/rzasd/",
  version: "IBM i 7.4",
  note: "桁は入力/出力仕様の記入項目ページとレイアウト図（6 桁目始まり）から取得"
};

let written = 0;
for (const [name, spec] of Object.entries(LAYOUTS)) {
  const definition = {
    keyword: name,
    description: spec.description,
    help: spec.help,
    parameters: spec.fields.map(([field, label, from, to, help]) => ({
      name: field,
      description: label,
      ...(help ? { help } : {}),
      inputType: "text",
      required: false,
      sourceStart: from,
      sourceLength: to - from + 1,
      attributes: { characterSet: "upper", maxLength: to - from + 1 }
    })),
    source: SOURCE
  };
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(definition, null, 2)}\n`, "utf8");
  written += 1;
}

console.log(`生成: ${written} 件（I/O 仕様書の 4 レイアウト × 2）`);
