import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CL_EXTENSIONS,
  CMD_EXTENSIONS,
  DDS_EXTENSIONS,
  RPG_EXTENSIONS,
  TARGET_EXTENSIONS,
  toDocumentSelector,
  toGlobPattern
} from "../../src/utils/fileScope";
import { DDS_COLUMNS } from "../../src/language/ddsLayout";

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

/**
 * 拡張子の集合が用途ごとに割れていることを固定する。
 *
 * 以前は DocumentSelector の glob を各所で手書きしており（`**\/*.{pf,lf,dspf,prtf,mnudds}`）、
 * `TARGET_EXTENSIONS` に `.dds` を足しても DDS キーワード補完には反映されていなかった。
 * 用途別の集合を単一の真実源にして、合成が崩れたら落ちるようにする。
 */
suite("対象拡張子の単一真実源", () => {
  test("用途別の集合の合成が TARGET_EXTENSIONS と一致する", () => {
    assert.deepEqual(
      [...TARGET_EXTENSIONS],
      [
        ...RPG_EXTENSIONS,
        ...CL_EXTENSIONS,
        ...DDS_EXTENSIONS,
        ...CMD_EXTENSIONS
      ],
      "用途別の集合と TARGET_EXTENSIONS がずれている"
    );
  });

  test("用途別の集合は重複しない", () => {
    const all = [
      ...RPG_EXTENSIONS,
      ...CL_EXTENSIONS,
      ...DDS_EXTENSIONS,
      ...CMD_EXTENSIONS
    ];
    assert.equal(
      new Set(all).size,
      all.length,
      "同じ拡張子が複数の用途に入っている"
    );
  });

  test("用途別の集合はどれも空でない（検査が空振りしないための前提）", () => {
    // 集合を丸ごと落とすと、for ループ方式の検査は 0 回転で緑になってしまう。
    for (const [name, set] of [
      ["RPG", RPG_EXTENSIONS],
      ["CL", CL_EXTENSIONS],
      ["DDS", DDS_EXTENSIONS],
      ["CMD", CMD_EXTENSIONS]
    ] as const) {
      assert.ok(set.length > 0, `${name}_EXTENSIONS が空`);
    }
    assert.equal(TARGET_EXTENSIONS.length, 13, "対象拡張子の総数が変わった");
  });

  test("glob は全拡張子を含む", () => {
    const pattern = toGlobPattern(DDS_EXTENSIONS);
    assert.ok(DDS_EXTENSIONS.length > 0, "DDS_EXTENSIONS が空で検査が空振りする");

    for (const extension of DDS_EXTENSIONS) {
      assert.ok(
        pattern.includes(extension),
        `${extension} が glob から漏れている: ${pattern}`
      );
    }
    // `.dds` は以前これで漏れていた。
    assert.ok(pattern.includes("dds"), ".dds が DDS の glob から漏れている");
  });

  test("既知の限界: glob は小文字のみ（大小文字は PJ 全体の課題）", () => {
    // VSCode の glob は大小を区別するので、実機から取り出した `CUSTMST.PF` には
    // 一致しない。これはアウトライン固有ではなく本 PJ 全体の課題:
    //   - package.json の keybindings（F4）は `resourceExtname == .pf` と小文字固定
    //   - ruler.ts の glob も小文字のみ
    //   - isInScopeUri は toLowerCase して比較するので大文字を受ける
    // ここだけ大文字を足すと「アウトラインは出るが F4 とルーラーは効かない」という
    // 別の食い違いになる（一度そうして戻した）。直すなら全部まとめて揃える。
    const pattern = toGlobPattern(DDS_EXTENSIONS);
    assert.ok(!pattern.includes("PF"), "ここだけ大文字を足すと他の機能と食い違う");
  });

  test("拡張子が 1 個のときは波括弧を付けない", () => {
    // 候補が 1 つだけの brace group（`{cmd}`）を展開せずリテラル扱いする
    // glob 実装がある。そうなると .cmd のアウトラインが丸ごと死ぬ。
    assert.equal(toGlobPattern(["cmd"]), "**/*.cmd");
    assert.equal(toGlobPattern(CMD_EXTENSIONS), "**/*.cmd");
    assert.ok(
      !toGlobPattern(CMD_EXTENSIONS).includes("{"),
      "単一拡張子の glob に波括弧が付いている"
    );
  });

  test("拡張子が複数のときは波括弧で並べる", () => {
    assert.equal(toGlobPattern(["pf", "lf"]), "**/*.{pf,lf}");
  });

  test("空集合では何にも一致しない（誤って全ファイルに効かせない）", () => {
    // `**/*.{}` は意味が定まらないので返さない。
    assert.ok(!toGlobPattern([]).includes("{}"));
    assert.deepEqual(toDocumentSelector([]), []);
  });

  test("DocumentSelector は file と untitled の両方を持つ", () => {
    const selector = toDocumentSelector(CMD_EXTENSIONS);

    assert.deepEqual(
      selector.map(filter => filter.scheme),
      ["file", "untitled"]
    );
  });

  test("アウトラインは RPG / CL を対象にしない（既存拡張と二重にしない）", () => {
    // RPG は vscode-rpgle、CL は IBM/vscode-clle が DocumentSymbol を提供済み。
    // 本 PJ が同じものを出すと二重になる。
    const outlineTargets = [...DDS_EXTENSIONS, ...CMD_EXTENSIONS];

    for (const extension of [...RPG_EXTENSIONS, ...CL_EXTENSIONS]) {
      assert.ok(
        !outlineTargets.includes(extension as never),
        `.${extension} がアウトラインの対象に入っている（既存拡張と二重になる）`
      );
    }
  });
});

/**
 * `ddsLayout.ts` の DDS_COLUMNS は、原典から生成した桁定義
 * （docs/origin/generate-dds-columns.mjs → resources/navigation/dds-keyword-columns.json）
 * を手で写している。写し間違い・生成側の更新漏れを検出する。
 *
 * AGENTS.md「原典から機械的に決まる成果物は…検査で固定する」「既存の桁定義を作り直さない
 * （ルーラー・プロンプターと食い違わせない）」に対応する。
 */
suite("DDS の桁定義が生成物と一致する", () => {
  const generated = JSON.parse(
    readFileSync(
      join(__dirname, "../../../resources/navigation/dds-keyword-columns.json"),
      "utf8"
    )
  ) as Record<string, number[]>;

  test("3 種別とも同じ桁の並びを持つ（前提の確認）", () => {
    const types = Object.keys(generated);
    assert.deepEqual(types, ["DDS-PF", "DDS-DSPF", "DDS-PRTF"]);
    for (const type of types) {
      assert.deepEqual(
        generated[type],
        generated["DDS-PF"],
        `${type} の桁が DDS-PF と違う。種別ごとに桁を分ける必要がある`
      );
    }
  });

  test("DDS_COLUMNS の開始桁が生成物に存在する", () => {
    const starts = new Set(generated["DDS-PF"]);

    for (const [name, column] of Object.entries(DDS_COLUMNS)) {
      assert.ok(
        starts.has(column[0]),
        `${name} の開始桁 ${column[0]} が生成された桁定義に無い（生成物: ${[...starts].join(",")}）`
      );
    }
  });

  test("DDS_COLUMNS の終端が次の欄の直前で終わる", () => {
    const starts = [...generated["DDS-PF"]].sort((a, b) => a - b);

    for (const [name, column] of Object.entries(DDS_COLUMNS)) {
      const next = starts.find(start => start > column[0]);
      if (next === undefined) continue;
      assert.equal(
        column[1],
        next - 1,
        `${name} の終端が ${column[1]} だが、次の欄は ${next} 桁目から始まる`
      );
    }
  });
});
