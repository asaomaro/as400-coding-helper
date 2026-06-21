# 仕様: CLコマンド定義JSONの拡充（原典HTML→JSON定義化）

## 概要

`docs/origin/cl/<CMD>.html`（PR #42 で収集済みの IBM Documentation 原典・95件）を**正のソース**として、
未定義の CL コマンド **85件** のプロンプター定義 JSON を作成する。出力は
`vscode-extension/resources/prompter/cl/<CMD>.json`、スキーマは `vscode-extension/src/prompter/types.ts` の
`PrompterDefinition` / `ParameterDefinition`。あわせて `.aidev/backlog/cl.md` に85件を分類追記し、
`aidev-util-batch` による段階消化を可能にする。

## 設計方針

- **ソースはローカル原典 HTML（ネットワーク取得しない）**。PJ skill `cl-command-def` は本来 Playwright で
  IBM Documentation をライブ取得する手順だが、本作業では PR #42 が同等版（IBM i 7.4 / `ssw_ibm_i_74`）を
  `docs/origin/cl/` に保存済み。ローカル原典を使うことで 403/SPA 問題を回避し、再現性・出典固定（manifest.yml）
  の利点を得る。**取得方法のみ skill から差し替え、マッピング規約・検証規約は skill に従う**。
- **原典照合は主エージェントが直読**。`docs/origin/cl/<CMD>.html` からタグ除去でテキスト抽出し、
  「パラメーター要約表（キーワード／記述／選択項目／ノーツ）」と各パラメータ詳細節を読んで、
  パラメータ集合・必須/型・長さ・修飾・要素リスト・反復・定義済み値を機械的に突き合わせて確定する
  （AGENTS.md「開発時の検証規約」／protocol §2.6。サブエージェントに委譲しない）。
- **段階消化（batch）前提**。85件は規模・複雑度の幅が大きい（無パラメータの制御構造〜CHGJOB/CHGSPLFA
  のような巨大コマンド）。優先度順にカテゴリ分割し、本作業では優先バッチを実装、残りは backlog で追跡する
  （完了条件は「優先度の高いものから作成」＋「backlog に反映・追跡可能」を満たす）。

### テキスト抽出の指針（原典→生テキスト）

原典 HTML は IBM Documentation の描画済みページ（`<script>` 除去済み）。本文は以下で取り出せることを確認済み:

```
tags除去: <style>…</style> を除去 → 残りタグ除去 → &nbsp;/&gt;/&lt; を復元 → 連続空白圧縮
```

- 「パラメーター」見出し以降に **要約表**（`キーワード 記述 選択項目 ノーツ`）があり、各行に
  `必須/オプショナル, 定位置 N`・`単一値`・`その他の値: 要素リスト`・`名前`等の型情報が並ぶ。
- その後に各パラメータの**詳細節**（定義済み値の意味・既定値）が続く。両方を照合に用いる。
- パラメータを持たないコマンド（例: ELSE / ENDDO / ENDPGM / OTHERWISE 等）は要約表が無い＝`parameters: []`。

## 対象範囲

- 追加: `vscode-extension/resources/prompter/cl/<CMD>.json`（本バッチで作成する各コマンド）。
- 追加/更新: `.aidev/backlog/cl.md`（未定義85件を分類追記、消化状態 `[ ]`/`[x]` で追跡）。
- 追加: `.aidev/works/20260621-cl-defs-expand/decisions.md`（取得方法の差し替え・スコープ線引きの記録）。
- 任意: 構造検証スクリプト（全 `cl/*.json` がスキーマ適合・パース可能かを一括チェック。`scripts/` 等）。
- **変更しない**: `src/prompter/*`（ロード/レンダリング基盤）、`package.json` の `contributes`/`languages`/
  `activationEvents`、`fileScope.ts`、言語登録。定義データの追加のみで languageId 波及を起こさない（AGENTS.md）。

## 未定義85件の分類（優先度カテゴリ）

| # | カテゴリ | コマンド | 規模傾向 |
|---|---|---|---|
| P1 | 制御構造（CL論理） | PGM, ENDPGM, IF, ELSE, DO, ENDDO, DOWHILE, DOUNTIL, DOFOR, SELECT, WHEN, OTHERWISE, ENDSELECT, GOTO, ITERATE, LEAVE, RETURN, SUBR, ENDSUBR, CALLSUBR, CALLPRC | 小（無〜数パラメータ） |
| P2 | メッセージ | SNDMSG, SNDUSRMSG, SNDRPY, RMVMSG, RTVMSG | 中 |
| P3 | データ域 | CRTDTAARA, CHGDTAARA, RTVDTAARA, DLTDTAARA | 中 |
| P4 | ファイル/メンバ/DB | ADDPFM, CLRPFM, RGZPFM, RMVM, CPYF, OVRDBF, OPNQRYF, CHGPF, CRTPF, CRTLF, CRTSRCPF, DCLF, RCVF, SNDF, OVRPRTF, CLOF | 中〜大 |
| P5 | オブジェクト/権限 | ALCOBJ, DLCOBJ, CHGOBJD, RTVOBJD, DSPOBJD, MOVOBJ, RNMOBJ, CRTDUPOBJ, DLTOBJ, CHKOBJ, GRTOBJAUT, RVKOBJAUT, SAVOBJ, RSTOBJ | 中 |
| P6 | ライブラリ | ADDLIBLE, CRTLIB, DLTLIB | 小〜中 |
| P7 | ジョブ | CHGJOB, SBMJOB, WRKJOB, WRKACTJOB, DLYJOB | 中〜大 |
| P8 | スプール | CHGSPLFA, CPYSPLF, DLTSPLF, HLDSPLF, RLSSPLF, WRKOUTQ | 中 |
| P9 | 作成（PGM/ファイル） | CRTBNDCL, CRTBNDRPG, CRTCLPGM, CRTPGM, CRTRPGMOD, CRTDSPF, CRTPRTF | 大 |
| P10 | 検索/表示 | RTVSYSVAL, RTVMBRD, DSPFD, DSPFFD | 中 |

> 優先度根拠: 上位ほど CLP での出現頻度が高くパラメータが単純で、確実に origin 照合できる。制御構造(P1)は
> CLP 必須構文かつ無/少パラメータで一括の整合性が取りやすいため最優先。

### 本作業のスコープ線引き（plan で確定）

- **必須**: 85件すべてを `.aidev/backlog/cl.md` に分類追記（完了条件③）。
- **本 PR で実装**: 少なくとも **P1（制御構造）を全件**、原典照合済みで作成（完了条件①②）。余力に応じて
  P2…と上位カテゴリへ広げる。本 PR で未着手のカテゴリは backlog `[ ]` のまま残し、後続 `aidev-util-batch` で消化。
- この線引き（全85件を1PRに詰めない）は decisions.md に記録する。

## インターフェース / データ構造（マッピング規約）

`src/prompter/types.ts` の `PrompterDefinition` に従う。`cl-command-def` skill のマッピング表を適用:

| 原典 | JSON |
|---|---|
| コマンド（日本語名＋CMD） | トップ `keyword`=CMD, `description`=日本語名, `help`=用途要約 |
| パラメータのキーワード | `name` |
| 必須(REQ) / オプショナル | `required: true|false` |
| 修飾名（LIB/OBJ 等）・要素リスト(ELEM) | `inputType: "group"` ＋ `children[]` |
| 複数指定可（最大 N 値） | `maxOccurrences: N` |
| 文字型 CHAR/NAME | `inputType: "text"`, `attributes.characterSet`（英大文字名なら `upper`）, `attributes.maxLength` |
| 数値型 | `inputType: "number"`（必要に応じ `attributes.numericOnly`） |
| **定義済み値が固定選択肢のみ** | `inputType: "dropdown"` ＋ `options[{label,value}]` |
| 定義済み値＋自由入力が混在 | `inputType: "text"` ＋ `help` に列挙、代表値を `placeholder` |
| パラメータ説明 | `description`（短） ＋ `help`（詳細・日本語） |

- 既定値が原典にあれば `defaultValue` に設定（例: `*LAST`, `*LIBL`）。
- 既存10件（特に CALL.json）の構造・命名・日本語トーンに合わせる。
- `sourceStart`/`sourceLength`（RPG 固定長専用）は CL では使わない。

## 振る舞いの詳細 / エッジケース

- **無パラメータコマンド**（ELSE/ENDDO/ENDIF系/OTHERWISE/ENDSELECT/ENDPGM/ENDSUBR/RETURN/ITERATE/LEAVE 等）は
  `parameters: []`。プロンプターはキーワードのみ提示する。
- **論理式パラメータ**（IF/DOWHILE/DOUNTIL の `COND`、WHEN の `COND`）は自由入力 → `inputType: "text"`、
  `help` に「論理式を指定」。`THEN`（IF/WHEN）も自由入力（コマンド/DOグループ）→ `text`。
- **修飾名・要素リストのネスト**は `group`＋`children`。さらに children 内が修飾名なら再帰的に group を許容
  （スキーマ上 `children` は再帰可）。
- **反復**（複数値・最大N）は `maxOccurrences: N`。N が原典で「制限なし/多数」の場合は妥当な上限（既存
  CALL.json の PARM=5 を参考に）を置き、help に原典の上限を明記する。
- 定義済み値が**多数**で選択肢化が冗長な場合は skill 規約どおり `text`＋help 列挙（スキーマに enum 欄が無い
  ため）。固定少数なら dropdown を優先。

## ドメイン固有の考慮

- **languageId 波及（AGENTS.md）**: 本作業は定義データ追加のみで `contributes.languages`/`activationEvents`/
  言語登録に触れない。`.cmd` への CL 診断同居等の波及は発生しない（変更しないことで担保）。
- **原典準拠の検証規約**: 正誤確定は主エージェントが原典生テキストを直読し機械 diff。委譲しない。
- **既存10件は対象外**（差分の新規85件のみ）。既存定義の原典再検証は本作業のスコープ外（必要なら別 issue）。

## エラー処理 / 異常系

- ローダー（`jsonDefinitionPaths`→`loadFromDirectory`）は不正 JSON を console ログのみでスキップする。
  ＝壊れた定義は「F4 候補に出ない」形で劣化する。よって**全 `cl/*.json` のパース可否とスキーマ適合を
  CI/ローカルで一括検証**し、壊れた定義を deliver させない（test 工程の硬いゲート）。
- 原典に該当パラメータの記載が曖昧/欠落のときは、推測で埋めず原典の文言に忠実にし、判断を decisions.md に残す。
- 原典 HTML が存在しないコマンドは対象外（85件は全件 origin 済みを確認済み）。

## 受け入れ基準との対応

| requirement 完了条件 | 充足方法 |
|---|---|
| ① 優先度の高いコマンドから定義作成し F4 で機能 | P1 から作成。F4 機能性は「JSON がローダーでパース・スキーマ適合し、キーワード照合でロードされる」ことを構造検証＋既存 prompter unit テストで担保（headless で対話 F4 は不可のため、ロード可能性＝機能の代理指標とし、代表1件は手動 F4 スモークを推奨記録） |
| ② 原典と必須/型/長さ/桁/定義済み値が一致 | 主エージェントが `docs/origin/cl/<CMD>.html` を直読し各定義を機械 diff（test 工程で全実装分を照合） |
| ③ backlog に85件反映・追跡可能 | `.aidev/backlog/cl.md` に P1–P10 を分類追記、実装済みは `[x]`、未着手は `[ ]` で batch 追跡 |

## 検証（test 工程の具体）

1. **構造検証**: 追加した各 `cl/*.json` が `JSON.parse` 可能、かつ `PrompterDefinition` 形（`keyword`/`description`/
   `parameters[]`、各 `parameter` の必須キー・`inputType` 列挙値・`children`/`options` の整合）に適合。
   一括チェックを `node` スクリプトで実施（既存 `cl/*.json` も回帰対象に含めてよい）。
2. **原典 diff（主エージェント直読）**: 実装した各コマンドについて、原典のパラメータ集合・必須・型・
   定義済み値と JSON を突き合わせ、過不足・誤りがないこと。
3. **既存テストの非回帰**: `test/unit/prompterModel.test.ts` 等（ローダー/モデル）に影響しないこと
   （定義追加のみのため基盤は不変）。
4. 代表1件（例: IF or SNDMSG）の手動 F4 スモークは推奨（autonomous では記録に留め、必須ゲートは 1–3）。

## design 推奨判定（protocol §4.5 / autonomous 自律採否）

- 複数コンポーネント横断や新規アーキ判断は無く、既存スキーマ・既存定義パターン・確立済み skill 規約に
  そのまま乗る**データ整備作業**。インターフェースは `types.ts` で確定済み。
- → **design（任意）は不要**と判断し、plan へ進む。複雑さはカテゴリ分割（上表）で吸収する。
