# ibmi-dogubako（道具箱）

IBM i の開発を VS Code と AI から助ける道具箱です。
名前は IBM i に昔からある Toolbox に掛けた和名です（道具箱 = dogubako）。

## 入っているもの

| 場所 | 中身 |
|---|---|
| `vscode-extension/` | VS Code 拡張「Dogubako for IBM i」。固定長の RPG / CL / DDS の編集支援（ルーラー・SOSI 表示・F4 プロンプター・補完・DDS ビジュアルエディタ）、ソース・メンバーの送受信、RPGUnit のテスト実行。桁検査の CLI（`npm run lint`、SARIF 出力）もここ |
| `tools/` | 拡張の外から使う道具（RPGUnit の実行など。AI エージェントや CI から呼ぶ） |
| `docs/origin/` | IBM の原典から定義を生成・照合するスクリプト |

開発の決まりごとは [AGENTS.md](AGENTS.md) にあります。

## VSIX を作る

```sh
./build-vsix.sh        # Linux / WSL / Mac
build-vsix.bat         # Windows
```

## 使い方

### 入れる

1. VSIX を作る（上の「VSIX を作る」）か、配られた `ibmi-dogubako-<版>.vsix` を用意する。
2. VS Code の拡張機能ビューの「…」→「VSIX からのインストール」で選ぶ
   （または `code --install-extension ibmi-dogubako-<版>.vsix`）。
3. 旧名の「RPG/CL Development Support」が入っていたら、**先にアンインストールする**
   （同じコマンドが二重に登録されて衝突する）。

### 対象のファイル

拡張子で判定する。

| 種類 | 拡張子 |
|---|---|
| RPG（ILE / RPG III、SQL 組み込みを含む） | `.rpgle` `.sqlrpgle` `.rpg` `.sqlrpg` |
| CL | `.clp` `.clle` |
| DDS | `.pf` `.lf` `.dspf` `.prtf` `.mnudds` `.dds` |
| コマンド定義 | `.cmd` |

RPG は固定長だけに対応する（自由形式は対象外）。`.rpgle` は ILE、`.rpg` は RPG III として扱う
（設定 `rpgClSupport.rpgDialectByExtension` で変えられる）。

### 書く

| 機能 | 操作 |
|---|---|
| **ルーラー** | カーソル行の上に桁の目盛り（または SEU と同じ書式行）が出る。ステータスバーの表示を押すと目盛り ⇔ 書式行を切り替える。消す・戻すはコマンド「ルーラー: 表示の切り替え」 |
| **SOSI の表示** | 全角文字の前後に SO を `{`、SI を `}` で見せる（ソースは書き換えない）。桁が実機と揃う。切り替えはコマンド「制御コード(SOSI)表示の切り替え」 |
| **F4 プロンプター** | 行にカーソルを置いて **F4**。その行の内容が入力欄に入った画面が開き、確定すると桁を揃えて書き戻す。欄で **F1** を押すとその欄のヘルプ。CL の `SBMJOB CMD(...)` のようにコマンドを書く欄では、その中でさらに F4 が使える |
| **欄の移動** | RPG・CL では **Tab** / **Shift+Tab** で次・前の欄の桁へ移る |
| **コメント** | **Ctrl+/** で行をコメントにする・戻す（RPG・CL） |
| **補完** | RPG の命令コード・組み込み関数・仕様書キーワード、DDS のキーワード（カーソル行で書ける場所のものだけ） |
| **桁の検査** | 行の長さ・数値欄の桁などの誤りを、書いている間に波線で出す（設定 `rpgClSupport.lint.*`）。行長の上限は、ソース物理ファイルのレコード長から 12 を引いた桁数を `rpgClSupport.lint.maxColumn` に入れる（既定 100） |
| **SEU の色属性** | ソースに入った SEU の色属性を、目に見える印と色で表す（`rpgClSupport.seuColors.enabled`） |

### 画面・帳票（DDS）

`.dspf` / `.prtf` を開いて右クリック。

- **プレビュー**（「画面プレビュー」「帳票プレビュー」）: 表示・印刷のイメージを横に並べて見る。
  帳票の 1 ページの大きさは `rpgClSupport.prtf.*` で `CRTPRTF` の値に合わせる。
- **DDS ビジュアルエディタ**: 項目をマウスで動かす・伸ばす・足す・消す、罫線を引く、
  キーワードの値を一覧から選ぶ、などを画面の上で行い、DDS のソースに書き戻す。
- 新しく作るときは、エクスプローラーのフォルダを右クリック →「新しい画面ファイル (DSPF) を作る」／「新しい帳票ファイル (PRTF) を作る」。

### IBM i とソースを送受信する

ローカルのフォルダとソース・メンバーを次の形で対応させる。

```
src/<ライブラリー>/<ソース・ファイル>/<メンバー名>-<テキスト記述>.<ソース・タイプ>
例: src/MYLIB/QRPGLESRC/ORDR01-受注入力.rpgle
```

`-<テキスト記述>` は省いてよい。アップロードすると、テキスト記述とソース・タイプ（拡張子を大文字にしたもの）もメンバーに反映する。

**準備**（接続は SSH。IBM i 側で SSH サーバーが動いていること）

1. 設定（`Ctrl+,` で `ibmiSourceSync` を検索、または `settings.json`）:

   ```jsonc
   {
     "rpgClSupport.ibmiSourceSync.host": "ibmi.example.co.jp",
     "rpgClSupport.ibmiSourceSync.port": 22,
     "rpgClSupport.ibmiSourceSync.user": "MYUSER",
     "rpgClSupport.ibmiSourceSync.authMethod": "password",        // または "privateKey"
     "rpgClSupport.ibmiSourceSync.privateKeyPath": "",            // privateKey のとき秘密鍵の絶対パス
     "rpgClSupport.ibmiSourceSync.ifsTempDirectory": "/home/MYUSER/tmp",  // 書き込める既存の IFS フォルダ
     "rpgClSupport.ibmiSourceSync.hostKeySha256": "SHA256:..."    // 必須。下の方法で調べる
   }
   ```

   ホスト鍵の指紋は `ssh-keyscan -p 22 <ホスト> 2>/dev/null | ssh-keygen -lf -` で出る
   `SHA256:...` を入れる（ED25519 の行をまず試す）。
2. コマンド「IBM i 同期: 認証情報を保存」でパスワード（秘密鍵ならパスフレーズ）を保存する。
   保存先は VS Code の SecretStorage で、`settings.json` には書かない。

**1 メンバーずつ**: ソースを開いて右クリック →「IBM i: 現在のソースをアップロード」／「ダウンロード」。

**ソース・ファイル単位**: エクスプローラーで `src/<ライブラリー>/<ソース・ファイル>` フォルダを右クリック →
「IBM i: ソース・ファイル単位で送受信」（ローカルにまだフォルダが無いときはコマンドパレットから開き、
ライブラリーとソース・ファイルを入力する）。

- 向き（ダウンロード／アップロード）を切り替え、転送するメンバーをチェックボックスで選んで「転送」。
- 転送元・転送先の更新日時・行数・テキスト記述が並び、新しい方に印が付く。
- 「差分」で転送前に中身を比べられる（左が転送先、右が転送した後の姿）。
- 転送先の方が新しいメンバーを上書きするときだけ確認が出る。
- 未保存の変更があるファイルは転送しない。

### RPGUnit のテストを回す

[Code for IBM i](https://marketplace.visualstudio.com/items?itemName=halcyontechltd.code-for-ibmi) で
IBM i に接続した状態で、VS Code の Test Explorer（テスト・ビュー）から実行する。IBM i に RPGUnit が入っていること。

- `src/<ライブラリー>/<ソース・ファイル>/` の `.rpgle` / `.sqlrpgle` はソース・メンバーへ送ってコンパイルする。
- `*.test.rpgle` / `*.test.sqlrpgle` は、Code for IBM i のデプロイ先（IFS）のソースからコンパイルする。
- バインドするサービス・プログラムなどは、IBM i Testing 拡張と同じ `testing.json` から読む。

VS Code を使わずに回すときは `tools/run-rpgunit.mjs`（[tools/README.md](tools/README.md)）。

### コマンドラインの道具（VS Code 不要）

`vscode-extension/` で `npm install && npm run compile` の後:

```sh
node out/cli/lint.js --format text <ファイル…>     # 桁の検査。CI では既定の SARIF で出す
node out/cli/dds.js render --format text <.dspf|.prtf>   # 画面・帳票を文字で描く
```

詳しくは `--help`。桁の検査で VS Code の設定（`rpgClSupport.lint.maxColumn` / `rpgClSupport.cNewOpcodes`）を
変えているなら、同じ値を `--max-column` / `--c-new-opcode` で渡す（渡さないとエディタと CI で結果が食い違う）。

### 困ったとき

コマンド「Dogubako: 出力を表示」で拡張のログを見られる。

## 商標について

This project is not affiliated with or endorsed by IBM.
IBM, IBM i, and AS/400 are trademarks of International Business Machines Corporation.
本プロジェクトは IBM とは関係のない非公式のものです。
