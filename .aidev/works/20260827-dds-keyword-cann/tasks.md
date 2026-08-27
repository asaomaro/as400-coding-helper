# タスク: CAnn / CFnn の取りこぼしを直す

- [x] T1: 索引側の名前の取り出しに `nn` を許す
      対象: `docs/origin/generate-dds-keywords.mjs` `parseTitle`
- [x] T2: 構文側の名前の取り出しを同じ形にする
      対象: `docs/origin/generate-dds-keyword-syntax.mjs` `detailPaths`
- [x] T3: 詳細ページ 4 件を取得（日英 × CAnn / CFnn）
      対象: `docs/origin/dds{,-en}/detail/rzakc_rzakcmstdfc{a,f}nn.htm`（新規）
- [x] T4: データを再生成し、前後を突き合わせる（依存: T1-T3）
      対象: `vscode-extension/resources/completion/dds-keywords{,.en}.json`
- [x] T5: 検査に名前の突き合わせを足す／名前の形に `nn` を許す
      対象: `docs/origin/verify-dds-keywords.mjs`
- [x] T6: 修正前のデータで検査が落ちることを確認（依存: T5）
      対象: 手順のみ（記録は `test.md`）
- [x] T7: README の件数を更新（依存: T3）
      対象: `docs/origin/README.md:21`
