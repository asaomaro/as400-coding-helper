# タスク: PRTF 帳票の視覚編集（DBCS 対応）

全 21 タスク。**T1-T15 は vscode を使わない**（単体テストで固まる）。

## ① 原典と編集コード表

- [x] T1: `docs/origin/sources.mjs` に印刷装置ファイルの編集コード原典
      （`ssw_ibm_i_74/rzakd/os400edits.htm`）を足し、`fetch-origin.mjs` で取得して
      `manifest.yml` を更新する。日英とも取る。
      **受け入れ**: `docs/origin/dds/` に HTML が入り manifest に記録される
- [x] T2: `docs/origin/generate-dds-editcodes.mjs` を追加し、原典の早見表から
      `resources/completion/dds-editcodes.json` を生成する。
      コード → `{commas, decimalPoint, negativeSign, zeroBalance, suppressLeadingZero}`。
      **表を手で書かない**。
      **受け入**: `1`-`4` / `A`-`D` / `J`-`Q` / `W`-`Z` の 20 コードが入る／
      2 回生成しても差分ゼロ（依存: T1）
- [ ] T3: `docs/origin/verify-dds-editcodes.mjs` を追加し、**原典に現れるコードが
      漏れなく JSON にあること**を検査する。`npm run verify:defs` に足す。
      **受け入れ**: 検査が通る／JSON からコードを 1 つ削ると落ちる（依存: T2）

## ② core/dbcs.ts（振る舞い不変の移設＋新規）

- [ ] T4: `src/core/dbcs.ts` を新設し、`isDbcsCodePoint` を
      `language/dbcsShiftMarkers.ts` から移す。あちらは import に変える。
      **非 export・利用元 1 箇所**なので公開面は変わらない。
      **受け入れ**: 既存テストが通る／SOSI 表示の挙動が変わらない
- [ ] T5: `core/dbcs.ts` に `printWidth(text)` を実装する。
      DBCS の連なりごとに **SO(1) + 全角×2 + SI(1)** を足す。
      **受け入れ**: `'顧客一覧表'`=12 / `'ABC'`=3 / `'A顧客B'`=8 / 空文字=0 /
      DBCS が複数箇所に分かれる場合（依存: T4）

## ③ core/dds/editCode.ts

- [ ] T6: `src/core/dds/editCode.ts` に `editCodeAttributes(code)`（生成 JSON を読む）と
      `editedWidth(length, decimals, code, option)` を実装する。
      幅は**属性から導出**する（コンマの数・小数点・符号・`*` 充てん・浮動通貨記号）。
      `5`-`9` は `{kind:"unknown", reason:"user-defined"}`。
      35 桁目が `S`/ブランク以外なら `not-numeric`。
      **受け入れ**: 単体テスト（依存: T2）
- [ ] T7: **原典の 20 コードすべて**に単体テストを書く。
      **受け入れ**: 20 コード分の期待値がある／`5`-`9` が `unknown`／
      `*` 充てんと浮動通貨記号の分の桁が乗る（依存: T6）

## ④ core/dds/prtfLayout.ts（この作業の芯）

- [x] T8: **★リスク潰し**。レコード・レベルの `SPACEA`/`SPACEB`/`SKIPA`/`SKIPB` が
      「レコードの最後の項目の後（前）」に効くのか「各項目の前後」に効くのかを
      **原典で確定する**。結果を `decisions.md` に記録する。
      **受け入れ**: 原典の記述を引用して確定している（依存: なし。**T10 の前に必ず**）
- [ ] T9: `src/core/ddsLayout.ts` に PRTF の位置欄の分割
      （`positionRow: [39,41]` / `positionColumn: [42,44]`）を**追加する**。
      既存の `position: [39,44]` は残し、**既存利用元を変更しない**。
      **受け入れ**: 既存テストが通る
- [ ] T10: `src/core/dds/prtfLayout.ts` に**印刷カーソルによる行の解決**を実装する。
      1 走査。注記行・ブランク行は `ddsLayout` の判定を共有して飛ばす。
      位置欄に行があれば絶対、無ければカーソルの行。`SKIP*` は絶対、`SPACE*` は相対。
      **受け入れ**: T8 で確定した意味どおりに動く単体テスト（依存: T8, T9）
- [ ] T11: 幅の 3 経路の振り分けを実装する。
      定数→`printWidth` / 長さ欄→そのまま or `editedWidth` / `R`→`reference` /
      編集コード `5`-`9`→`user-defined-edit-code`。
      **受け入れ**: 各経路の単体テスト（依存: T5, T6, T10）
- [ ] T12: 重なり（`overlaps`）と紙面はみ出し（`overflows`）の検出を実装する。
      **幅不明の項目は重なり判定の対象外**。重なりは**エラーではなく警告**（原典）。
      行 255 超・桁 255 超も検出する。
      **受け入れ**: 単体テスト（依存: T11）
- [ ] T13: `CUSTRPT.prtf` に対する結合テストを書く。あわせて
      **行の解決を検証する小さなサンプル**を `docs/src/` に足す
      （実機未確認なので受け入れ基準には入れず、単体テストの材料とする）。
      **受け入れ**: `CUSTRPT.prtf` で行位置・桁位置・`'顧客一覧表'`=12 桁が期待どおり／
      `CUSTNO`/`CUSTNM`/`CUSTAM` が幅不明（`reference`）になる（依存: T12）

## ⑤ HTML 生成（純粋関数）

- [ ] T14: `src/language/prtfPreviewHtml.ts` に `PrtfLayout` → HTML の変換を実装する。
      桁は `ch` の整数倍で `position: absolute`、**箱の幅も計算値で固定**して
      `overflow: hidden`。ルーラーとオーバーフロー行（既定 60）の線を出す。
      CSP に対応する。**vscode を import しない**。
      **受け入れ**: 単体テスト（依存: T13）
- [ ] T15: 桁揃えのテストを書く。**フォントに依存しないこと**を、生成された
      HTML の `left` / `width` が `ch` の整数倍であることで確かめる。
      **受け入れ**: 全角を含む項目でも桁が計算値どおり（依存: T14）

## ⑥ WebView と書き戻し（vscode の殻）

- [ ] T16: `src/language/prtfPreview.ts` にコマンド `rpgClSupport.showPrtfPreview` を
      登録し、WebView を開く。**拡張子で判定**（`.prtf`）。
      設定 `rpgClSupport.prtf.pageLength`(66) / `.pageWidth`(132) を読む。
      **受け入れ**: `.prtf` で開き、それ以外では何もしない（依存: T14）
- [ ] T17: 文書変更に追従して再描画する。**WebView に配置状態を持たせない**
      （ソースを唯一の真実にする）。
      **受け入れ**: ソースを直接編集してもプレビューが追従する（依存: T16）
- [ ] T18: 書き戻しを実装する。**位置欄（39-44 桁）だけ**を置き換え、
      `applyChanges` と同じ流儀（`sourceStart`/`sourceLength` の範囲だけ `slice`）。
      行は 39-41 に右詰め、桁は 42-44 に右詰め。
      **元々位置欄が空だった項目は確認を求める**（絶対行を書くと意味が変わる）。
      `POSITION` キーワードの項目は移動不可。
      **受け入れ**: 位置欄以外の桁が 1 文字も変化しないテスト（依存: T17）
- [ ] T19: ソースの行と描画の項目の相互ジャンプを実装する。
      項目クリック→該当行へ、カーソル行→該当項目を強調。
      **受け入れ**: 手動確認（依存: T17）

## ⑦ 共存と登録

- [ ] T20: `package.json` にコマンド・設定を登録する。
      `verify-contributes.mjs` との整合を確認する（拡張子の発火条件）。
      **受け入れ**: `npm run verify` が通る（依存: T16）
- [ ] T21: **IBM i Renderer との共存を確認**する。両方を入れた状態で、
      互いのコマンド・プレビューが干渉しないこと。
      `docs/src/CHECKLIST.md` に手順を足す。
      **受け入れ**: 手動確認の結果を記録（依存: T20）
