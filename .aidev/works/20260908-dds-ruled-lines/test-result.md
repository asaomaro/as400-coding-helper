# テスト結果: 罫線を引けるようにする（DSPF / PRTF）

実施日: 2026-09-10 ／ ラウンド 1（差し戻し無し）

> **2026-09-10 追記（review 工程で更新）**: 組み込み `code-review` と自己点検で見つかった
> 3件の実欠陥（secondaryScreen で gridLines/gridBoxes が差し替わらない・PRTF複数ページで
> BOX/LINE が全ページに出る・始点と同じ点で長さ1の罫線が黙って出来る）と、頑健性の1件
> （崩れた `*DS3` 組の後ろにある正しい `*DS4` 組を読み飛ばす）を修正し、回帰テストを追加した
> うえで本結果を再測定した数値に更新している（`review.md` 参照）。

## 実行したもの

| コマンド | 結果 |
|---|---|
| `npm test`（単体） | **1244 passed / 0 failed / 0 skipped** |
| `node dev/e2e.mjs`（単独起動の実操作） | **252 / 252 PASS** |
| `npm run verify`（原典照合・往復検証） | **exit 0**（検査 16 本＋往復 538 定義。新設の索引外検査を含む） |
| `npm run test:integration`（拡張機能ホスト） | **3 passed** / Exit code 0 |
| `aidev smoke`（起動確認・新設） | **pass（exit 0, 2 本）** |

いずれも `rm -rf out out-test` してから走らせた。

件数の内訳:

| | 着手前 | 現在 | 差 |
|---|---|---|---|
| 単体 | 1215 | 1244 | **+29** |
| e2e | 225 | 252 | **+27** |

**既存のテストは1件も消していない。** 期待値を直したものも無い（前回 work のような
書式変更の副作用が今回は発生しなかった）。

## 受け入れ基準ごとの判定

| AC | 判定 | どう確かめたか |
|---|---|---|
| AC1 GRD系5件の原典取得・データ反映 | **pass** | `docs/origin/verify-dds-keywords.mjs`（DDS-DSPF 172→183件、5件とも構文・レベル判別まで反映）。索引の実在は実機取得ページを直読で確認済み（research F1、`generate-dds-keywords.mjs`拡張で反映）。**副産物としてCNTFLD/IGCALTTYP/IGCCNV等の他キーワードも取れた**（同じ2次索引経由） |
| AC2 GRDLIN/GRDBOXがプレビューに出る | **pass** | 単体『描画モデル: 罫線・枠（GRDLIN/GRDBOX）』6件（`dspfRenderModel.test.ts`）。e2e「PRTFでも同じ操作で...」以外の3件で実際に描画・選択・削除まで確認 |
| AC3 BOX/LINEがプレビューに出る | **pass** | 単体『描画モデル: 罫線・枠（BOX/LINE）』3件（`prtfRenderModel.test.ts`。原典の使用例`BOX(1.2 0.5 5.1 6.3 0.2)`をそのまま読める）。e2e「PRTFでも同じ操作で罫線（LINE）が置ける」 |
| AC4 プレビュー上の操作で新規配置 | **pass** | e2e 5件（横罫線・縦罫線・枠の3形状すべてをマウス2クリックで作成し、桁・長さ・大きさが原典の解釈どおり求まることを確認） |
| AC5 罫線・枠の判定規則が原典と一致 | **pass** | `ddsGridShapes.test.ts` 18件。GRDLIN/GRDBOXの構文・既定値（*TYPE省略時upper）・*DS3/*DS4の解決規則、BOX/LINEのcm/inch変換（原典の使用例2件を直接引用）をすべて往復で固定 |
| AC6 削除・undo | **pass** | e2e「クリックした罫線・枠が選択状態になる」「選択した罫線・枠をDeleteで削除できる」「削除はundoで戻る」 |
| AC7 索引外キーワードの取りこぼし検査 | **pass** | 新設 `verify-dds-keyword-index-coverage.mjs`。**壊して落ちることを確認済み**（下記） |
| AC-I1 開く | **pass** | e2e「罫線・枠を置くボタンがある」「押すとarmedになる」 |
| AC-I2 確定/取り消し | **pass** | e2e「Escapeで取り消すと何も置かれない」「取り消したらボタンへ焦点が戻る」「1件確定したらarmedが解ける」 |
| AC-I3 キーボードだけで完結 | **pass** | e2e「Enterで武装したら仮想カーソルが出る」「始点確定後は始点マーカーも残る」「マウス無しで罫線を置ける」（矢印キーで移動→Enter×2で確定） |
| AC-I4 フォーカスの行き先 | **pass** | e2e「配置後は新しく置いた罫線へ焦点が移る」。**coding中に実バグを発見・修正**（下記） |
| AC-I5 既存操作を妨げない | **pass** | e2e「罫線ツール中の矢印キーは選択中のフィールドを動かさない」——フィールドを選択後に罫線ツールを武装して矢印キーを押しても、フィールドの位置が1バイトも変わらないことを確認 |

## 失敗の証跡

**製品の欠陥による差し戻しはこのラウンドで発生していない**（`sent_back` 0回）。
ただし、coding中に検証を書いている過程で2件の実欠陥を見つけ、その場で直している
（review行きにせず、AGENTS.md「テストを足したら戻して落ちることを確かめる」に従い
break-testまで実施済み）。

### (1) 製品の欠陥: 配置直後にブラウザの既定動作が焦点を奪う（AC-I4）

```
$ node dev/e2e.mjs
FAIL **配置後は新しく置いた罫線へ焦点が移る**（AC-I4）
  — active=BODY.# shapes=1 shapeAttrs={"sourceLine":"2","row":"1","column":"4","shapeKind":"line"}
```

コードは正しく対象要素へ `.focus()` していた（`console.error` デバッグで
「focus直後は正しく罫線要素にフォーカスがある」ことまで確認済み）。原因は
`pointerdown` の**既定動作**——「フォーカス不能な要素を押した」ときブラウザが
自動でフォーカスを `body` へ落とす処理が、明示的な `.focus()` の**後に**効いて
上書きしていた。`event.preventDefault()` を `onPointerDown` の罫線・枠ツール分岐の
先頭に追加して解消（`decisions.md` D6）。

**break-test**: `event.preventDefault()` の行を外すと同じ箇所で確実に再現することを確認済み。

### (2) 製品の欠陥: 生成スクリプトが2次索引を認識せず、原典の一部キーワードを恒常的に取りこぼす

正確には「coding中に見つけた既存の欠陥」——GRD系5件が主索引に載っていない事実（research F1）に
対し、`generate-dds-keywords.mjs`/`generate-dds-keyword-syntax.mjs`の`TYPES`が単一索引ファイルしか
読まない構造だったため、素朴に「原典を取得すれば済む」ではなく**生成スクリプト自体の拡張**が要った。
`docs/origin/verify-dds-keyword-index-coverage.mjs`（新設）でこの種の取りこぼしを機械検査に固定した。

**break-test**: `resources/completion/dds-keywords.json` からGRDLINを一時的に削除して
`node docs/origin/verify-dds-keyword-index-coverage.mjs` を実行:

```
$ node docs/origin/verify-dds-keyword-index-coverage.mjs
✗ NG（1件）
  - dds/ja: 取得済みページにリンクがあるのに補完データに無い（GRDLIN）
```

正しく検出。`generate-dds-keywords.mjs`を再実行して復元・再確認して PASS に戻ることも確認済み。

## 検査が本当に守っているかの確認（壊して落とす）

| 検査 | 壊し方 | 結果 |
|---|---|---|
| `verify-dds-keyword-index-coverage.mjs` | JSONからGRDLINを削除 | **1件NG**（上記(2)） |
| `dspfRenderModel.test.ts`「GRDCLRは現れない」（D4） | `readGridShapes`で`GRDCLR`を`GRDBOX`と同じ`parseGrdbox`経路に流す（GRDCLRは4引数でGRDBOXと桁数が同じため、これで初めて有効な壊し方になる。GRDLIN経由に流すだけでは引数の個数が合わず`undefined`になり、壊れずに素通りすることを確認した） | **1件FAIL**（gridBoxesに1件混入）を確認後、元に戻してPASSを確認 |
| `onPointerDown`の`event.preventDefault()` | 削除 | **AC-I4のe2eが再現して FAIL**（上記(1)） |

## 起動確認（smoke）

この work で `.aidev/config.yml` に `smokeCommand` を新設した（このPJでは前回workまで
`aidev smoke` が使えるハーネス版に無く、未設定だった）。**単数から複数形
（`smokeCommands:`）に変更**——今後 work が入口を足すたびに1行足す前提にするため。

```
$ node vscode-extension/out/cli/dds.js parse vscode-extension/test/golden/RENDER1.dspf && node vscode-extension/out/cli/lint.js vscode-extension/test/golden/RENDER1.dspf
（省略。既存のparse/lintが例外なく完走）

$ node vscode-extension/out/cli/dds.js render --format json vscode-extension/test/golden/GRIDSAMPLE.dspf | grep -q '"gridLines"' && node vscode-extension/out/cli/dds.js render --format json vscode-extension/test/golden/GRIDSAMPLE.dspf | grep -q '"gridBoxes"'
（GRDLIN/GRDBOXを含む新規サンプル test/golden/GRIDSAMPLE.dspf で、CLI の render 出力に
 gridLines/gridBoxes が実際に載ることを確認）

smoke: pass (exit 0, 2 本)
```

**2本目が今回追加した表面（罫線・枠）の起動確認**。`parse`コマンドはRenderModelを
経由しない別経路（`buildDspfOutline`）なので、罫線・枠の到達性確認には使えない
——`render`コマンドで確認する必要があると気付いたのもこの手順の中。

## 未検証の穴（skip / 環境不足）

- **PRTF の `UOM`（cm/inch）は原典どおりDDSソースに現れない**ため、常に既定値
  `*INCH` として変換する（`CRTPRTF`の実機既定。CLプロンプター定義で確認済み）。
  `*CM`でコンパイルされた既存PRTFを開くと、BOX/LINEの表示位置が実際とずれる
  ——`PAGESIZE`/`OVRFLW`と同じ「ホストが設定から渡す」既定値の一種で、この work では
  対応しない（design.md「未確認」に記載済み）。
- **実機（IBM i）でのGRDLIN/GRDBOX/BOX/LINEのコンパイル確認はしていない**。
  はみ出し・重なりを拒否しない方針は既存フィールドの前例を踏襲したもので、
  GRD系・BOX/LINE固有の実機確認はしていない（design.md記載のとおり）。
- **CLIの `render --format text`（ASCII描画）は罫線・枠を描かない**——`drawModel`が
  `model.items`しか見ないため。JSON出力（webview・smokeが使う経路）には正しく載る。
  この work の受け入れ基準にテキスト描画は含まれないため対応していない
  （既知の穴として記録。follow-upの価値があれば別途）。
- **`GRDRCD`の許可キーワード制限**（このキーワードを持つレコードには限定されたキーワードしか
  書けない、という原典の規則）はバリデーションしていない（`decisions.md` D5、意図的なスコープ外）。
- **プログラム-システム間フィールド（`&名前`）による可変位置は読めない**。原典は
  `GRDLIN`/`GRDBOX`/`BOX`/`LINE`のいずれも「開始行・開始桁…をプログラム-システム間
  フィールドとして指定できる」と定義しているが、`GridLineShape`/`GridBoxShape`は
  数値だけの構造なので、`&名前`が書かれた罫線・枠は**静かに描画対象から外れる**
  （クラッシュはしない。読めない形式は無視して安全側に倒す既存の設計思想と同じ）。
  レビューで気づいた未検証の穴。この work の受け入れ基準・design.mdのどちらにも
  可変位置への言及は無く、対応も求めていない——follow-upの候補として記録する。
- skip された検証は **0件**（どのランナーもskipを出していない）。
