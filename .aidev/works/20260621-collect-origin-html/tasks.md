# タスク: 原典 HTML ソースの収集・保存

- [x] T1: `docs/origin/` 足場と `sources.mjs`（D1: yml→mjs）を作成（CL 46 / ilerpg 7 / rpg3 6、版 ssw_ibm_i_74）
- [x] T2: `docs/origin/fetch-origin.mjs` を実装（描画後 outerHTML・`<script>`/`<noscript>` 除去・逐次＋待機・1回リトライ・`manifest.yml` 生成。D2: playwright は `PLAYWRIGHT_PKG` 動的 import）
- [x] T3: CL を取得し `docs/origin/cl/<CMD>.html` を生成。全 status 200・404 なし（構文系 ELSE/SELECT/CALLSUBR 等も title 一致を確認）。第2弾でユーザー要望により 46→**95件**へ拡張（D5。WHEN/OTHERWISE/ENDSELECT/SUBR 等の実在も確認）
- [x] T4: ilerpg を取得し `docs/origin/ilerpg/<X>-SPEC.html` 7概説生成（D3）。第3弾でユーザー要望により桁・主要キーワード詳細サブページ 14件を追加し **21件**へ（D6。桁表の実在を確認）
- [x] T5: rpg3 を取得し `docs/origin/rpg3/<id>.html` 6件生成（jaymoseley・承認方針 A）
- [x] T6: `docs/origin/README.md` を作成（出所・版・取得手順・rpg3 第三者注記＋IBM SC09-1817 出典・script 除去ポリシー・ilerpg 概説限界）
- [x] T7: 最終検証（**122 items**〔CL95＋ile21＋rpg3 6〕全ファイル実在・欠落/孤児 0・gaps 0、git diff が docs/origin＋.aidev のみ＝スコープ外不変更。全CL title一致・bot混入0・script除去）
