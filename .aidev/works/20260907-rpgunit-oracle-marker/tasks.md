# 作業

- [x] `testProcedureName`（固定長 6/24 桁 ＋ 自由形式、`test` 始まりのみ）
- [x] `parseOracleMarkers`（直前の印が効く・印と根拠は対）
- [x] `--require-oracle`（走らせずに終了コード 1）
- [x] 既定は警告し、レポートに載せる
- [x] `reportData` に内訳・テストごとの出所・欠陥一覧
- [x] テンプレートに 3 か所（実行条件の行・ケース表の列・欠陥の節）
- [x] self-test 追加（計 43 → 62）
- [x] 変異 6 種で落ちることを確認
- [x] 実機で 3 通り（印あり / 警告 / `--require-oracle`）
- [x] 実機の後片付け（`NOORCL` の *SRVPGM とメンバー）
- [x] skill §0.2 §0.3 / `tools/README.md`
- [x] `.github/workflows/tools-tests.yml`
- [x] **継続名前行**（`...`）を読む（レビューで発覚。長い名前が丸ごと見えていなかった）
- [x] 実機が報告したテスト名との突き合わせ（取りこぼしの backstop）
- [x] `EXPORT` をキーワード欄 44-80 桁に絞る
