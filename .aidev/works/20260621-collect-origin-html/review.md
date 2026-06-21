# レビュー記録

## ラウンド 1（2026-06-21）

差分: `docs/origin/**`（HTML 122件＋`sources.mjs`/`fetch-origin.mjs`/`manifest.yml`/`README.md`）＋ work 成果物。
観点: 要件適合 / 正確性 / 規約適合（AGENTS.md）/ 保守性。

### 要件・仕様適合
- 受け入れ基準は test で全合格（CL95＋ile21＋rpg3 6＝122件・manifest に source_url/fetched_at・gaps 0・定義JSON不変更）。スコープ厳守（`docs/origin/**` のみ、`prompter/*.json`・`package.json`・`src`・言語登録は無変更）を git diff で確認。✅

### 規約適合（AGENTS.md）
- **原典照合は主エージェントが実施**: Playwright 取得・本文/桁/title の確認をすべて主エージェントが直読で実施（サブエージェント委譲なし）。✅
- **languageId 波及なし**: contributes・言語登録・拡張子関連付けに触れないため診断/キーバインド等への副作用なし。✅
- **sh/ps1 二本立て CLI 不変更**: `.aidev/bin` 無変更。✅

### 指摘
- [should][deliver] `.aidev/insights/2026-06-21b-insights.md` はセッション開始時から存在する**本作業と無関係の既存未追跡ファイル**。deliver で `git add -A` すると巻き込むため、**明示パスペックでステージ**し本 PR に含めない。/ 対応: deliver 工程で対処（コミット対象を `docs/origin` と当 work フォルダに限定）。
- [nit] `fetch-origin.mjs` のヘッダ使用例（L7-9）に `--names=` の記載がない（インラインコメント L30 にはある）。/ 対応: 許容（機能はコメント済み）。
- [nit] `sources.mjs` から item を削除しても manifest/HTML の古いエントリは prune されない（追加運用のため現状問題なし）。/ 対応: 許容。
- [nit] 描画後 HTML は `<script>` 除去のため再描画は不可（テキスト・表・桁は保持）。原典スナップショット用途として妥当・README 明記済み。/ 対応: 許容。
- [nit] 保存物は約 15MB を commit。ユーザー要望（HTML をソース保存）に基づく意図的選択で README に方針記載。/ 対応: 許容。

### コード正確性（fetch-origin.mjs）
- 動的 import の CJS/ESM interop（`_pw.chromium || _pw.default.chromium`）、bot 通知検出＋リトライ、JSON フロー記法による manifest の再パース/マージ、逐次取得＋待機、いずれも妥当。`node --check` 通過。**must/should のバグなし**。

### 判定
- must=0 / should=1（deliver 時対応の運用注意のみ・コード修正不要）/ nit=4。
- コーディングへの差し戻しは不要（should はコード欠陥ではなく deliver 手順の注意）。review 通過とする。
- walkthrough: ファイル数は多い（HTML 122件）が論理は単一スクリプトで単純、`README.md` がレビューガイドを兼ねるため必須でない（任意）。
