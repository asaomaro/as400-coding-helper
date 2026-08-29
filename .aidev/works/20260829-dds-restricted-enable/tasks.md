# タスク: 確かめた欄だけを lint の対象にする

- [x] T1: 全空間（37 通り）を 1 回のコンパイルで流す
      対象: `verify/probe-exhaustive.mjs` / `probe-columns.mjs`
- [x] T2: 一括の読み取りを単独の判定と突き合わせて検算する
      対象: `verify/exhaustive-38.txt`（リストが 2 部構成である点）
- [x] T3: 原典に無いのに通った値を単独で確かめる（対照つき）
      対象: `verify/probe-confirm.mjs`
- [x] T4: `PROVEN_COMPLETE` を置き `restricted` を出す
      対象: `docs/origin/generate-dds-prompter.mjs`
- [x] T5: 規則を既定 ON にし、偽陽性を数える
      対象: `vscode-extension/src/lint/rules/index.ts`
- [x] T6: 既定の規則集合を固定しているテストを理由つきで更新する
      対象: `test/unit/lintRules.test.ts` `test/unit/lintCli.test.ts`
