"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCommandHelpText = buildCommandHelpText;
exports.buildParameterHelpText = buildParameterHelpText;
/**
 * コマンド単位のヘルプ本文を組み立てる。
 * 原典由来のメタ情報（実行環境・例・エラーメッセージ・出典）を持つ定義では、
 * それらを help の後ろに節として連ねる。
 */
function buildCommandHelpText(definition) {
    const sections = [];
    // description に既にキーワードが含まれる定義が多いため、重複表示を避ける。
    // 説明が空のときは見出しを作らない。作ると「 (CMD)」だけのヘルプが出て、
    // 中身が無いのにボタンだけ出ることになる。
    const description = definition.description?.trim();
    if (description) {
        sections.push(description.includes(definition.keyword)
            ? description
            : `${description} (${definition.keyword})`);
    }
    if (definition.help?.trim()) {
        sections.push(definition.help.trim());
    }
    const facts = [];
    if (definition.environment) {
        facts.push(`実行可能場所: ${definition.environment}`);
    }
    if (typeof definition.threadSafe === "boolean") {
        facts.push(`スレッド・セーフ: ${definition.threadSafe ? "はい" : "いいえ"}`);
    }
    if (facts.length > 0) {
        sections.push(facts.join(" ／ "));
    }
    if (definition.restrictions?.length) {
        sections.push(["制約事項:", ...definition.restrictions.map(text => `  ・${text}`)].join("\n"));
    }
    if (definition.constraints?.length) {
        sections.push([
            "パラメータ間の制約:",
            ...definition.constraints.map(constraint => {
                const label = constraint.kind === "exclusive" ? "同時指定不可" : "一緒に指定が必要";
                const note = constraint.note ? ` — ${constraint.note}` : "";
                return `  ・${constraint.parameters.join(" / ")}（${label}）${note}`;
            })
        ].join("\n"));
    }
    const positional = collectPositional(definition.parameters);
    if (positional.length > 0) {
        sections.push(["定位置指定順:", ...positional.map(p => `  ${p.positional}. ${p.name} (${p.description})`)].join("\n"));
    }
    if (definition.examples?.length) {
        sections.push([
            "例:",
            ...definition.examples.map(example => example.note ? `  ${example.code}\n    → ${example.note}` : `  ${example.code}`)
        ].join("\n"));
    }
    if (definition.errorMessages?.length) {
        sections.push([
            "エラー・メッセージ:",
            ...definition.errorMessages.map(message => `  ${message.id} ${message.text}`)
        ].join("\n"));
    }
    if (definition.source?.url) {
        const version = definition.source.version ? ` (${definition.source.version})` : "";
        const updated = definition.source.updated ? ` 最終更新 ${definition.source.updated}` : "";
        sections.push(`出典: ${definition.source.url}${version}${updated}`);
    }
    return sections.join("\n\n");
}
/**
 * パラメータのヘルプ本文を組み立てる。
 * 定義済み値ごとの説明（原典のパラメータ節の <dd>）を持つ場合は値ごとに列挙する。
 */
function buildParameterHelpText(parameter) {
    const sections = [];
    const help = parameter.help?.trim();
    if (help) {
        sections.push(help);
    }
    const described = (parameter.options ?? []).filter(option => option.help?.trim());
    if (described.length > 0) {
        sections.push([
            "指定できる値:",
            ...described.map(option => `  ${option.value}\n    ${option.help?.trim()}`)
        ].join("\n"));
    }
    return sections.join("\n\n");
}
function collectPositional(parameters) {
    return parameters
        .filter((parameter) => typeof parameter.positional === "number")
        .map(parameter => ({
        positional: parameter.positional,
        name: parameter.name,
        description: parameter.description
    }))
        .sort((a, b) => a.positional - b.positional);
}
//# sourceMappingURL=commandHelp.js.map