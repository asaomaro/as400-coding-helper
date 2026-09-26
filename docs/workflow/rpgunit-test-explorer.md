# RPGUnit のテストを VS Code の Test Explorer で回す

この拡張機能は、RPGUnit（iRPGUnit）のテストを VS Code の **Test Explorer**（テスト・ビュー）に出し、実行と結果の確認を
そこで行えるようにする。接続・デプロイは **Code for IBM i** に乗る（この拡張だけでは IBM i に繋がない）。

- RPGUnit の導入 → [`rpgunit-install.md`](rpgunit-install.md)
- テストの書き方 → skill `rpgunit-test`
- AI エージェント（skill）から同じテストを回す道具 → [`tools/README.md`](../../tools/README.md)。
  **判定・名前・バインドの規則は VS Code と同じ部品**を使う（`vscode-extension/src/testing/` の共通部品）。

## 前提

- Code for IBM i を導入し、IBM i に接続しておく（未接続なら実行したテストが「接続が必要」で errored になる）。
- IBM i に RPGUnit（ライブラリー `RPGUNIT`）が入っている。
- 動作を確かめた環境: IBM i 7.3・RPGUnit v6.0.2.r・Code for IBM i 3.0.13（2026-09-26）。

## テストの置き方は 2 通り

どちらになるかは**ファイル名と置き場所だけで決まる**。

| | メンバー方式 | IFS 方式 |
|---|---|---|
| 置き方 | `src/<ライブラリー>/<ソース物理ファイル>/<メンバー>.rpgle`（ソースメンバー同期と同じ対応づけ） | ワークスペースの**どこにでも** `<名前>.test.rpgle` / `.test.sqlrpgle`（IBM i Testing と同じ） |
| 見分け方 | 左の形で、名前に `.test` が無い | **名前が `.test.rpgle` / `.test.sqlrpgle` で終わる**（大文字小文字は問わない）。`src/` の下に置いても IFS 方式 |
| IBM i へ | ソースメンバーへ送り `RUCRTRPG SRCFILE/SRCMBR` | Code for IBM i の**デプロイ**で IFS へ送り `RUCRTRPG SRCSTMF` |
| テスト・プログラム | `<ライブラリー>/<メンバー>` | **現行ライブラリー**`/<名前の規則で作った名前>`（下記） |
| 送るソース | 開いているエディターの内容（未保存でも） | **ディスク上のファイル**（デプロイが送るもの。保存してから実行する） |

`src/L/F/calc-add.test.rpgle` のように `-` を含む名前でも、`.test.rpgle` で終われば IFS 方式（メンバー CALC として扱わない）。

## IFS 方式

### 使う前に: デプロイ先を設定する

Code for IBM i のエクスプローラーでワークスペースのフォルダーを右クリックし、**デプロイ先（Deploy Location）**を設定する。
未設定のまま実行すると、IFS 方式のテストは「デプロイ先が設定されていません」で errored になる（勝手に既定の場所へは送らない）。

実行するとき、テストが入っているワークスペース・フォルダーを**実行 1 回につき 1 回**デプロイする。方法は:

- Code for IBM i に既定のデプロイ方法を設定していて、それがこの環境で使えるなら、それに任せる。
- 無ければ `compare`（MD5 で比べる。IBM i に `md5sum` があるとき）、無ければ `all`。
  `compare` は**デプロイ先にあってローカルに無いファイルを消す**（Code for IBM i の動作）。デプロイ先は IFS 方式専用にしておくのが無難。

### テスト・プログラムの名前とライブラリー

- **ライブラリー**: Code for IBM i の接続設定の**現行ライブラリー**。無ければ errored になる。
- **名前**: IBM i Testing（とその元の Source Orbit）と同じ規則。同じテストは IBM i Testing で回しても同じ名前になる。
  1. ファイル名から `.test.rpgle` を外し、`-` より前を取る
  2. 先頭に `T` を付けて 10 文字以内ならそれ（`calc.test.rpgle` → `TCALC`、`calc-日本語.test.rpgle` → `TCALC`）
  3. 超えるなら、`_` の前を接頭辞にし、名前の先頭と**大文字**だけを拾って詰め、`T` を付けて 10 文字に切る
     （`customerMaster.test.rpgle` → `TCM`、`UA_customerMaster.test.rpgle` → `TUACM`、全部小文字なら `T` ＋先頭 9 文字）
- 作った名前が IBM i の名前として正しくない（`.` を含むなど）と、テスト・ビューのファイルの横に「プログラム名を作れません」と出て、
  実行すると errored になる。ファイル名を変える。

### `/COPY` の書き方

- ワークスペースの別のファイルは **IFS の相対パス**で書ける: `/COPY qcopy/calc_h.rpgleinc`。
  探す場所は **テストと同じディレクトリ → デプロイ先の最上位（ワークスペース・フォルダーに当たる）**の順。
- RPGUnit の `TESTCASE` などのメンバー形式（`/COPY RPGUNIT/QINCLUDE,TESTCASE`）もそのまま使える。
- `testing.json` の `incDir` は読まない（上の 2 か所で決まる）。
- **道具（skill）で回すときは「最上位」が git の最上位になる**（VS Code はワークスペース・フォルダー）。VS Code で git の最上位より下の
  ディレクトリを開いていると、同じ相対パスの `/COPY` が片方でしか解決しないことがある。また道具が送るのは RPG のソース
  （`.rpgle` `.sqlrpgle` `.rpgleinc` `.rpginc` `.inc` `.cpy`）だけで、Code for IBM i のデプロイはワークスペース全体を送る。

### 文字コード（日本語）

VS Code で書くソースは UTF-8。**IBM i 7.3 の日本語環境（ジョブ CCSID 5035）では、UTF-8（CCSID タグ 1208）の主ソースをそのまま
`RUCRTRPG SRCSTMF` に渡すと `CPE3490 変換エラー` で開けない**（実機で確認。中身が英数字だけでも同じ）。

そこでこの拡張は、**テストの主ソースだけを `CPY … TOCCSID(*JOBCCSID) DTAFMT(*TEXT)` でジョブの CCSID（EBCDIC）に写してから**
コンパイルする。日本語の注記・文字リテラルはそのまま使える。コピー句は UTF-8 のままで正しく読める（変換しない）。

### 実行後に IFS に残るもの

- デプロイ先: デプロイしたワークスペースの写しが残る（Code for IBM i のデプロイの動作）。
- 変換した写し・結果 XML: Code for IBM i の一時ディレクトリに作り、使い終えたら消す。

## `testing.json`（バインド指定）

テスト対象のサービスプログラムを束ねるには、テストと同じディレクトリか上のディレクトリ（ワークスペースの最上位まで）、
または `.vscode/testing.json` に書く（IBM i Testing 互換）。**メンバー方式・IFS 方式とも同じ規則**で効く。

```json
{ "rpgunit": { "rucrtrpg": { "bndSrvPgm": ["CALCSRV"], "bndDir": ["MYBNDDIR"] } } }
```

- キーごとに最寄りのファイルが優先。修飾しない名前は `*LIBL` で探す。
- 形が誤っていれば（配列でない・件数超過など）、そのファイルのテストが「testing.json の設定が正しくありません」で errored になり、コンパイルしない。

## 困ったとき

| 症状 | 原因と手 |
|---|---|
| 全部「IBM iへの接続が必要です」 | Code for IBM i で接続する |
| IFS 方式だけ「デプロイ先が設定されていません」 | 上の「デプロイ先を設定する」 |
| 「IFS のソースを変換できません」 | そのファイルがデプロイ先に無い。保存してから実行する／`.deployignore`・`.gitignore` で除外していないか確かめる |
| 「コンパイルに失敗しました」 | 詳細のジョブログを読む。行ごとの理由はコンパイル・リスト（スプール名はプログラム名）にある |
| 「現行ライブラリーがありません」 | Code for IBM i の接続設定で現行ライブラリーを設定する |
| 「Code for IBM iのデプロイに失敗しました」 | 出力パネルの Code for IBM i のデプロイのログを読む |
| 「Code for IBM iのデプロイAPIが見つかりません」 | Code for IBM i を更新する（3.0.13 で確認） |
| 「ファイル名 … からIBM iのプログラム名を作れません」 | ファイル名を変える（上の「名前」の規則） |
