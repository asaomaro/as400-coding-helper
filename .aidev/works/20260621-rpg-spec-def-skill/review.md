# レビュー記録

## ラウンド 1（2026-06-21T06:10Z）

対象差分（製品）: `.claude/skills/rpg-spec-def/SKILL.md`（新規）/ `vscode-extension/resources/prompter/rpg/ile/F-SPEC.json`（新規）/ `.aidev/backlog/rpg-spec.md`（F-SPEC を `[x]`）。

### 観点別の所見

- **要件適合**: 受け入れ基準を満たす。skill 新設（`cl-command-def` 同形・dialect-aware・出力先/スキーマ正しい）、
  研究/コーディングからの委譲を frontmatter description に明記、F-SPEC ドッグフードで「skill 単独で生成・検証可能」を実証。
- **正確性**: F-SPEC の全11欄の桁位置が原典 `ILE_RPG_Fixed_Format_Reference.md` L159-171 と一致（主E直読照合・test (c)）。
  定義済み値（I/O/U/C・E/F・DISK/PRINTER/WORKSTN/SPECIAL/SEQ）も L177-204 と一致。KEYWORDS(44-80) と COMMENT(81-) に
  桁の重複なし。JSON パース可・types.ts 準拠（test (a)(b)）。ランタイム配線も確認（ruler→keyword→定義, test (e)）。
- **規約適合（AGENTS.md）**: 原典照合を**主エージェントが生テキスト直読**で実施（委譲せず）＝検証規約に準拠。
  languageId / 拡張子関連付け・言語登録に非波及（JSON＋md のみ・tsc クリーン）＝下流波及チェックの対象外を保証。
  sh/ps1 二本立ては本作業に無関係。
- **保守性**: 既存 `D-SPEC.json` とトップキー・パラメータ構造が一致。命名（`<FIELD>` 英大文字）・help 日本語・末尾 COMMENT の
  慣行を踏襲。skill は単一ファイルで自己完結。

### 指摘一覧

- [must] なし
- [should] なし
- [nit] `F-SPEC.json` の `FILENAME`/`FILETYPE` を `required:true` とした点は、原典に明示の「必須」列が無い中での
  ドメイン推論。ただし既存 `D-SPEC.json`（`NAME`/`LEN` を required）と同じ前例に沿うため**一貫性あり**＝許容。/ 対応: 許容（前例一貫）。
- [nit] `F-SPEC.json` の `COMMENT`(81-) は原典 F 節に明記が無いが、`D-SPEC.json` の慣行（81桁目以降の自由記述）に
  合わせたもの。`visibleByDefault:false` で既定非表示。/ 対応: 許容（リポジトリ慣行と一貫）。
- [nit] `ruler.ts` の specChar switch に `case "I"` が無く I 行が種別未分類（既存の状態）。後続の I-SPEC backlog 消化時に
  ruler 側の分類追加も要検討。本作業スコープ外（F-SPEC のみ）。/ 対応: test.md に観察として記録し後続へ申し送り。

### 申し送り（deliver の PR 本文へ）

- issue #19 の前提「RPG III リファレンスは #18 で追加済み」は事実と異なり、**フル RPG III 原典 doc はリポジトリに不在**
  （decisions D2 / research F4）。skill は dialect 非対称（ile=ローカル直読 / rpg3=オンライン取得＋主E直読・未到達なら保留）で
  対処済み。rpg3 多仕様の消化は別途オンライン原典が前提となる点を PR の既知の制約に記載する。
- 環境不足の skip: ユニット/結合テスト未実行（runner 未設定）＝未検証 surface（test.md）。PR の既知の制約に記載する。

判定: **must/should なし（nit のみ）** → review 通過。差分は小さいが autonomous 既定に従い walkthrough を実施してから deliver へ。
