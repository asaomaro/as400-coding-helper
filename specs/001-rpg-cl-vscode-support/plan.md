# Implementation Plan: RPG/CL Development Support Tool for VS Code

**Branch**: `001-rpg-cl-vscode-support` | **Date**: 2025-11-16 | **Spec**: `specs/001-rpg-cl-vscode-support/spec.md`
**Input**: Feature specification from `specs/001-rpg-cl-vscode-support/spec.md`

**Note**: This plan is generated and maintained by the `/speckit.plan` workflow for the RPG/CL VS Code extension feature.

## Summary

This feature delivers a VS Code extension that supports editing and prompting for AS400 / IBM i RPG (ILE RPG fixed-format only) and CL code.  
The extension provides fixed-format-aware display and editing, syntax support, and an F4-style prompter for parameter input.  
All functionality is scoped to local editing in VS Code; no direct IBM i / AS400 send, compile, or debug operations are performed in this feature.

## Technical Context

**Language/Version**: TypeScript (ESNext) targeting VS Code Extension Host (Node.js)  
**Primary Dependencies**: VS Code Extension API, VS Code WebView API, JSON ベースのプロンプター定義 (`.json`)、Web アセット (HTML/CSS/JavaScript) によるプロンプター UI  
**Storage**: ローカルファイル (RPG/CL ソース)、JSON 定義ファイル、VS Code 設定・ワークスペース設定  
**Testing**: `vscode-test` + Mocha による VS Code 拡張ホストテスト (ユニットテスト + 軽量な統合テスト)  
**Target Platform**: デスクトップ版 VS Code (Windows / macOS / Linux)、IBM i / AS400 はリモート開発対象 (この機能では直接操作しない)  
**Project Type**: VS Code extension (単一プロジェクト)  
**Performance Goals**: RPG/CL 編集操作やプロンプター起動・適用は、通常の開発マシンで体感遅延がないレベル (目安として 100ms 以下の応答)  
**Constraints**: 現行バージョンでは IBM i / AS400 への送信・コンパイル・デバッグはスコープ外。安全性確保のためローカル編集体験に限定し、将来の連携に備えて拡張可能な設計とする。  
**Scale/Scope**: まずは少人数チームの日常的な RPG/CL 開発を対象とし、RPG 固定形式と CL の代表的な構文・コマンドをカバーする初期セットから開始する。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle 2 – Spec-First, User-Focused Features**:  
  `specs/001-rpg-cl-vscode-support/spec.md` には、P1 (US1: 既存 RPG/CL コードの編集) と P3 (US3: F4 プロンプターとワークフロー整合) の優先度付きユーザーストーリーと受け入れシナリオが定義されており、それぞれが VS Code 上の編集体験向上というビジネス価値に紐づいている。
- **Principle 3 – Plan-Driven Implementation & Parallelism**:  
  本 plan では Phase 1/2 の構成として、VS Code 拡張の共通基盤 (言語登録・診断・JSON ローダーなど) を「Foundational」として明示し、その上に US1 / US3 のストーリー別タスクを配置することで、安全な並行実装ポイント (例: RPG/CL ハイライトと JSON ローダーなど) を特定している。
- **Principle 1 – Safety-First for IBM i / AS400**:  
  今回の機能は IBM i / AS400 への直接コマンド実行や設定変更を行わず、ローカル編集と JSON 定義ベースのプロンプターに限定することで、ターゲット環境への影響をゼロに抑えている。将来 IBM i 連携を追加する場合は、別フェーズで環境・権限・ロールバック戦略を計画する前提とする。
- **Principle 4 – Explicit Testing Discipline**:  
  `tasks.md` では JSON 定義ローダー・プロンプターモデル・編集動作 (コメントトグル、Tab ナビゲーション) などに対するユニットテストおよび `vscode-test` ベースの統合テストタスクが明示されており、実装タスクに先行または少なくとも同フェーズで実行されるように配置されている。
- **Principle 5 – Traceability Across Spec → Plan → Tasks**:  
  ユーザーストーリー US1 / US3 は plan の Summary / Technical Context / Project Structure に反映されており、`tasks.md` では各タスク ID に関連ストーリー (US1, US3) とファイルパスが紐付けられている。これにより要求から実装・テストまで追跡可能となっている。

**Gate Evaluation (Pre-Phase 0)**:  
現時点で憲法上の必須事項に対する明らかな違反はなく、Phase 0 research に進むためのゲートは PASS と判断した。IBM i 連携を含めないという方針は、安全性とスコープ制御の観点から Constitution と整合している。

**Gate Evaluation (Post-Phase 1)**:  
`research.md`、`data-model.md`、`contracts/`、`quickstart.md` により、Technical Context の「NEEDS CLARIFICATION」相当の論点は整理・解消されている。追加の安全性・テスト要求も plan / tasks に反映済みのため、Phase 2 (tasks ベースの実装計画) へ進むゲートも PASS とする。

## Project Structure

### Documentation (this feature)

```text
specs/001-rpg-cl-vscode-support/
├── plan.md              # このファイル (/speckit.plan コマンド出力 + 追記)
├── research.md          # Phase 0: 技術調査と方針
├── data-model.md        # Phase 1: データモデル (プロンプター定義など)
├── quickstart.md        # Phase 1: US1/US3 の動作シナリオ
├── contracts/           # Phase 1: API / JSON 契約 (例: prompter-api.yaml)
└── tasks.md             # Phase 2: 実装タスク (/speckit.tasks コマンド出力)
```

### Source Code (repository root)

```text
vscode-extension/
├── package.json                  # VS Code 拡張マニフェスト・依存関係
├── tsconfig.json                 # TypeScript 設定
├── src/
│   ├── extension/                # エントリポイント・コマンド登録
│   ├── language/                 # RPG/CL 言語登録・レイアウト・診断
│   ├── prompter/                 # JSON 定義ローダー・モデル・WebView 連携
│   └── utils/                    # 共通ユーティリティ (設定読み込みなど)
├── resources/
│   └── language/                 # TextMate 文法定義 (rpg-fixed/cl)
└── test/
    ├── unit/                     # 単体テスト (JSON モデル、編集ロジック等)
    └── integration/              # VS Code ホスト統合テスト (F4 プロンプター等)
```

**Structure Decision**:  
この機能は単一の VS Code extension プロジェクト `vscode-extension/` として実装する。  
RPG/CL 言語サポート・プロンプター UI・共通ユーティリティは同一リポジトリ内の専用ディレクトリ (上記構成) に集約し、IBM i 連携など将来の拡張も同プロジェクト配下で行う前提とする。

## Complexity Tracking

> No Constitution violations identified; table kept for future justification if scope evolves.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|---------------------------------------|
| None      | N/A        | N/A                                   |
