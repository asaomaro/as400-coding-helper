import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TARGET_EXTENSIONS } from "../../src/utils/fileScope";

/**
 * 表示系だけを効かせたい拡張子に、言語機能が波及していないことを固定する。
 *
 * languageId は診断・キーバインド・スニペット・補完の発火条件を兼ねる。
 * 表示（ルーラー / SOSI）の対象を広げるつもりで言語登録まで広げると、
 * その拡張子に意図しない診断や編集キーが付く。実際に一度踏んでいる。
 */
const manifest = JSON.parse(
  readFileSync(join(__dirname, "../../../package.json"), "utf8")
) as {
  contributes: {
    languages?: { id: string; extensions?: string[] }[];
    keybindings?: { command: string; key: string; when: string }[];
  };
};

/** 言語登録してよいのは、その言語の機能を本当に適用してよい拡張子だけ。 */
const LANGUAGE_ONLY = new Set([".rpg", ".rpgle", ".sqlrpgle", ".sqlrpg", ".clp", ".clle"]);

suite("contributes の副作用", () => {
  test("表示だけの拡張子は言語登録しない", () => {
    for (const language of manifest.contributes.languages ?? []) {
      for (const extension of language.extensions ?? []) {
        assert.ok(
          LANGUAGE_ONLY.has(extension.toLowerCase()),
          `${extension} が ${language.id} に登録されている。` +
            "DDS や .cmd を言語登録すると診断や編集キーが波及する"
        );
      }
    }
  });

  test("編集系のキーバインドは languageId で絞る（拡張子で広げない）", () => {
    const editing = (manifest.contributes.keybindings ?? []).filter(binding =>
      /toggleComment|rpgTab/u.test(binding.command)
    );
    assert.ok(editing.length > 0, "編集系のキーバインドが見つからない");

    for (const binding of editing) {
      assert.ok(
        !/resourceExtname/u.test(binding.when),
        `${binding.command} が拡張子で発火する。DDS や .cmd に編集キーが付く`
      );
      assert.match(
        binding.when,
        /editorLangId ==/u,
        `${binding.command} は languageId で絞ること`
      );
    }
  });

  test("F4 は対象拡張子すべてで発火する", () => {
    const prompter = (manifest.contributes.keybindings ?? []).find(
      binding => binding.command === "rpgClSupport.showPrompter"
    );
    assert.ok(prompter, "F4 のキーバインドが無い");

    for (const extension of TARGET_EXTENSIONS) {
      assert.ok(
        prompter.when.includes(`resourceExtname == .${extension}`),
        `.${extension} で F4 が発火しない`
      );
    }
  });
});
