# レビュー記録（aidev-util-batch 実行: 残り54件で issue #43 完了）

`aidev-util-batch` の実行記録。issue #43 backlog の残り全54件（P4残15・P5の14・P6の3・P7の5・P8の6・
P9の7・P10の4）を生成し、PR #44（feature/issue-43）に追加コミット。これで CL 未定義85件すべてが定義済み。

## 実装方式

- ドラフトは **11の並列サブエージェント**に委譲（batch §2.6「重い実処理はサブエージェントに委譲してよい」）。
  各エージェントはローカル原典 `docs/origin/cl/<CMD>.html` を直読して JSON を起こした（ネットワーク不要＝
  権限劣化リスクなし）。
- **原典照合（test 硬ゲート）は主エージェントが全件実施**（protocol §2.6 / AGENTS.md「委譲しない」）。

## ラウンド 1（2026-06-21）— 主エージェントによる原典機械diff

| 検証 | 結果 |
|---|---|
| 構造検証（validate-prompter-defs.mjs） | 104ファイル全件 `PrompterDefinition` 適合 |
| パラメータ集合（原典 ⇔ JSON 双方向diff） | 54/54 一致。差分19件はすべて heuristic 由来（詳細節の他パラメータ参照／抽出取りこぼし）で、**要約表を主エージェントが直読して実在/誤検出を確定** |
| 必須フラグ | 955件チェック・不一致 0 |
| dropdown 定義済み値（10コマンド抽出） | 249値・幻覚 0 |

### 主エージェントが手で確定した差分（すべて誤検出と判明＝実装は正しい）

- `CRTAUT`（CRT系）/`UPDPROD`(OVRDBF,CRTLIB)/`RMTLOCNAME`(CHGPF)/`ASP`(MOVOBJ,DLTLIB)/`USRPRF`(CRTLF)/
  `OBJAUD`(CRTLIB)/`DEV`,`SBMFROM`(SBMJOB)/`LIB`(DSPOBJD)/`RNTRSL`(OVRPRTF,CRTPRTF): 詳細節の他パラメータ
  参照で、要約表に無し → JSON が正しく除外。
- `SRCMBR`/`CONTIG`/`AUT`/`FNTRSL`/`JOB`(WRKACTJOB,CPYSPLF)/`JOBSYSNAME`(CPYSPLF): 要約表にあり実在 →
  JSON が正しく収録（heuristic の取りこぼし）。

## マッピング規約（原典準拠・既存定義と一貫）

- 修飾オブジェクト名 → group[LIB, <name>]（LIB先頭、既定は原典どおり *LIBL/*CURLIB）。
- 修飾ジョブ名 → group[JOB, USER, NBR]。
- ネスト要素リスト → 既存 RCVMSG 同様に平坦化（子 name 英大文字。命名はベストエフォート）。
- 固定選択肢のみ → dropdown（default=先頭値）。固定値+自由入力の混在・選択肢多数 → text+help+default。
- 戻りCL変数 → text。反復 → maxOccurrences。

## 指摘

- must=0 / should=0 / nit=0。差し戻しなし。

## 既知の制約（PR 引き継ぎ）

- F4 実機検証は headless 未実行（ロード可能性＝構造健全性で代理担保）。
- ネスト要素リストの平坦化した**子要素 name** は IBM 内部キーワードと厳密一致を保証しない（表示・入力補助
  としては機能）。トップレベル・キーワードは原典と機械diff済み。
- RTVSYSVAL SYSVAL は固定列挙158値の dropdown（既定=先頭値）。UI 簡素化のため将来 text 化も選択肢。
