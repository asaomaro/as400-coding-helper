# 計画: RPG固定長仕様書のプロンプター定義生成・検証 支援skill（rpg-spec-def）

## 実装方針

spec を 2 つの成果物に分けて作る：(A) `rpg-spec-def` skill 本体（SKILL.md）、(B) 機能実証としての
ドッグフード生成（F-SPEC/ILE）＋ backlog 反映。`cl-command-def` を骨格に流用し、RPG 固有差分
（方言非対称・enum=dropdown・positional/keyword 2系統）を上書きする。検証（原典照合）は主Eが実施。

## 作業順序と依存関係

1. **skill 本体 SKILL.md を作成**（依存: なし）。frontmatter＋出力先/スキーマ＋原典参照（dialect 非対称）
   ＋マッピング規約＋手順＋I/O 行種の扱い＋aidev 連携。spec の該当節をそのまま実装基準にする。
2. **ドッグフード F-SPEC/ILE を生成**（依存: 1）。skill の手順に沿って `rpg/ile/F-SPEC.json` を作る。
   桁は research F3（原典 L159-171）を正にする。
3. **F-SPEC を原典照合**（依存: 2・主E実施）。`docs/ILE_RPG_Fixed_Format_Reference.md` の F 桁位置表と
   生成 JSON の `sourceStart`/`sourceLength`/`required`/`options` を機械的に突合。JSON パースも確認。
4. **backlog 反映**（依存: 3）。`.aidev/backlog/rpg-spec.md` の `F-SPEC` を `[x]` 化（根拠脚注）。I/O/P は据え置き。

```mermaid
flowchart LR
  T1[T1: SKILL.md] --> T2[T2: F-SPEC.json 生成]
  T2 --> T3[T3: 原典照合・JSON検証]
  T3 --> T4[T4: backlog 反映]
```

## リスク / 留意点

- **rpg3 原典不在**（research F4）: skill は rpg3 を扱えるが、ドッグフードは ile に限定（原典がローカルにあるため）。
  rpg3 経路は手順に「オンライン取得＋主E直読、取得不能なら保留」を明記するに留め、本作業で rpg3 生成はしない。
- **桁の独自補完禁止**（AGENTS.md）: F-SPEC の桁は原典の桁位置表のみを根拠にする。表に無い欄は足さない。
- **languageId 非波及**: JSON 追加と skill 追加のみ。拡張子関連付け・言語登録・診断に触れない。
- **enum 範囲**: ファイル・タイプ等の dropdown options は原典の定義値（I/O/U/C 等）に限定する。

## テスト方針（test 工程）

- 自動テストは無い領域のため、test は **(a) JSON パース可（node require）**、**(b) 既存 rpg 定義と同型**、
  **(c) 桁位置・required・options が原典（L159-171）と一致（主E直読照合）**、**(d) skill の手順が自己完結し
  research/coding から委譲可能な記述になっている**、の4点を受け入れ判定にする（#18 test と同方式）。
