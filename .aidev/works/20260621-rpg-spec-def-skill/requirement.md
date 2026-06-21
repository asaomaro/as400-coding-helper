# 要件: RPG固定長仕様書のプロンプター定義生成・検証 支援skill（rpg-spec-def）

> 出典: GitHub issue #19（aidev-propose 由来 / retro: cl-defs-batch の製品・コード提案）。
> 依存: #18「RPG方言の基盤整備」（works `20260620-rpg-dialect-split` / deliver 承認済み＝充足）。

## 背景 / 課題

- `.aidev/backlog/rpg-spec.md` の未処理項目（**F/I/O/P-SPEC** ほか）を `aidev-util-batch` で消化するには、
  CL の `cl-command-def` に相当する **RPG 固定長仕様書専用の支援 skill** が必要。現状そのような skill が無く、
  4 件の backlog が依存待ち（`needs: #19`）で着手できない。
- CL 定義は `cl-command-def` への委譲で短時間・高精度に生成できた実績がある（cl-defs-batch）。RPG 側にも
  同形の「原典準拠で生成・検証する」手段を用意し、定義生成の品質と速度を揃える。
- #18 で RPG 方言分割の基盤（出力先 `resources/prompter/rpg/{ile,rpg3}/`、既存 H/C/D-SPEC 等）が整ったため、
  方言別に正しい桁位置で定義を生成できる前提が揃った。

## 目的 / ゴール

- RPG 固定長仕様書（H/F/D/I/C/O/E/L/P 等、方言で差異あり）の**プロンプター定義 JSON を、固定長リファレンスの
  原典を正として生成・検証できる PJ skill**（`cl-command-def` と同形）を新設する。
- これにより `aidev-util-batch` が `rpg-spec`（方言別）backlog を消化でき、F/I/O/P-SPEC 等の定義生成の
  依存（#19）が解消される。

## スコープ

### 対象
- RPG 固定長仕様書のプロンプター定義 JSON を**生成・検証する PJ skill** の新設（`.claude/skills/<name>/SKILL.md` ＋必要な補助）。
  - **正の取得元（原典）**: `docs/ILE_RPG_Fixed_Format_Reference.md` ／ RPG III 固定長リファレンス（#18 追加分。所在は research で確定）／ 既存定義（実例）。
  - **スキーマの正**: `vscode-extension/src/prompter/types.ts`（`PrompterDefinition` / `ParameterDefinition`）。
  - **出力先**: `vscode-extension/resources/prompter/rpg/{dialect}/<X>-SPEC.json`（dialect = `ile` / `rpg3`）。
  - 桁位置 `sourceStart` / `sourceLength` を**仕様種別・方言ごとに正しく**設定する（固定長の書き戻しに使用）。
- aidev ワークフローの research / coding 工程から**委譲可能**にする（description に委譲トリガを明記、`cl-command-def` と同形）。

### 対象外
- F/I/O/P-SPEC など個別定義 JSON の実生成そのもの（本 skill を使う後続作業＝backlog 消化で行う。本作業は skill の新設に限る）。
- free format（自由記述）対応（PJ 方針どおり固定長のみ）。
- プロンプター本体（拡張機能のランタイム）の改修。
- CL 用 `cl-command-def` の改修。

## 機能要件

- skill 単独で、指定した RPG 仕様種別（例 F-SPEC）×方言（例 ile）の定義 JSON を**生成**できる。
- 生成物が `types.ts` のスキーマに準拠する（`inputType` / `attributes` / `group`/`children` / `maxOccurrences` 等の使い分けを含む）。
- 各パラメータの桁位置（`sourceStart` / `sourceLength`）が、当該仕様種別・方言の固定長フォーマットと一致する。
- **正誤の確定は固定長リファレンスの生テキストを直読・機械照合**で行う方針を skill 手順に内在させる
  （AGENTS.md「開発時の検証規約」／protocol §2.6 準拠＝原典照合はサブ委譲しない）。
- 古い命令と新しい命令で記述位置が異なるケース（例: C-Spec の旧 MOVEL と新 EVAL）に倣い、必要なら
  方言・命令世代ごとに別定義として扱える（既存 `ile/C-SPEC.json` と `C-NEW.json`、`rpg3/C-SPEC.json` の前例に整合）。

## 非機能要件 / 制約

- TypeScript（拡張機能本体）には手を入れない。skill は Markdown 手順＋（必要なら）軽量補助のみ。
- IBM 原典が必要な場合の取得方法は `cl-command-def` の前例（Playwright + headless 描画取得、WebFetch/curl 不可）に倣う。
  ただし RPG は**ローカルの固定長リファレンス（docs/）が一次資料**として優先利用できる。
- 既存の RPG 定義（`rpg/ile`・`rpg/rpg3`）の構造・命名と一貫させる（後続の batch 消化が成立するように）。
- languageId / 拡張子関連付けには触れない（表示系・言語登録への波及なし）。

## 完了条件 (受け入れ基準)

- [ ] skill 単独で F-SPEC 等の RPG 仕様定義 JSON を**生成・検証**できる（手順が自己完結している）。
- [ ] 生成定義が `types.ts` 準拠で、桁位置が固定長リファレンスと一致する（原典直読で照合した根拠を示せる）。
- [ ] `aidev-util-batch` が `rpg-spec`（方言別 backlog）を消化できる形になっている（research/coding から委譲可能）。
- [ ] skill の description / 配置が PJ 規約（`cl-command-def` と同形、委譲トリガ明記）に沿っている。

## 未確定事項 / 確認したいこと（research で解消）

- **RPG III 固定長リファレンスの所在**：issue は「#18 で追加」とするが `docs/` 内に該当ファイルが見当たらない。
  原典（ile / rpg3 双方）の実体と参照経路を research で確定する。
- **対象仕様種別の確定範囲**：backlog の当面の対象は F/I/O/P-SPEC。H/C/D は #18 で既存。E/L 等を skill の
  生成対象に含めるか（少なくとも生成可能な汎用手順にするか）を research/spec で確定する。
- **方言差の具体**：同一仕様種別での ile / rpg3 の桁位置・項目差を、既存 `rpg/{ile,rpg3}` 定義と原典から確認する。
- これらは「未検証の既存挙動・既存リファレンスへの依存」「横断的な影響（複数仕様種別×方言）」に該当するため、
  **research（任意工程）の実施を推奨**する。
