# 調査: RPG方言(ILE / RPG III)対応の基盤整備

関連: requirement.md / issue #18

## 調査の問い

- Q1: 出力先スキーマ（プロンプター定義 JSON）の正は何か。rpg3 定義はどの型に準拠すべきか。
- Q2: 既存の loader（`loadForLanguage`）と桁解決（`positionResolver`）は現状どう動き、方言の次元をどこに差し込むか。
- Q3: `.rpgle` と `.rpg` は現状どう判定されるか（方言をどこから導出できるか）。
- Q4: **RPG III(RPG/400) の C 仕様書（演算仕様書）の正確な桁レイアウト**（原典直読・AGENTS.md 規約）。
- Q5: ILE C-spec と RPG III C-spec の桁差（なぜ方言分離が必要か）と、C-NEW 判定の方言依存。
- Q6: 後方互換のリスク（既存定義の移設・ワークスペース上書きパス）。

## 判明した事実

### F1: 出力先スキーマ（Q1）

- 正は `vscode-extension/src/prompter/types.ts`。`PrompterDefinition { keyword, description, help?, parameters[] }`、
  `ParameterDefinition` は `name/description/inputType/required` 必須＋ `sourceStart`/`sourceLength`（**1始まりの桁位置**）等。
- rpg3 定義もこの型に準拠する。桁は `sourceStart`(1始まり)/`sourceLength` で表現（既存 `C-SPEC.json` と同形式）。

### F2: loader の現状（Q2）

- `PrompterDefinitionLoader.loadForLanguage(language, workspaceFolder, context)`（`jsonDefinitions.ts:53`）。
  - `subDir = language === "rpg-fixed" ? "rpg" : "cl"`（`:58`）。
  - 既定: `resources/prompter/{subDir}/` を読む（`:61-67`）。
  - 上書き: ワークスペースの `.rpg-cl/{subDir}/` を読み、**keyword 単位でマージ**（`:84-98`）。
- → 方言は `subDir` に `rpg/{dialect}/` として差し込むのが自然（`resources/prompter/rpg/ile/`・`rpg/rpg3/`）。
  上書きパスも `.rpg-cl/rpg/{dialect}/` に対応させる。

### F3: positionResolver の現状（Q2）

- `resolvePosition(document, position)`（`positionResolver.ts:13`）→ `{language, keyword, ...}`。
- 仕様書コードは **6桁目**（`text.charAt(5)`、0始まり index 5）で判定（`:36`）。`D`→`D-SPEC`、`C`→C系（`:39-51`）。
- C 系は 7桁目以降（`text.slice(6)`）の先頭トークン＝opcode を見て、`cNewOpcodes`（EVAL/IF/…）なら `C-NEW`、
  でなければ `C-SPEC`（`:42-51`）。**この C-NEW 判定は ILE(RPG IV) 固有**（後述 F6）。
- `getLanguageId`（`:99`）は languageId（`rpg-fixed`/`cl`）または拡張子（`.rpgle`/`.clp`）で言語を決める。
  **`.rpg` は拡張子分岐に無い**（`:109` は `.rpgle` のみ）。

### F4: `.rpgle` と `.rpg` の現状判定（Q3）— 方言導出の要点

- `package.json` では `.rpgle` と `.rpg` の**両方が languageId `rpg-fixed`**（#4 で `.rpg` を同居追加済み）。
- そのため `getLanguageId` は `.rpg` を languageId 経由で `rpg-fixed` と判定する（拡張子分岐に頼らず通る）。
- **帰結（重要）**: languageId は両者で同一なので、**方言は languageId からは導出できない**。
  方言判定は **ファイル拡張子（`uri.fsPath`：`.rpgle`→ile / `.rpg`→rpg3）から行う**必要がある。曖昧な `.rpg` 運用向けに設定で上書き。

### F5: RPG III(RPG/400) C 仕様書の桁レイアウト（Q4）— 原典照合済み

固定長フォーマットリファレンス（RPG II/III 演算仕様書フォーム）を直読。独立2ページで相互裏付け。

| 項目 | 桁位置 | 備考 |
|------|--------|------|
| 仕様書コード（Form Type, `C`） | 6 | 全 RPG 仕様書共通（ILE 版 doc も 6桁目=仕様書コード） |
| 制御レベル（Control Level） | 7-8 | L0-L9/LR/SR/AN/OR |
| 条件指標（Conditioning Indicators） | 9-17 | 否定 9/12/15、指標 10-11・13-14・16-17 |
| **Factor 1** | **18-27** | 10桁 |
| **Operation（opcode）** | **28-32** | 5桁 |
| **Factor 2** | **33-42** | 10桁 |
| **Result Field** | **43-48** | 6桁（RPG III のフィールド名は最大6文字） |
| Field Length | 49-51 | |
| Decimal Positions | 52 | |
| Half Adjust | 53 | |
| Resulting Indicators | 54-59 | +:54-55 / −:56-57 / 0:58-59 |
| Comments | 60-74 | （以降はプログラム識別欄） |

裏付け: rpg006（フルチャート: Factor1 18-27 / Op 28-32 / Factor2 33-42 / Result 43-48 / Len 49-51 / Dec 52 /
Half 53 / 結果指標 54-59）と rpg007（アンカー: Op 28-30、Dec 52、Half 53、結果指標 54-59、条件指標 7-17）が一致。
桁が 52/53/54-59 で一致することは、上流の Factor1/Op/Factor2/Result/Len の桁を数学的に固定する。

### F6: ILE vs RPG III の桁差（Q5）— 方言分離が必要な理由

既存 ILE `C-SPEC.json`（RPG IV）の桁と RPG III は**全く異なる**:

| 項目 | RPG III(F5) | ILE/RPG IV（既存 C-SPEC.json） |
|------|------------|------------------------------|
| Factor 1 | 18-27（10） | 12-25（14） sourceStart:12,len:14 |
| Operation | 28-32（5） | 26-35（10） sourceStart:26,len:10 |
| Factor 2 | 33-42（10） | 36-49（14） sourceStart:36,len:14 |
| Result | 43-48（6） | 50-63（14） sourceStart:50,len:14 |

- フィールド名長も RPG III=6 / ILE=14（ILE doc「従来は6文字」と整合）。同一定義では両立不可 → 方言分離は妥当。
- **C-NEW 判定は ILE 固有**: `EVAL/IF/ELSEIF/…` は ILE(RPG IV) の自由形演算系。RPG III に EVAL 等は無いため、
  **rpg3 では `C`→`C-SPEC` 一択**（C-NEW へ分岐させない）。`initialValues.ts:54` の `keyword === "C-NEW"` 分岐も
  rpg3 では発火しない（keyword が C-SPEC のため）。

### F7: 呼出側の配線（Q2）

- `showPrompter.ts:52` `resolvePosition` → `:63` `loadForLanguage(resolved.language,…)` → `:78` `keyword` 一致で定義選択。
  方言を通すには **resolvePosition と loadForLanguage の両方に dialect を渡し、showPrompter が受け渡す**必要がある。

## 影響範囲

```mermaid
flowchart TD
  ext[".rpgle / .rpg（拡張子）"] -->|方言判定 NEW| dia{{dialect: ile / rpg3}}
  dia --> rp[positionResolver.resolvePosition]
  dia --> ld[jsonDefinitions.loadForLanguage]
  rp -->|language, keyword, (dialect)| sp[showPrompter]
  ld -->|resources/prompter/rpg/&#123;dialect&#125;/| sp
  sp --> def[definition by keyword]
  subgraph 移設
    ile["rpg/ile/ : D/C/C-NEW/H-SPEC（既存4件）"]
    rpg3["rpg/rpg3/ : C-SPEC（最小1件・原典照合）"]
  end
  ld -.-> ile
  ld -.-> rpg3
```

- `package.json`: 言語登録は変更不要（`.rpgle`/`.rpg` は既に `rpg-fixed` 同居）。方言は languageId と別次元。
- `types.ts`: 方言型（例 `Dialect = "ile" | "rpg3"`）を追加。`LanguageId` とは直交。
- `jsonDefinitions.ts`: `loadForLanguage` に dialect を追加し `rpg/{dialect}/`＋`.rpg-cl/rpg/{dialect}/` を読む。
- `positionResolver.ts`: 拡張子から dialect 導出（+設定上書き）。`ResolvedPosition` に dialect。rpg3 は C→C-SPEC 固定。
- `showPrompter.ts`: dialect を resolve→load へ受け渡し。
- `resources/prompter/rpg/`: 既存4件を `ile/` へ移設、`rpg3/C-SPEC.json` を新規追加。
- `.aidev/backlog/rpg-spec.md`: ILE スコープ明記＋RPG III 用バックログ枠。

## 実現性 / リスク

- **実現可能**。方言は languageId 非依存の新次元として、拡張子判定＋ディレクトリ規約で実装できる。
- **後方互換リスク（要 spec 判断）**:
  - 既存4定義を `rpg/ile/` へ移設すると、**既存のワークスペース上書き `.rpg-cl/rpg/`（dialect 無し）が読まれなくなる**。
    → 移行措置（旧パスもフォールバックで読む / リリースノートで告知）を spec で決める。
  - `.rpg` は現状 ILE 定義で動いていた可能性（languageId rpg-fixed 経由）。本対応で `.rpg`→rpg3 に切替わるため、
    `.rpg` を ILE として使っていた利用者向けに**設定上書き**（rpg3→ile）を必ず提供する。
- **原典 doc の範囲**: フル RPG III リファレンス doc は別 issue（requirement のスコープ外）。本作業では F5 の C-spec 桁の
  照合根拠を本 research.md に残すことで AGENTS.md の照合要件を満たす（最小1定義に必要な範囲）。

## spec への申し送り

1. **方言は拡張子から導出**（languageId 不可。F4）。`.rpgle`→ile / `.rpg`→rpg3、設定で上書き可能に。
2. **設定キーの設計**（名前・粒度: ワークスペース/言語/ファイル単位）を決める。既存 namespace は `rpgClSupport`。
3. **loader のパス規約**: `resources/prompter/rpg/{dialect}/` ＋上書き `.rpg-cl/rpg/{dialect}/`。
   旧 `.rpg-cl/rpg/` 上書きの**後方互換フォールバック**の要否を決める。
4. **`ResolvedPosition` に dialect を追加**するか、呼出側で受け渡すか（F7）。
5. **rpg3 は C→C-SPEC 固定**（C-NEW 判定を rpg3 に波及させない。F6）。
6. **rpg3 最小1定義 = C-SPEC.json**: F5 の桁（OPCODE 28-32 / FACTOR1 18-27 / FACTOR2 33-42 / RESULT 43-48、
   必要なら COMMENT 60-74）で作成。`types.ts` の `sourceStart`(1始まり)/`sourceLength` に対応付け。
7. **既存4定義の `ile/` 移設**と `loadForLanguage` 既定パスの追従。
8. バックログ（`rpg-spec.md`）の ILE スコープ明記＋RPG III 枠。

## 参照（原典・grounded）

- RPG 演算仕様書フォームの桁（固定長フォーマットリファレンス）:
  - [RPG Tutorial rpg006「Calculation Specifications」](https://www.jaymoseley.com/hercules/rpgtutor/rpg006.htm)（フルチャート）
  - [RPG Tutorial rpg007「selected calculation operations」](https://www.jaymoseley.com/hercules/rpgtutor/rpg007.htm)（桁アンカー）
  - IBM 原典: [RPG/400 Reference（IBM, SC09-1817 系）](https://www.ibm.com/docs/SSAE4W_9.6.0/com.ibm.etools.iseries.langref.doc/evferlsh02.htm)（参照可能なら正として優先。今回は 403 のため上記固定長リファレンスで照合）
- 既存実装: `vscode-extension/src/prompter/{types.ts,jsonDefinitions.ts,positionResolver.ts}` / `resources/prompter/rpg/C-SPEC.json`
- ILE 桁: `docs/ILE_RPG_Fixed_Format_Reference.md`
