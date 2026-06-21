# レビュー記録

## ラウンド 1（2026-06-21・autonomous batch）

対象: `P-SPEC.json`（新規）/ backlog の P-SPEC を `[x]`。

- **要件適合**: P 仕様を原典準拠で新設。F4 配線は前作業で有効。完了条件を満たす。
- **正確性**: 桁位置が原典 L788-807 と一致（test (c)）。B/E を dropdown、EXPORT/EXTPROC をキーワード help に明記。
  PROCNAME/BEGINEND を required:true（P 行に必須・単一行種のため破綻しない）。
- **規約適合**: 原典照合を主E直読で実施。languageId 非波及。
- **保守性**: 既存定義と同型。キーワード欄は keyword 方式（sourceStart 付き範囲で書き戻し）。

### 指摘
- [must] なし / [should] なし / [nit] なし

判定: 指摘なし → 通過。
