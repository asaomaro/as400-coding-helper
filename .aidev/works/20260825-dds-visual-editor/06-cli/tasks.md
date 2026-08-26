# タスク: 06-cli

- [x] T1: CLI の骨格を作る。引数解析・ヘルプ・**終了コードの規約（0=OK / 1=使用法・入出力 / 2=パース失敗 / 3=検証違反）**。エージェントは終了コードで成否を判断するので、ここを曖昧にすると自動化に使えない
      対象: `packages/dds-cli/src/main.ts`（既存の骨格を実装で置き換え） / 根拠: spec「インターフェース / CLI」, 本 plan R4
- [x] T2: `dds parse <file> [--json]` を実装する。**出力に必ずアイテム ID を含める**（`patch` は ID で対象を指すため、ID が無いと CLI だけでは編集を始められない）。`--json` は機械可読、省略時は人が読める要約（依存: T1）
      対象: `packages/dds-cli/src/main.ts` / 根拠: 本 plan R2, requirement AC4
- [x] T3: `dds render <file> [--record NAME] [--all] [--rows N] [--cols N]` を実装する。`dds-core` の `renderAscii` をそのまま呼ぶ（依存: T1）
      対象: `packages/dds-cli/src/main.ts` / 参照: `packages/dds-core/src/render/ascii.ts` / 根拠: spec, requirement AC4
- [x] T4: `dds validate <file>` を実装する。診断を人が読める形で出し、**エラーがあれば終了コード 3**。警告だけなら 0（実機がコンパイルを通すため。spec D7）（依存: T1）
      対象: `packages/dds-cli/src/main.ts` / 根拠: spec D7, 本 plan R4
- [x] T5: `dds patch <file> --ops <file|-> [--write | --stdout]` を実装する。`--ops -` で標準入力から読めるようにする（エージェントが使う経路）。既定は `--stdout`（**破壊的操作は明示させる**）（依存: T1）
      対象: `packages/dds-cli/src/main.ts` / 参照: `packages/dds-core/src/patch/ops.ts` / 根拠: spec, requirement AC4
- [x] T6: `dds init <file> --record NAME [--rows N --cols N]` を実装する。**AC7（新規 DSPF を CLI だけで作る）に必要**。`PatchOp` は 4 種のまま保つ（様式の追加は L4＝後続 work）。**これは編集操作ではなく足場作りであり、AC4 の「同等」の対象外**である旨をヘルプと成果物に明記する（依存: T1）
      対象: `packages/dds-cli/src/main.ts` / 根拠: 本 plan「AC7 には現在の操作集合では足りない」
- [x] T7: Shift_JIS の書き戻しを決めて実装する（03 `decisions.md` D4 からの申し送り）。`iconv-lite` を CLI に足す / `TextDecoder` から逆引き表を作る / UTF-8 のみ対応で Shift_JIS 入力は警告して拒否する、のいずれか。**どれを採っても「黙って化けさせない」ことは守る**（依存: T5）
      対象: `packages/dds-cli/src/main.ts`・`packages/dds-cli/package.json` / 根拠: 03 `decisions.md` D4
- [x] T8: **AC4 を実証する**。CLI の `patch` の結果と、コアの `applyOps` を直接呼んだ結果が**同一**であることをテストで示す（同じ経路を通っている証明。「同等にする」のではなく「同等であることを示す」）（依存: T5）
      対象: `packages/dds-cli/test/parity.test.ts`（新規） / 根拠: requirement AC4, 本 plan「AC4 は構造で保証されている」
- [x] T9: **AC7 を実行して記録する**。要求文から出発し、**CLI のみ**で新規 DSPF を 1 本作り、`validate` を通し、実機でコンパイル・表示してキャプチャし、`dds render` の出力と一致させる。**詰まった箇所は「エージェントが自力で到達できなかった点」として記録する**——取り繕って手で補うと AC7 が検証している当のもの（表面の完全性）が測れない（依存: T6, T3）
      対象: `docs/dds-golden/ac7-transcript.md`（新規）・実機 `SR-OSAKA`（一時オブジェクト） / 根拠: requirement AC7, 本 plan R1
- [x] T10: CLI のテストを書く。各コマンドの終了コード・`parse --json` の内容・`patch` の `--write` / `--stdout` の違い・**対象行以外がバイト不変**であること・`init` の出力が `validate` を通ること（依存: T6, T7）
      対象: `packages/dds-cli/test/*.test.ts`（新規） / 根拠: 本 plan「テスト方針」
- [x] T11: **実機の後片付け**と、AC7 の手順の記録。T9 で作った一時オブジェクトをすべて削除する（依存: T9）
      対象: 実機 `SR-OSAKA` の `ASAOLIB`・`docs/dds-golden/README.md`（追記） / 根拠: 本 plan R5
