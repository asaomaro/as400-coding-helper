# タスク: DDS / .cmd の DocumentSymbolProvider

- [x] T1: `src/utils/fileScope.ts` に用途別の派生 const（`DDS_EXTENSIONS` / `CMD_EXTENSIONS` /
      `RPG_EXTENSIONS` / `CL_EXTENSIONS`）と `toGlobPattern` / `toDocumentSelector` を追加し、
      `TARGET_EXTENSIONS` をそれらの合成として定義し直す（値は現行13個と同一に保つ）
- [x] T2: `test/support/vscode-stub.js` に `DocumentSymbol`（`children` 初期化込み）・`SymbolKind`・
      `Range` の4引数オーバーロードを追加する。既存の `Range`(2引数) の挙動は変えない。
      追加後に `npm test` を回し、既存テストが全て通ることを先に確認する（依存: なし）
- [x] T3: `src/language/outlineTypes.ts` を追加。`OutlineNode` / `OutlineKind` 型と、
      `OutlineKind` → `vscode.SymbolKind` 対応表、`toDocumentSymbols` アダプタを実装する（依存: T1）
- [x] T4: `outlineTypes` のテストを追加。`toDocumentSymbols` が kind を正しく写像し、
      `children` を再帰的に変換することを確認する（依存: T2, T3）
- [x] T5: `src/language/ddsSymbols.ts` に `buildDdsOutline(lineAt, lineCount, ddsType)` を実装。
      注記行スキップ・17桁目の種別判定（既存 `resolveDdsLevel` を使用）・名前欄19-28桁・
      detail の組み立て・range/selectionRange を spec のとおり実装する（依存: T3）
- [x] T6: `test/unit/outlineDds.test.ts` を追加。`docs/src/` の `CUSTMST.pf` / `CUSTLF1.lf` /
      `CUSTMNT.dspf` / `CUSTRPT.prtf` を実ファイルとして読み、木の形・detail・
      `selectionRange ⊆ range` を assert する。異常系（空・注記のみ・途中で切れた行）も含める（依存: T2, T5）
- [x] T7: `src/language/cmdSymbols.ts` に `buildCmdOutline` を実装。`parseClCommand` /
      `joinContinuationLines` / `getLogicalCommandRange` を再利用し、CMD/PARM/DEP/PMTCTL を
      ルート直下、QUAL/ELEM を `TYPE(ラベル)` 参照で PARM の子に付ける2パス構成にする。
      解決できないグループはルート直下に出す（依存: T3）
- [x] T8: `test/unit/outlineCmd.test.ts` を追加。`docs/src/ADDCUST.cmd` を実ファイルとして読み、
      木の形（PARM CUST の下に QUAL 2件、PARM RANGE の下に ELEM 2件、DEP はルート直下）・
      継続行をまたぐ range・`selectionRange ⊆ range` を assert する。
      `CMD` 文が無い/`TYPE` が解決できない異常系も含める（依存: T2, T7）
- [x] T9: `src/language/registration.ts` に `registerDdsSymbols` / `registerCmdSymbols` を登録する。
      `activate()` → `registerLanguageFeatures()` → 本登録、の経路が繋がっていることを確認する
      （依存: T5, T7）
- [x] T10: `src/language/ddsKeywordCompletion.ts` と `src/language/rpgCompletion.ts` の手書き glob を
      T1 のヘルパー経由に乗せ替える。`.dds` が DDS キーワード補完の対象に入ることを確認する
      （既存ドリフトの解消）（依存: T1）
- [x] T11: `test/unit/contributesSideEffects.test.ts` に検査を追加。
      (a) 派生 const の合成が `TARGET_EXTENSIONS` と一致する、
      (b) アウトラインの selector に RPG / CL の拡張子が含まれない（既存拡張と二重にしない）
      （依存: T9, T10）
- [x] T12: `npm run compile` / `npm test` / `npm run verify` を通し、
      到達性（`activate()` からの登録経路）を名指しで辿った根拠を残す（依存: T11）

## 到達性の根拠（T12）

`activate()` からアウトラインが出るまでの経路を名指しで辿った:

1. `src/extension/extension.ts:5` `activate()` → `registerLanguageFeatures(context)`
2. `src/language/registration.ts` `registerLanguageFeatures()` →
   `context.subscriptions.push(registerDdsSymbols())` /
   `context.subscriptions.push(registerCmdSymbols())`
3. `src/language/ddsSymbols.ts` `registerDdsSymbols()` →
   `vscode.languages.registerDocumentSymbolProvider(toDocumentSelector(DDS_EXTENSIONS), provider)`
4. `src/utils/fileScope.ts` `toDocumentSelector()` → `**/*.{pf,lf,dspf,prtf,mnudds,dds}` の
   file / untitled 2 本
5. `activationEvents: ["onStartupFinished"]`（package.json）なので、対象ファイルを開く前に
   登録が済んでいる

この経路は `test/unit/outlineRegistration.test.ts` が**実際に登録された selector を捕まえて**
検査している（`toGlobPattern` を直接呼ぶだけのテストでは、登録側が手書き glob に戻っても
気付けないため）。

## 検証結果

- `npm run compile` … OK
- `npm test` … 122 passing（追加前は 72）
- `npm run verify` … 全 12 検証 OK（`verify-contributes.mjs` は対象拡張子 13 件のまま＝値が不変）
- 追加したテストが欠陥を捕まえることを確認済み:
  - DDS のキー(K)をフィールド扱いに戻す → 3 failing
  - `.cmd` の QUAL/ELEM グループ解決を無効化 → 3 failing
  - `ddsKeywordCompletion` の glob を手書きに戻す → 1 failing（`.dds` の取りこぼし）

## 判明した限界（過大主張しないための記録）

- **`.dds` は DDS キーワード補完では依然として機能しない**。`resolveDdsType` が
  `.dds` を PF/DSPF/PRTF のどれか判別できず `undefined` を返すため。
  selector に `.dds` が入ったのは前進だが、補完が出るようになったわけではない。
  一方**アウトラインは `.dds` でも動く**（構造が種別共通で、種別判定を必要としないため）。
