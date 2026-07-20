# 要件: DDS と .cmd のアウトライン表示（DocumentSymbolProvider）

## 背景 / 課題

VSCode はアウトラインタブ・パンくず・`Ctrl+Shift+O`（シンボルへ移動）・ワークスペース記号検索を
`DocumentSymbolProvider` の登録によって提供する。IBM i のソースは固定長で、レコード様式や
パラメータの構造がコードの見た目からは追いにくいため、構造ビューの価値が特に高い。

一方、既存の拡張機能でどこまで賄えているかを確認した結果、**RPG と CL は既に十分に対応済み**で、
**DDS と `.cmd` だけが未対応**であることが分かった（各拡張のソースを直読して確認）。

| 対象 | アウトライン | 提供元 | 根拠 |
|---|---|---|---|
| RPGLE 固定長 | あり | vscode-rpgle | `language/ile/parser.ts` が `models/fixed` の `parseFLine`/`parseDLine`/`parseCLine`/`parsePLine`/`parseISpec` を `// Fixed format!` 分岐で呼ぶ |
| RPG III (`.rpg`/`.sqlrpg`) | あり | vscode-rpgle | `language/utils/fileRouting.ts` の `OPM_EXTENSIONS = ['.rpg','.sqlrpg']` で OPM パーサーへ振り分け、同じ `Cache` を返す |
| CL / CLLE | あり | IBM/vscode-clle | `language/src/module.ts` の `addStatement()` が `DCL`/`DCLF`/`SUBR` を処理 |
| **DDS 4種** | **なし** | — | どの拡張にも `DocumentSymbolProvider` が存在しない。`dspf-edit` は独自 TreeView のみ（DocumentSymbol 非提供）かつ DSPF 専用 |
| **`.cmd`** | **なし** | — | `vscode-clle` は `.cmd` にアクティベートするが `DCL`/`DCLF`/`SUBR` しかモデル化せず、アウトラインは空になる |

なお `codefori/vscode-ibmi` 本体には `DocumentSymbol` が一件も無い（言語知能は併載拡張に委譲されている）。

## 目的 / ゴール

DDS（PF/LF/DSPF/PRTF ほか）と `.cmd`（コマンド定義ソース）で、VSCode ネイティブの
アウトライン表示が機能する状態にする。独自 TreeView ではなく `DocumentSymbolProvider` を
実装することで、アウトラインタブに加えパンくず・シンボルへ移動・ワークスペース記号検索が
同時に得られる。

## スコープ

### 対象

- **DDS のアウトライン**（`.pf` / `.lf` / `.dspf` / `.prtf` / `.mnudds` / `.dds`）
  - レコード様式 → フィールド → キーの階層構造
- **`.cmd` のアウトライン**（コマンド定義ソース）
  - `CMD` → `PARM` → `ELEM` / `QUAL` の階層構造

### 対象外

- **RPG（固定長 / RPG III）のアウトライン** … vscode-rpgle が対応済み。作れば成熟した既存実装の
  重複になる（`docs/research/code-for-ibmi.md` の「差別化になる領域か」の判断に従う）
- **CL / CLLE のアウトライン** … IBM/vscode-clle が対応済み
- ワークスペース横断のシンボル提供（`WorkspaceSymbolProvider`）… 今回は文書単位に限る
- 独自 TreeView の追加 … ネイティブのアウトラインで代替する
- アウトラインから派生する編集操作（リネーム・並べ替え等）

## 機能要件

- 対象拡張子のソースを開くと、アウトラインタブに構造が表示される。
- DDS はレコード様式・フィールド・キーが階層で表示され、種別が区別できる。
- `.cmd` は `CMD`・`PARM`・`ELEM`・`QUAL` が階層で表示される。
- シンボルを選択すると該当行へ移動できる（範囲が正しく設定されている）。
- 構文的に不完全なソース・空ファイルでも例外を投げず、可能な範囲を返す。

## 非機能要件 / 制約

- **登録は languageId ではなく拡張子ベースで行う。** DDS も `.cmd` も
  `contributes.languages` に languageId を持たない（登録は `rpg-fixed`＝`.rpgle`/`.rpg` と
  `cl`＝`.clp` のみ）。`registerDocumentSymbolProvider` を languageId で登録すると
  13 拡張子中 3 つでしか効かず、issue #41 の F4 キーバインドと同じ「配線漏れ」になる。
  `src/utils/fileScope.ts` の `TARGET_EXTENSIONS` を単一の真実源として `DocumentSelector` を導出し、
  一致を機械検査で固定する（`verify-contributes.mjs` の方針に倣う）。
- **表示系と同じく languageId 非依存**とし、言語登録は広げない（AGENTS.md の
  「表示系の有効化は原則 languageId 非依存（拡張子判定）」に従う）。言語登録を広げると
  診断・キーバインド等の言語機能まで波及する。
- **桁定義は既存資産を使い回す。** DDS の桁は `generate-dds-columns.mjs` 由来の既存定義、
  仕様書・レベル判定は既存の実装（`specClassifier` / DDS キーワード補完のレベル判定）を用いる。
  作り直すと原典の書き方の揺れを二度踏む。ルーラー／プロンプターと桁が食い違わない担保にもなる。
- **DDS のレベルはその行だけでは決まらない。** キーワードだけの行は直前のレコード／フィールドの
  続きであり、注記行は飛ばす必要がある（既存のレベル判定と同じ規約に従う）。
- 拡張機能の起動は既存どおり `onStartupFinished` を維持し、アクティベーション条件を増やさない。
- ユニットテストは `vscode` スタブ（`test/support/vscode-stub.js`）で動かせる形にする。

## 完了条件 (受け入れ基準)

- [ ] `.pf` / `.lf` / `.dspf` / `.prtf` / `.mnudds` / `.dds` を開くとアウトラインに
      レコード様式 → フィールド → キーの階層が出る
- [ ] `.cmd` を開くとアウトラインに `CMD` → `PARM` → `ELEM`/`QUAL` の階層が出る
- [ ] 各シンボルを選択すると対応する行へジャンプする
- [ ] 登録に使う拡張子集合が `TARGET_EXTENSIONS` と一致していることを機械検査で担保している
      （片方だけ増えたら落ちる）
- [ ] RPG・CL のアウトラインを本 PJ 側で提供していない（既存拡張と二重にならない）
- [ ] 空ファイル・不完全なソースで例外を投げない
- [ ] `npm test` が通る

## 未確定事項 / 確認したいこと

- DDS の「キー」（17 桁目 `K`）をレコード様式の子として出すか、独立した階層として出すか。
  また `S`/`O`（選択・省略）、`J`（結合）、`H`（ヘルプ）をどう表現するか。
- `.cmd` の `DEP` / `PMTCTL` をアウトラインに含めるか（`PARM` の子か、`CMD` 直下か）。
- DDS のフィールド名が無い行（キーワード継続行）の扱い。
- 上記はいずれも既存資産（DDS 桁定義・レベル判定・`.cmd` プロンプター定義）の
  実装状況に依存するため、**research 工程で既存コードを確認してから spec で確定する**。
