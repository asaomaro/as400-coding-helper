# 通し確認の手順

拡張機能の機能を一通り目で確かめるための手順。ここにあるソースは
**すべて実機（pub400 / IBM i 7.5）でコンパイルが通ることを確認済み**なので、
「サンプルが間違っているのか、拡張機能が間違っているのか」で迷わずに済む。

| ソース | 作成物 | 主に確かめるもの |
|---|---|---|
| `CUSTMST.pf` | `CRTPF` | DDS(物理) のルーラー・F4・キーワード補完 |
| `CUSTLF1.lf` | `CRTLF` | DDS(論理) の選択/省略・キーのレベル |
| `CUSTMNT.dspf` | `CRTDSPF` | DDS(表示) のレベル別補完 |
| `CUSTRPT.prtf` | `CRTPRTF` | DDS(印刷) の桁と補完 |
| `DBCSSAMP.pf` | `CRTPF` | SOSI 表示（`{` `}`）と桁合わせ |
| `ADDCUST.cmd` | `CRTCMD` | `.cmd` のルーラー・F4（CMD/PARM/ELEM/QUAL/DEP） |
| `IOSAMP.rpgle` | `CRTBNDRPG` | RPG の I/O/P 仕様書のルーラー・F4 |
| `SLSENT01.rpgle` / `EMPMNT01.rpgle` | — | RPG の H/F/D/C 仕様書、補完 |
| `RPG3SAMP.rpg` | — | RPG III の桁（ILE と違うこと） |
| `DYBAT001CL.clp` | — | CL の継続行（`+`）をまたぐ F4 |

## 準備

0. 初回のみ `cd vscode-extension && npm install`。`out/` は追跡していないため
   ビルドが要る（F5 起動時のタスクが compile するので手で叩かなくてよい）。
1. **WSL に接続した状態**でリポジトリのルートを開く（左下が `WSL: Ubuntu`）。
   UNC パス（`\\wsl.localhost\...`）で開くとコンパイル・タスクが失敗する。
2. **F5** で拡張機能を起動する。別ウィンドウが `docs/src` を開いて立ち上がる。
3. ステータスバーの `Ruler:` に **⚠ が出ていたらクリック**する。
   CodeLens の字体がエディターと違うとルーラーの桁が合わない。

## 1. ルーラー

- [ ] `IOSAMP.rpgle` の C 仕様行にカーソルを置くと、**行の上にルーラーが1行**出る
- [ ] **上の行のコードが隠れていない**（覆うのではなく差し込まれている）
- [ ] `OpCode` の `O` が `EVAL` の `E` の真上に来る（ILE の命令コード欄は 26 桁目）
- [ ] `RPG3SAMP.rpg` では `Opcde` が **28 桁目**に来る（ILE とは桁が違う）
- [ ] `CUSTMST.pf` で `名前` `長さ` `データ・タイプ` などの欄名が桁どおりに出る
- [ ] `ADDCUST.cmd` で `Label` / `Statement` / `Parameters` が出る
- [ ] ステータスバーの `Ruler:` クリックで Cols と Full が切り替わる（消えない）
- [ ] コマンド「ルーラー: 表示の切り替え」で消える／戻る（戻ると消す前のモード）

## 2. F4 プロンプター

- [ ] `DYBAT001CL.clp` の**継続行（2行目以降）**にカーソルを置いて F4 → 開く
- [ ] 確定すると、**触っていない省略可能パラメータが書き足されない**
- [ ] `CUSTMST.pf` の `CUSTNO` 行で F4 → 桁どおりに欄が読める
- [ ] `データ・タイプ` が選択欄になっている（`P` `S` `A` … と `5`）
- [ ] 長さを `10` に変えて確定 → **右寄せ**で書かれる（`        10A`）
- [ ] `ADDCUST.cmd` の `PARM` 行・`QUAL` 行（ラベル `Q1:` 付き）で F4 → 開く
- [ ] `IOSAMP.rpgle` の I 仕様・O 仕様・P 仕様の各行で F4 → 開く
- [ ] 何も変えずに確定 → **行がまったく変わらない**（桁が崩れない）

### 入れ子プロンプター（F4 in F4）

- [ ] CL ソースに `SBMJOB CMD(CALL PGM(MYPGM))` と書いて F4
- [ ] `CMD` 欄の右の `F4` ボタン（または欄にフォーカスして F4）で内側が開く
- [ ] 内側を確定すると `CMD` 欄に `CALL PGM(...)` が戻る

## 3. 補完

- [ ] `IOSAMP.rpgle` の C 仕様 26 桁目で命令コードが出る
- [ ] `%` を打つと組み込み関数が出る
- [ ] `RPG3SAMP.rpg` では `%` で**何も出ない**（RPG III に組み込み関数は無い）
- [ ] `RPG3SAMP.rpg` の命令欄で `LOKUP` が出て `EVAL` が**出ない**
- [ ] `CUSTMNT.dspf` の**ファイル・レベル**（最初の `R` より前）で `DSPSIZ` が出て
      `COLOR` が**出ない**
- [ ] レコード行の続きで `OVERLAY` が出る
- [ ] フィールド行の続きで `COLOR` / `DSPATR` が出る

## 4. SOSI 表示

- [ ] `DBCSSAMP.pf` で DBCS の前後に `{` `}` が表示される
- [ ] 表示された状態でも**ルーラーの桁とコードの桁が合っている**
- [ ] ステータスバーから表示を切り替えられる

## 5. 表示言語

- [ ] 設定 `rpgClSupport.language` を `en` にすると CL / DDS / CMD / RPG(ILE) の
      F4 が英語で出る
- [ ] `.rpg`（RPG III）は `en` でも日本語で出る（英語原典が無いため）
- [ ] 言語を変えても**書き戻し結果は変わらない**

## 実機で作り直すとき

サンプルを直したら、実機でコンパイルが通ることを確かめること。桁が 1 つずれても
コンパイルは通らない（＝サンプルの正しさの担保になる）。

```sh
# 例: 物理ファイル
scp docs/src/CUSTMST.pf <user>@pub400.com:/home/<user>/
ssh <user>@pub400.com -p 2222
system "CPYFRMSTMF FROMSTMF('/home/<user>/CUSTMST.pf') TOMBR('/QSYS.LIB/<lib>.LIB/QDDSSRC.FILE/CUSTMST.MBR') MBROPT(*REPLACE)"
system "CRTPF FILE(<lib>/CUSTMST) SRCFILE(<lib>/QDDSSRC) SRCMBR(CUSTMST) MBR(*NONE)"
```

作ったサンプルで実際に踏んだ誤り（いずれもコンパイルが教えてくれた）:

- DDS の定数フィールドに長さと型を書いていた（`CPD7434`）
- 参照フィールドを使うのに `REF()` が無かった（`CPD5252`）
- 印刷装置ファイルの位置欄を 7 文字にして 45 桁目にはみ出していた
- `SPACEA`/`SKIPB` を使う様式で行番号を書いていた（`CPD7860`）
- RPG の I 仕様のフィールド位置を右詰めにしていなかった（`RNF0263`）
- コマンド定義の修飾子に `MIN(1)` が無く空の既定値が問題になった（`CPD0251`）
