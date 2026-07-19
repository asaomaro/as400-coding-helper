# 競合調査: Code for IBM i と CL プロンプター

調査日: 2026-07-19。

**調べ方**: README や記事の要約ではなく、**各拡張のソースと IBM の原典を直読**した。
理由は README が実装を実際より小さく見せるため（`vscode-rpgle` の README は 4 項目しか
挙げていないが、実装は I/O 仕様の変種判定まで持っている）。

---

## 1. 生態系の構造

Code for IBM i は単体の拡張ではない。IBM が **IBM i Development Extension Pack**
(2025-10 発表、15 拡張同梱) を出しており、事実上の準公式。

| 層 | 拡張 | 備考 |
|---|---|---|
| 接続・ブラウズ・コンパイル・デプロイ | `codefori/vscode-ibmi` | ★414 / MIT / publisher は `HalcyonTechLtd` |
| RPG 固定長支援 | `codefori/vscode-rpgle` | ★57 |
| SQL / Db2 | `codefori/vscode-db2i` | ★74 |
| デバッガー | **`IBM.ibmidebug`** | IBM 名義・クローズド |
| CL 言語 | `IBM.vscode-clle` | プロンプター機能は無い |
| **CL プロンプター** | **`CozziResearch.clprompter`** | = `bobcozzi/clPrompter` (MIT) |
| DSPF 視覚エディター | `codefori/vscode-ibmi-renderer` | **開発中・本番未対応**と README に明記 |

Marketplace 86,486 インストール。最終 push はほぼ毎日で活発。

---

## 2. RPG 固定長支援（`vscode-rpgle`）— 重なるが作りは本 PJ が上

`Shift+F4` ルーラー / `Ctrl+Shift+F4` Column Assistant。**F4 ではない**。

- 桁定義は `extension/client/src/schemas/specs.ts` の **502 行の手書きリテラル**。原典照合なし
- **欄ごとのヘルプが構造上存在しない**（`SpecFieldDef` にヘルプの欄が無い）。本 PJ は 108/109 欄
- ILE は H/F/D/DX/C/CX/I/IC/IJ/IX/JX/O/OC/OD/OP/P、OPM は H/F/E/L/I/C/O
- `.rpg36`/`.rpg38` を「非推奨だが経路あり」として残す（本 PJ は対象外と判断済み）
- 日本語なし。`vscode-rpgle` には **`l10n/` 自体が存在しない**

### ルーラーの実装は本 PJ が捨てた方式

`columnAssist.ts` は装飾を絶対配置で 1 行上に重ねている。

```
textDecoration: `position: absolute; top: -1.4em; ...`
```

上の行を隠さないため、背景色と同じ塗り潰しバーを先に敷いている。つまり
**上の行のコードは見えなくなる**。本 PJ が CodeLens に切り替えた理由そのもの。

### I/O 仕様の変種判定は「軸が違う」だけで取りこぼしではない

当初「向こうは I が 5 種・こちらは 4 種なので取りこぼしか」と疑ったが、**誤りだった**。

| | 判定の根拠 |
|---|---|
| vscode-rpgle | その行の中身から推測（`getInputRulerKey`） |
| 本 PJ | **F 仕様書 22 桁目の `E`** でプログラム記述/外部記述を決める |

桁の実体も突き合わせ済み。向こうの `IJ`(Fmt/From/To) は本 PJ の `I-SPEC-FLD-PGM`(31-46 桁)、
`JX`(外部フィールド名) は `I-SPEC-FLD-EXT`(21-30 桁) に対応する。**借りるべきものは無い。**

---

## 3. CL プロンプター（`clPrompter`）— ここだけは向こうが上

**F4 に割り当てられている**（`clPrompter.clPrompter`）。本 PJ と衝突する。

### 差は努力量ではなく「定義の源が機械可読か」

| | clPrompter | 本 PJ |
|---|---|---|
| 源 | 実機 `*CMD` の **XML (CDML)** | IBM 原典 **HTML（散文）** |
| **DEP（相関チェック）** | 全コマンドで自動。演算子＋閾値＋メッセージ ID | `constraints` **7 コマンド**のみ |
| **PMTCTL（条件表示）** | 全コマンドで自動。AND/OR グループ | `dependsOn` **2 欄**のみ |
| MapTo / Rstd / Case | あり | 無い、または近似 |
| ヘルプ | 実機で `GENCMDDOC` を走らせて取得 | 原典由来の日本語をバンドル |
| 接続 | **必須** | **不要** |

`dependsOn` が 2 欄しか無いのは手を抜いたからではなく、**原典 HTML から機械的に取れる分が
それだけ**だから。散文の「OUTPUT(\*OUTFILE) を指定した場合は OUTFILE を指定しなければ
なりません」から `DEP` 構造は復元できない。

### 「日本語ヘルプが強み」は弱い

clPrompter は各欄のヘルプを**実機で `GENCMDDOC` を走らせて**取っている。出力言語は
システム/ジョブの言語に従うため、**日本語フィーチャーが入った IBM i なら日本語で出る**。
CL に関しては日本語という差別化はお客様の実機構成次第で消える。

### 通信は「入力のたび」ではない

WebView から実機へ飛ぶメッセージは `getParamHelp` / `submit` / `cancel` /
`promptNested` / `loadForm` / `pong` の 6 種類のみ。**DEP/PMTCTL を評価するメッセージは無い**。

実機に行くのは (1) プロンプトを開くとき `*CMD` XML (2) ヘルプボタン (3) 入れ子 F4 の 3 場面だけで、
いずれもキャッシュあり。接続時に `warmXmlCache` で先読みし、切断時に破棄する。

つまり**反応的な動きは全部ローカル**で、「宣言的データ＋ローカル評価」という
本 PJ の `dependsOn` / `constraints` と同じ発想。**アーキテクチャの差ではなくデータの差**。

---

## 4. 競合が存在しない領域（コードで確認済み）

- **`.cmd`（コマンド定義ソース）** — codefori 組織内に該当なし。clPrompter にも無い
- **SOSI / DBCS の桁ずれ** — 両リポジトリに SO/SI・`0x0E`/`0x0F` の処理が皆無。
  むしろ本体は CCSID 65535 を "will ruin your Code for IBM i experience" と明記しており弱い
- **DDS の桁支援**（PF/LF/DSPF/PRTF）— キーバインドは `rpgle`/`rpg` のみ
- **日本語 UI** — 本体 `l10n/` は da/de/es/fr/it/no/pl のみで `ja` 無し。
  `package.nls.*.json` が 1 つも無いため**コマンド名や設定ラベルはどのロケールでも英語**。
  docs サイトも日本語は一度も設定されたことがない。例外は `vscode-ibmi-fs` のみ

「使う側（CL コマンドのプロンプト）」は向こうが上だが、
**「作る側（`.cmd` を書く）」は本 PJ だけ**が支援している。

---

## 5. 判断への含意

CL プロンプターを本 PJ の看板に掲げるのは筋が悪い。`*CMD` XML という機械可読な源を持つ
相手に、散文の HTML から追いつくのは構造的に無理がある。定義を増やしても DEP/PMTCTL の
穴は埋まらない。

芯は競合が存在しない **SOSI / DDS / `.cmd` / 日本語** に置く方が通る。

未解決:
- **F4 の衝突**。clPrompter と併用された場合の挙動は未確認
- CL で追いつく唯一の現実的な道は「接続時に実機の `*CMD` から定義を作る」経路
  （§6）。その場合バンドル定義はオフライン時の縮退運転になる

---

## 6. `QCDRCMDD` — DEP/PMTCTL を取れる公開 API

**`GENCMDDOC` に XML 出力は無い**（原典で確認。`GENOPT` は `*HTML`/`*UIM`/
`*NOSHOWCHOICEPGMVAL`/`*SHOWCHOICEPGMVAL`/`*NOSERVICE`/`*SERVICE` のみ）。
clPrompter が使っているのは **`QCDRCMDD`**（Retrieve Command Definition API）。

IBM の API 原典（7.5）より:

> retrieves information from a CL command (\*CMD) object and generates **XML** ...
> called **Command Definition Markup Language or CDML**

| | |
|---|---|
| 公開権限 | **`*USE`**（既定） |
| 出力先 | 受信変数 または **ストリーム・ファイル** |
| 文字コード | UTF-8 (CCSID 1208) |
| スキーマ | `/QIBM/XML/DTD/QcdCLCmd.dtd` |

CDML が含む要素として原典が列挙するのは
`CMD` / `PARM` / `ELEM` / `QUAL` / **`DEP`** / **`PMTCTL`**。**欲しい 2 つが入っている。**

`*USE` で呼べるため **clPrompter のような UDTF の導入は不要**。既存の ssh +
ストリームファイル読み出しの手順がそのまま使える（clPrompter の UDTF は高速化の
ラッパーで、`QCDRCMDD` 直呼びがフォールバック）。

### 進める前に潰すべき懸念

1. **取れる値が「IBM 出荷時」とは限らない**。原典に明記:
   > If the default value ... has been changed using the **CHGCMDDFT** command, the
   > returned command information will reflect **the default currently in effect**

   pub400 は共用機。誰かが `CHGCMDDFT` していれば**その機械固有の値を正として焼き込む**。
   現在の 251 定義は IBM 公開ドキュメント＝出荷時の値なので、品質を下げる方向の risk。
2. **pub400 への負荷**。全コマンド（2000 件超）の一括抽出は無償の共用機への大きなバッチ。
   ログインバナーにも "please be polite and do not disturb other users" とある。
3. **再配布の可否は未解決**。`QCDRCMDD` が公開 API であることは**取得**の正当性を裏づけるが、
   取得した内容を拡張機能に**同梱して配布**してよいかは別の話。未判断。

### 段階を踏む案

1. まず数コマンドで `QCDRCMDD` を実際に叩く（実現性の確認。負荷も軽い）
2. 取れた CDML を**既存 251 定義の検証**に使う。同梱せず照合だけなら 3 の論点が生じず
   品質はすぐ上がる
3. DEP/PMTCTL の同梱は 1・2 の結果と再配布の判断が出てから

**未検証**: 調査時点で pub400 に到達できず（`github.com:22` は到達可のため
こちら側の遮断ではない）、`QCDRCMDD` を実際に叩いていない。復旧後に確認すること。

---

## 参照

- https://github.com/codefori/vscode-rpgle — `extension/client/src/language/columnAssist.ts`, `schemas/specs.ts`
- https://github.com/codefori/vscode-ibmi
- https://github.com/bobcozzi/clPrompter — `src/types.ts`, `src/getcmdxml.ts`, `src/extension.ts`
- https://codefori.github.io/docs/
- IBM Documentation: `apis/qcdrcmdd.htm`, `cl/gencmddoc.htm`, `cl/dep.htm`, `cl/pmtctl.htm`
- https://github.com/codefori/vscode-ibmi/issues/2391 — メンテナーが CL プロンプト未実装を認めている
