# レビュー記録

## ラウンド 1（2026-06-22）

観点: 要件適合 / 正確性 / 規約適合（AGENTS.md の sh/ps1 パリティ罠）/ 保守性。
主エージェントが sh⇔ps1 を直接突合（パリティ検証は委譲しない）。

- [must] `.aidev/bin/aidev:186`（親 subtasks 更新）/ 対応: 修正済
  sh の dedup ロジックが「slug が既存リストにある場合に slug を脱落させる」分岐になっており、
  ps1（`-notcontains` で keep-all＋append-if-absent）と**意味が乖離**（パリティ違反）。
  → sh を「既存を全保持し未登録なら末尾追加」に簡素化し ps1 と一致させた。
- [must] `.aidev/bin/aidev` `need_file` / `aidev.ps1` `needFile`（guard の親 fallback）/ 対応: 修正済
  subtask の上流成果物継承（親 fallback）が**全ファイルに効いていた**ため、subtask の `coding` guard が
  親の `plan.md`/`tasks.md` を継承して**誤って充足**しうる（subtask 固有であるべき）。
  → fallback を継承対象 {requirement.md, spec.md, design.md} に限定。sh/ps1 両方修正。
  → 回帰テスト追加（subtask coding は親 plan.md を継承せず未充足=2、子に置けば充足=0）。
- [nit] doctor/status は subtask を「件数ロールアップ」せず親のみ表示する設計上の割り切り / 対応: 許容
  （doctor はネスト横断で verify する。status の集計拡張は follow-up 候補）。

再検証: `sh .aidev/bin/test/run.sh` → pass=58 fail=0 skip=1（skip=pwsh パリティ＝CI）。
実 `.aidev` の `doctor` → works=17 fail=0（既存 schema 2 work 回帰なし）。

must/should の未解決なし（nit のみ）。

## 未検証 surface（deliver へ引き継ぐ）
- **sh⇔ps1 パリティ（skip=1）**: 本環境に pwsh 不在。ps1 の subtask 実装（new --parent / doctor ネスト横断 /
  eval_depends 兄弟解決 / needFile 限定 fallback）は **CI（pwsh 同梱 runner）で必ず実行検証**すること。
  AGENTS.md「sh/ps1 二本立て」の罠（`set -eu` の return・単一要素配列アンラップ）に該当。
