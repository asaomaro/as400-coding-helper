# 仕様

`requirement.md` の AC をそのまま実装する。設計判断は `decisions.md` に記録。

- `--order api|reverse` / `--rclrsc no|always|once` を `RUCALLTST` に渡す
- `--check-independence` は正順・逆順を走らせ `compareRuns` で突き合わせる
- **比べるのは合否だけ**（D1）。差があれば一覧を出して終了コード 1
- `compareRuns` は実機非依存にし `--self-test` で固定する
