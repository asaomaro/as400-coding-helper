# 決定記録

## D1: full で進める

- 背景: 着手時の三層判定。
- 決定: full（`aidev new` 既定）。
- 理由 / 代替案: 利用者が書く設定ファイルの書式（`testing.json`）という**外に見える表面**を新しく持つため、
  light の条件（公開 API・スキーマに触らない）を満たさない。
- 影響: 上流 3 工程を個別に書く。autonomous なので各工程で独立点検を記録する。

## D2: バインドの指定は IBM i Testing 互換の `testing.json` にする（ユーザー判断）

- 背景: 指定場所の候補は `testing.json`／テストソース内の注記／VS Code 設定。
- 決定: `testing.json`。テストファイルの配置（ソースメンバーへ展開）は変えない。IFS への展開は backlog。
- 理由 / 代替案: 書式を独自に作らずに済み、IBM i Testing と設定を共有できる。ただし IBM i Testing への
  差し替えは、言語登録の衝突（`vscode-rpgle`）とファイル配置（IFS／`*.test.rpgle`）の違いが残るので、
  互換は「設定の持ち越し」に留まることをユーザーに説明済み（2026-09-26 の対話）。
- 影響: 読み取りの規則（探す場所・合成）を IBM i Testing に合わせる（`api/config.ts` の `LocalConfigHandler`）。

## D3: research 工程は挟まない

- 背景: 前提となる外部仕様（`testing.json` の書式・探し方）がある。
- 決定: research を挟まず、requirements/design に一次資料の出所を書く。
- 理由: 必要な事実は着手前の対話の中で一次ソースから直読済み——
  `IBM/vscode-ibmi-testing` の `schemas/testing.json`（`bndSrvPgm` / `bndDir` は文字列の配列）、
  `api/config.ts`（最寄りを親へ遡る／`.vscode/testing.json`／`lodash.merge` で合成）、
  `api/runner.ts`（値をそのまま `RUCRTRPG` に渡す）。残る未確定（7.3 での `BNDDIR`）は実機 E2E で閉じる。
- 影響: 下記 D4・D5 の判断材料もこの直読に依る。

## D4: 修飾の無い名前は修飾しない（`tools/run-rpgunit.mjs` の `--bnd` と挙動を変える）

- 背景: `buildCreateTestCommand` は修飾の無い `bindServicePrograms` をテストのライブラリーで補っていた
  （`tools/run-rpgunit.mjs` の `--bnd` の移植）。IBM i Testing は `testing.json` の値をそのまま渡す。
- 決定: 修飾しない。CL にそのまま書き、`RUCRTRPG` の既定（`*LIBL`）で解決させる。大文字にだけする。
- 理由 / 代替案: 同じ `testing.json` が両方の拡張で同じ意味になること（D2 の目的）を優先する。
  テストのライブラリー・リストの 2 番目にテストのライブラリーが入るので、そこにあるサービスプログラムは
  これまでどおり見つかる。「テストのライブラリーで補う」を残すと、同じ設定が拡張ごとに違うオブジェクトを
  指しうる。`tools/run-rpgunit.mjs`（AI エージェント向け・変更しない）とは挙動が分かれる。
- 影響: 既存の単体テスト「BNDSRVPGM はライブラリー修飾の無い名前に library を補う」の期待値を変える。

## D5: 2 つの `testing.json` の合成はキー単位で置き換える（IBM i Testing と意図して変える）

- 背景: IBM i Testing は `lodash.merge` で合成し、配列は**要素ごと**に混ざる
  （`.vscode` の `[A,B]` と最寄りの `[C]` → `[C,B]`。`api/config.ts`）。
- 決定: `bndSrvPgm` / `bndDir` ごとに、最寄りにあれば配列ごと最寄りの値を採る。
- 理由 / 代替案: 要素ごとに混ぜる挙動は、利用者が「最寄りで上書きした」つもりでも古い値が残る。
  互換を優先して同じにする案もあるが、両方のファイルに同じキーを書く場合にしか差が出ず、
  そのときの結果は置き換えの方が予想どおりになる。
- 影響: 両方のファイルに同じキーを書いた場合だけ、IBM i Testing と結果が違いうる（README 等に書く場合は明記する）。

## D6: `testing.json` の検査は合成の前に各ファイルに行う／requirements の点検は上限で打ち切る

- 背景: requirements の独立点検 2 巡目で「上書きされる側の不正な値を咎めるか」が未定義と指摘された。
- 決定: 見つかった各ファイルを合成の前に検査する（上書きされる値の誤りも errored）。
- 理由: 壊れた設定を黙って残すと、最寄りの `testing.json` を消した途端に初めて壊れていることが分かる。
- 影響: requirements の独立点検は上限（2 巡）に達した。2 巡目の 5 件はすべて反映済みで、残った疑問は無い。

## D7: design の独立点検は 1 巡で閉じる／architecture は挟まない

- 背景: design の独立点検（委譲）で 7 件（should 4・nit 3）。
- 決定: 7 件とも該当箇所への追記・言い換えで反映し、2 巡目は行わない。architecture は挟まない。
- 理由: 修正は節の書き換えではなく局所的な補足（`BNDDIR` が効かない場合の分岐、概要の言い回し、AC4 の担当、
  最上位が非オブジェクトの扱い、検査順、出所 2 件、読み取り失敗の扱い）で、前後の記述を変えていない。
  architecture の 4 条件（protocol.md「4.5」）は、新規モジュール 1 つを既存の `src/testing/` に足すだけで
  依存の向きも責務分割も変えないので当たらない。
- 影響: 残る不確実性は実機での `BNDDIR`（E2E で閉じる）。

## D8: `BNDDIR` は 7.3 ＋ v6.0.2.r で効いた（未確定事項を閉じる）／対照は理由まで判定する

- 背景: requirements「未確定事項」と design の分岐（効かなければ `bndDir` を外す）。
- 決定: 分岐には入らない。実機 E2E（`dev/rpgunit-e2e.mjs` シナリオ 5）で `.vscode/testing.json` の
  `bndDir: ["E2EBND"]` が Passed になった。
- あわせて、対照（シナリオ 3: `testing.json` 無し）が**正しい理由で落ちているか**を判定に加えた。
  最初の実装は Errored になったことしか見ておらず、画面に出ていたのはジョブログの先頭（どのファイルでも
  出る行）だけだった。本文のエディターは表示中の行しか DOM に出ないため、末尾へ移って読み直し、
  `CPD5D02: 記号'E2EADD'の定義が見つからない。` を確認した（パネルの最大化は効かなかった）。
- 影響: E2E は 13 項目。対照が別の理由で落ちると `✗` になる。
