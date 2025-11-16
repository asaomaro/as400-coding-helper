"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBuiltinDefinition = getBuiltinDefinition;
function createRpgCspec() {
    return {
        keyword: "C-SPEC",
        description: "固定長 C 仕様書 (演算仕様書・従来形式)",
        parameters: [
            {
                name: "OPCODE",
                description: "オペコード (CALL/MOVE など)",
                inputType: "text",
                required: true,
                sourceStart: 26,
                sourceLength: 10,
                attributes: {
                    characterSet: "upper",
                    maxLength: 10
                },
                placeholder: "CALL"
            },
            {
                name: "FACTOR1",
                description: "ファクタ 1",
                inputType: "text",
                required: false,
                sourceStart: 12,
                sourceLength: 14,
                attributes: {
                    maxLength: 30
                },
                placeholder: ""
            },
            {
                name: "FACTOR2",
                description: "ファクタ 2",
                inputType: "text",
                required: false,
                sourceStart: 36,
                sourceLength: 14,
                attributes: {
                    maxLength: 30
                },
                placeholder: ""
            },
            {
                name: "RESULT",
                description: "結果フィールド",
                inputType: "text",
                required: false,
                sourceStart: 50,
                sourceLength: 14,
                attributes: {
                    maxLength: 30
                },
                placeholder: ""
            }
        ]
    };
}
function createRpgCnew() {
    return {
        keyword: "C-NEW",
        description: "固定長 C 仕様書 (演算仕様書・新オペコード)",
        parameters: [
            {
                name: "OPCODE",
                description: "オペコード (EVAL/IF など)",
                inputType: "text",
                required: true,
                sourceStart: 26,
                sourceLength: 10,
                attributes: {
                    characterSet: "upper",
                    maxLength: 10
                },
                placeholder: "EVAL"
            },
            {
                name: "COND",
                description: "条件式 / 代入式 (Factor 2)",
                inputType: "text",
                required: true,
                sourceStart: 36,
                sourceLength: 28,
                attributes: {
                    maxLength: 80
                },
                placeholder: "WSLSNO = HSLSNO"
            }
        ]
    };
}
function createRpgDspec() {
    return {
        keyword: "D-SPEC",
        description: "固定長 D 仕様書 (定義仕様書)",
        parameters: [
            {
                name: "NAME",
                description: "フィールド名 (Name)",
                inputType: "text",
                required: true,
                sourceStart: 8,
                sourceLength: 14,
                attributes: {
                    characterSet: "upper",
                    maxLength: 30
                },
                placeholder: "FIELD1"
            },
            {
                name: "EFLAG",
                description: "E (外部記述フィールド)",
                inputType: "text",
                required: false,
                sourceStart: 22,
                sourceLength: 1,
                attributes: {
                    characterSet: "upper",
                    maxLength: 1
                },
                placeholder: ""
            },
            {
                name: "SU",
                description: "S/U (符号付き/符号なし)",
                inputType: "text",
                required: false,
                sourceStart: 23,
                sourceLength: 1,
                attributes: {
                    characterSet: "upper",
                    maxLength: 1
                },
                placeholder: ""
            },
            {
                name: "DECLTYPE",
                description: "定義タイプ (DS/S/C/PR/PI)",
                inputType: "dropdown",
                required: false,
                sourceStart: 24,
                sourceLength: 2,
                options: [
                    { label: "", value: "" },
                    { label: "Standalone (S)", value: "S" },
                    { label: "Data Structure (DS)", value: "DS" },
                    { label: "Constant (C)", value: "C" },
                    { label: "Prototype (PR)", value: "PR" },
                    { label: "Procedure Interface (PI)", value: "PI" }
                ]
            },
            {
                name: "FROM",
                description: "From 位置",
                inputType: "text",
                required: false,
                sourceStart: 26,
                sourceLength: 7,
                attributes: {
                    characterSet: "upper",
                    maxLength: 30
                },
                placeholder: ""
            },
            {
                name: "LEN",
                description: "To 位置 / 長さ",
                inputType: "number",
                required: true,
                sourceStart: 33,
                sourceLength: 7,
                attributes: {
                    numericOnly: true,
                    maxLength: 5
                },
                placeholder: "10"
            },
            {
                name: "INTTYPE",
                description: "データ・タイプ (A/P/S/B/I/F/D/T/Z)",
                inputType: "dropdown",
                required: false,
                sourceStart: 40,
                sourceLength: 1,
                options: [
                    { label: "", value: "" },
                    { label: "文字 (A)", value: "A" },
                    { label: "パック10進 (P)", value: "P" },
                    { label: "ゾーン10進 (S)", value: "S" },
                    { label: "バイナリ (B)", value: "B" },
                    { label: "整数 (I)", value: "I" },
                    { label: "浮動小数点 (F)", value: "F" },
                    { label: "日付 (D)", value: "D" },
                    { label: "時刻 (T)", value: "T" },
                    { label: "タイムスタンプ (Z)", value: "Z" }
                ],
                placeholder: "",
                visibleByDefault: true
            },
            {
                name: "DEC",
                description: "小数点位置",
                inputType: "number",
                required: false,
                sourceStart: 41,
                sourceLength: 2,
                attributes: {
                    numericOnly: true,
                    maxLength: 2
                },
                placeholder: "0",
                visibleByDefault: false
            },
            {
                name: "KEYWORDS",
                description: "キーワード (44-80桁)",
                inputType: "text",
                required: false,
                sourceStart: 44,
                sourceLength: 37,
                attributes: {
                    maxLength: 40
                },
                placeholder: "",
                visibleByDefault: true
            },
            {
                name: "COMMENT",
                description: "コメント (任意)",
                inputType: "text",
                required: false,
                attributes: {
                    maxLength: 50
                },
                placeholder: "",
                visibleByDefault: true
            }
        ]
    };
}
function getBuiltinDefinition(language, keyword) {
    if (language === "rpg-fixed") {
        if (keyword === "C-NEW") {
            return createRpgCnew();
        }
        if (keyword === "C-SPEC") {
            return createRpgCspec();
        }
        if (keyword === "D-SPEC") {
            return createRpgDspec();
        }
    }
    return undefined;
}
//# sourceMappingURL=builtins.js.map