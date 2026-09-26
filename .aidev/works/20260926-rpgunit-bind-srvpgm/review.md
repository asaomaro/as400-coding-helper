# レビュー記録

## タスク点検ログ（coding 工程内・「3.3」(b)）

- T1〜T5・cross を same_session で点検し、いずれも指摘 0。T1・T2・T3・T4 は実装に変異を入れて／コミット済みの版に
  戻して、追加テストが落ちることを確かめた（test-result.md）。
- 記録の誤り: T6（テストを流すだけで自前の差分を生まないタスク）にも点検を記録した。規約では `task_checks` に
  数えない種類で、`task_checks` が 1 件多い。

## ラウンド 1（2026-09-26）

CHECK: findings / FINDINGS: 2（nit のみ）
- 要件適合: AC1〜AC9 すべて単体テストと実機 E2E で確認（test-result.md）。`aidev coverage` は tasks 時と同じ
  （ac=9・gap=0）。
- 価値適合: 「サービスプログラムの手続きを呼ぶテストを Test Explorer から実行できる状態」は、実機 E2E で
  バインド無し→`CPD5D02`、`bndSrvPgm`／`bndDir`→Passed を確認して満たされた。
- 正確性・安全: `testing.json` の名前は `resolveBinding` の正規表現（オブジェクト名・特殊値）を通ったものだけが
  CL に入る。設定ファイル経由で任意の CL を差し込めない。
- [nit][conv:-] `vscode-extension/src/testing/{coverage,codeForIbmi,testController}.ts` の「decisions.md D4」などは
  `20260922-rpgunit-vscode-testing` の記録を指すが、この work で同じモジュールから別 work の `decisions.md` も
  参照するようになり、どちらか区別できなくなった。 / 対応: 修正済（work のパスで修飾）。
- [nit][conv:-] タスク点検の記録誤り（上記「タスク点検ログ」）。 / 対応: 許容（記録に残す。次回は自前の差分を
  生まないタスクに `taskcheck` を打たない）。
