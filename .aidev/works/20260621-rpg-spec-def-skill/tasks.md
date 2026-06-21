# タスク: RPG固定長仕様書のプロンプター定義生成・検証 支援skill（rpg-spec-def）

- [x] T1: `.claude/skills/rpg-spec-def/SKILL.md` を作成（frontmatter＋出力先/スキーマ＋原典参照[dialect非対称]＋マッピング規約＋手順＋I/O行種＋aidev連携）
- [x] T2: ドッグフード `vscode-extension/resources/prompter/rpg/ile/F-SPEC.json` を skill 手順どおり生成（桁は research F3 / 原典 L159-171 を正に）（依存: T1）
- [x] T3: F-SPEC を主Eが原典照合・JSON 検証（桁位置/required/options が原典一致・node require でパース可）（依存: T2）
- [x] T4: `.aidev/backlog/rpg-spec.md` の F-SPEC を `[x]` 化（生成根拠を脚注）。I/O/P は据え置き（依存: T3）
