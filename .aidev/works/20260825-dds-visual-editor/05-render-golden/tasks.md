# タスク: 05-render-golden

- [x] T2: 比較方針を決める。**レンダラはプレースホルダを描き、実機は実行時の値を描く**という食い違いをどう埋めるか。plan R1 の方針（**CL ドライバでフィールドに既知の値を書き込み、実機に実際に描かせる**）で問題が無いか、実機で 1 本試して確かめる
      対象: 実機 `SR-OSAKA` の `ASAOLIB`（一時オブジェクト） / 根拠: 本 plan R1
- [x] T1: `render/ascii.ts` を実装する。**80 文字 × 24 行**のグリッドを作り、定数はリテラル、フィールドは型に応じたプレースホルダ（英数字→`X` / 数値→`9`）を置く。**全角は開始桁のセルに文字、次のセルは空白**（`get_screen` の形式に合わせる）。SO/SI と属性バイトのセルは空白のまま（依存: T2）
      対象: `packages/dds-core/src/render/ascii.ts`（新規） / 参照: `packages/dds-core/src/text/encoding.ts` / 根拠: 本 plan「出力契約」（実測で確定）
- [x] T3: ゴールデン採取用のフィクスチャ DDS を作る。**SBCS のみの様式**と**日本語定数を含む様式**の 2 本。属性バイトの前後 1 桁が見えるよう、定数とフィールドを 1 桁空けて隣接させる配置を含める（依存: T1）
      対象: `packages/dds-core/test/fixtures/golden-*.dspf`（新規） / 根拠: requirement AC5・AC6
- [x] T4: **CL ドライバを書く**。`DCLF` + フィールドへの値設定 + `SNDRCVF` で画面を表示し、キー入力で抜ける。DSPF 単体では画面を出せないため必須（**見積もりから落としやすい**）（依存: T3）
      対象: `packages/dds-core/test/fixtures/golden-driver.clp`（新規） / 参考: 実機 `ASAOLIB` の `GRIDCL` / `MSKCL` / `REVCL` / 根拠: 本 plan R2, spec D6
- [x] T5: 実機でコンパイル → 実行 → `get_screen` でキャプチャする。**採取したまま保存**（整形・トリムをしない）（依存: T4）
      対象: 実機 `SR-OSAKA`（一時オブジェクト） / 根拠: spec D6, 本 plan R4
- [x] T6: 採取したゴールデンを `test/golden/` にコミットする（依存: T5）
      対象: `packages/dds-core/test/golden/*.screen.txt`（新規） / 根拠: spec D6
- [x] T7: 比較テストを書く。`render/ascii` の出力とゴールデンが**文字単位で一致**すること。**不一致時に「何行目の何桁目がどう違うか」が分かる差分出力**にする（80×24 を丸ごと出しても原因が分からない）（依存: T6）
      対象: `packages/dds-core/test/golden.test.ts`（新規） / 根拠: requirement AC5・AC6, 本 plan「テスト方針」
- [x] T8: 採取手順を文書化する。実機の準備・コンパイル・実行・キャプチャ・後片付けを、**別の人／別のエージェントが再現できる**粒度で書く（依存: T5）
      対象: `docs/dds-golden/README.md`（新規） / 根拠: spec D6, 本 plan R5
- [x] T9: レンダラ単体のテストを書く（ゴールデン不要）。配置・プレースホルダ・全角の 2 セル表現・行の長さが常に 80 であること（依存: T1）
      対象: `packages/dds-core/test/render.test.ts`（新規） / 根拠: 本 plan「テスト方針」
- [x] T10: `render/ascii` を `dds-core` の公開 API として re-export する（依存: T1）
      対象: `packages/dds-core/src/index.ts` / 根拠: spec「対象範囲」
- [x] T11: **実機の後片付け**。作成した DSPF / CL プログラム / ソースメンバ / IFS ファイル / スプールをすべて削除し、元の状態に戻す（依存: T5）
      対象: 実機 `SR-OSAKA` の `ASAOLIB` / 根拠: 本 plan R3
