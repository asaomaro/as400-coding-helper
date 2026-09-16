# 調査: IBM i ソースメンバー同期と可視 SEU 色属性

## 調査の問い

- Q1: Code for IBM i を介さず、拡張機能自身の設定と SSH/SFTP だけでメンバーを同期できるか。
- Q2: SEU/PDM の色属性バイトを UTF-8 経路で失わず、VS Code では入力可能かつ意味の分かる文字にできるか。
- Q3: 色を VS Code のテキスト編集と同時にどう描画するか。
- Q4: 認証情報・CCSID・一時 IFS ファイルの扱いを安全に確定できるか。
- Q5: アップロード時、ファイル名から抽出したテキスト記述・ソース・タイプを、既存メンバー・未作成メンバーの両方へどのコマンド列・順序で反映できるか。
- Q6: 対象拡張子ごとの SRCTYPE 値はどう決まるか。機械的に決まらないものはあるか。
- Q7: 自由記述のテキスト記述値を CL コマンド文字列へ埋め込む際、エスケープ・注入の懸念はないか。

## 判明した事実

### F1: Code for IBM i の利用は適さない

- Code for IBM i は公開 API から拡張機能の exports を取得する形で連携できるが、API は変更され得ると明記している。今回の要件は接続定義と認証情報を本拡張で所有するため、この依存は置かない。([Code for IBM i API](https://codefori.github.io/docs/dev/api/))
- 同拡張は **2.15.0 以降 SEU colours をサポートしない** と明記し、5250 プロトコルの表示であって標準のソースメンバー機能ではないためとしている。色を消去する既存方針とは目的が逆である。([Code for IBM i: SEU Colours](https://codefori.github.io/docs/tips/seucolours/))
- よって、IBM i への SSH 接続で CL を実行し、同じ接続の SFTP サブシステムで IFS の一時ファイルを転送する自前実装が要件に合う。`ssh2` は SSH 認証、非対話 `exec`、SFTP を一つの Node.js クライアントで提供する。([ssh2 README](https://github.com/mscdex/ssh2/blob/master/README.md))
- 現在の `vscode-extension/package.json` には runtime dependency が無い。`ssh2` を直接依存として追加し、ラッパーを増やさない。

### F2: 5250 の基底色と属性バイト

IBM 原典の 5250 表示属性表では、完全カラー時の基底値は `20`=green、`22`=white、`28`=red、`30`=turquoise、`32`=yellow、`38`=pink、`3A`=blue である。`28` は赤として明記されている。([IBM: DSPATR の有効な P フィールド値](https://www.ibm.com/docs/en/i/7.6.0?topic=keyword-valid-p-field-values))

リポジトリーに保存した原典も同じ表を持つ: `docs/origin/dds/detail/rzakc_rzakcmstdfdspat.htm:147-253`。この表は 5250 属性の意味を確定する根拠である。SEU がソース行へ入れた属性を 5250 がどう色として描くかについては、ユーザーが指定した PDM/SEU の運用と一致する。

### F3: CCSID 5035 の実機往復で、色バイトを失わない経路を確認した

検証は `.aidev/works/20260910-ibmi-source-member-sync/verify/probe-seu-source-color.mjs` で行った。毎回ランダム名の source PF と IFS ファイルだけを作成し、`finally` で削除する。既存資源には触れない。

実測結果（IBM i、source PF CCSID 5035）:

```
source-prefix-hex=C120C222C328C430C532C638C73AC8
utf8-hex=41C28042C28243C28844C290451646C29847C29A48C28E0D0A
```

これは次を意味する。

| 色 | IBM i 属性バイト | `CPYTOSTMF ... STMFCCSID(1208)` 後の Unicode | UTF-8 |
|---|---:|---:|---:|
| green | `20` | U+0080 | `C2 80` |
| white | `22` | U+0082 | `C2 82` |
| red | `28` | U+0088 | `C2 88` |
| turquoise | `30` | U+0090 | `C2 90` |
| yellow | `32` | U+0016 | `16` |
| pink | `38` | U+0098 | `C2 98` |
| blue | `3A` | U+009A | `C2 9A` |

別途、UTF-8 の `ABC U+0088 DEF` を `CPYFRMSTMF ... STMFCCSID(1208)` で source PF に入れ、`SRCDTA` の 3 バイト目が `28` になること、そして再度 UTF-8 に戻ることを CCSID 37 と 5035 の双方で確認した。従って赤の `Ŕ ⇄ U+0088 ⇄ x'28'` は推測ではなく実機で往復を確認済みである。

`CPYTOSTMF` の出力は `CRLF` になることも実測した。ダウンロード時に VS Code 文書の改行へ正規化し、アップロード用の生成は `LF` の行区切りに正規化して `CPYFRMSTMF` に渡す。

### F4: 可視マーカー方式が桁位置と双方向入力を両立する

制御 Unicode をそのまま VS Code 文書に残すと入力・選択・表示が不安定で、yellow のように C0 制御文字になる値もある。各属性を**一文字の可視マーカー**に正規化すれば、属性バイト 1 個とマーカー 1 UTF-16 code unit が対応し、固定長の論理桁を増減させない。

設計へ渡す基底色マップ案:

| 色 | 可視マーカー | wire Unicode | IBM i バイト |
|---|---|---:|---:|
| green | `Ĝ` | U+0080 | `20` |
| white | `Ŵ` | U+0082 | `22` |
| red | `Ŕ` | U+0088 | `28` |
| turquoise | `Ŧ` | U+0090 | `30` |
| yellow | `Ŷ` | U+0016 | `32` |
| pink | `Ṕ` | U+0098 | `38` |
| blue | `Ḃ` | U+009A | `3A` |

`Ŕ` はユーザー指定どおりである。ダウンロードでは wire Unicode を可視マーカーへ、アップロードでは逆に変換してから UTF-8 化する。色の有効範囲はマーカー自身から次のマーカーの直前、または行末までとする。

原典には反転・下線などを含む 32 通りの属性値もある。今回の要求で first-class に扱うのは 7 基底色であり、基底色以外の属性バイトを黙って削除してはならない。設計では「受信を拒否して対象バイトを明示する」か「一意な追加マーカーを定義して往復する」かを決める必要がある。後者を推奨する（消失を防げるため）。

### F5: SFTP と CL コピーの順序、CCSID の扱い

実機で IFS ファイルを書いた file-server 接続を開いたまま `CPYFRMSTMF` すると `CPFA09E`（Object in use）になった。書込み/SFTP が終了してハンドルを閉じてから CL コピーを実行する必要がある。

確定した操作順:

```
download: SSH exec CPYTOSTMF -> SFTP get -> IFS delete (finally) -> wire→marker
upload:   marker→wire UTF-8 -> SFTP put -> SFTP close -> SSH exec CPYFRMSTMF -> IFS delete (finally)
```

`CPYTOSTMF` / `CPYFRMSTMF` は `STMFCCSID(1208) DBFCCSID(*FILE)` を指定する。`*FILE` は source PF 自身の CCSID を使うため、利用者が CCSID を二重管理する必要はない。CCSID 65535 の source PF は変換不能として IBM i が失敗させるので、その場合はメンバーを更新せず、source PF の CCSID を正しく設定するよう案内する。これは IBM 原典の `DBFCCSID(*FILE)` の規則に基づく。([CPYTOSTMF](https://www.ibm.com/docs/en/i/7.5.0?topic=c-copy-stream-file), [CPYFRMSTMF](https://www.ibm.com/docs/en/i/7.5.0?topic=c-copy-from-stream-file))

### F6: 資格情報の置き場

接続先、port、ユーザー、認証方式、鍵ファイルパス、IFS 一時ディレクトリは `settings.json` の非機密設定とする。source PF の CCSID は `DBFCCSID(*FILE)` で実機から取る。パスワードと鍵のパスフレーズは `ExtensionContext.secrets` にだけ保持する。VS Code の SecretStorage は暗号化され、Settings Sync の対象外である。([VS Code: Data Storage](https://code.visualstudio.com/api/extension-capabilities/common-capabilities))

ログ、通知、例外メッセージには password、passphrase、秘密鍵本文を含めない。秘密値が無い場合は「設定コマンドで保存する」をアクションとして出す。

### F7: 現在の拡張機能の実装アンカー

- 設定とコマンド寄与: `vscode-extension/package.json` の `contributes.configuration` / `contributes.commands`。
- 起動配線: `vscode-extension/src/extension/extension.ts` と `src/language/registration.ts`。
- 対象ファイルの単一真実源: `vscode-extension/src/utils/fileScope.ts` の `TARGET_EXTENSIONS` / `isInScopeDocument`。
- SOSI 表示の購読・破棄・対象外クリアの先例: `vscode-extension/src/language/dbcsShiftMarkers.ts`。色マーカーは保存文字そのものなので、SOSI の `before.contentText` を流用しない。一方で active editor / document change の購読、`setDecorations`、対象外でのクリアはそのまま踏襲できる。
- ユニットテストの vscode スタブ: `vscode-extension/test/support/vscode-stub.js`。SecretStorage、TextEditorDecoration、コマンド登録をテストできる形へ拡張が必要。

### F8: `CPYFRMSTMF` は宛先メンバーが無ければ自動作成する。`ADDPFM` は不要

IBM Documentation 原文（[CPYFRMSTMF](https://www.ibm.com/docs/en/ssw_ibm_i_74/cl/cpyfrmstmf.htm)）:

> "When copying to a database file member, the database file must exist. If the member does not exist, it is created."

つまり **宛先のソース物理ファイル（データベース・ファイル）自体は事前に存在している必要があるが、メンバーが無ければ `CPYFRMSTMF` が自動的に作成する**。既存実装（`vscode-extension/src/sync/ibmiSourceTransport.ts` の `buildCopyFromStreamFileCommand`）はすでに `MBROPT(*REPLACE)` で `CPYFRMSTMF` を呼んでおり、追加のコマンドを増やさずにメンバー未作成のケースへ対応できる。

`MBROPT` の値は次のとおり（同原典）: `*NONE`＝オブジェクトが存在すれば失敗・レコード複写なし、`*ADD`＝既存レコードの末尾に追加、`*REPLACE`＝既存レコードを置換。既存メンバーの内容を丸ごと置き換える現行仕様（AC2）と、新規メンバー作成（AC17）のどちらにも `MBROPT(*REPLACE)` のままで両立する。

ライブラリーまたはソース物理ファイル自体が存在しない場合の挙動は、原典に明示的な記載が無い（権限節に "Add (*ADD) authority to the database member's library if the database member does not already exist." とあるのみ）。メッセージ番号（CPF prefix 等)での判別は原典からは確定できず、**実機での確認、または既存の汎用エラー分類（`kind: "copy"`）で「理由を示す」要件を満たす設計判断のどちらかが必要**（design への申し送りに記載）。

### F9: `CHGPFM` で SRCTYPE と TEXT を同時に反映できる。実行順は「内容コピー → CHGPFM」

`ibmi-remote` skill（`.claude/skills/ibmi-remote/SKILL.md:1`）に、pub400 実機で確認済みの手順として次が明記されている:

```
system "CPYFRMSTMF FROMSTMF('...') TOMBR('/QSYS.LIB/<LIB>.LIB/QRPGLESRC.FILE/MYPGM.MBR') MBROPT(*REPLACE) STMFCCSID(1208)"
system "CHGPFM FILE(<LIB>/QRPGLESRC) MBR(MYPGM) SRCTYPE(RPGLE)"
```

同 skill の hostserver 経路の最小レシピ（`SKILL.md:` 6.2 節）でも `CPYFRMSTMF` の**直後**に `CHGPFM ... SRCTYPE(...)` を呼んでおり、「ソースタイプはコピーだけでは付かない。別途 `CHGPFM` で設定する」と明記されている。

本 PJ の CL プロンプター定義（原典から生成済み・機械照合済み）で `CHGPFM` の `TEXT` パラメーターを確認したところ、`SRCTYPE` とは独立した別パラメーターであり、同一コマンド呼び出しに両方を指定できる（`vscode-extension/resources/prompter/cl/ja/CHGPFM.json`）。したがって新設コマンドは 1 回で済む:

```
CHGPFM FILE(<LIB>/<SRCPF>) MBR(<MBR>) SRCTYPE(<拡張子由来の値>) TEXT('<抽出したテキスト記述>')
```

実行順は「`CPYFRMSTMF`（内容コピー。メンバー未作成なら同時に作成）→ `CHGPFM`（属性反映）」で、既存メンバー・新規メンバーの両方に同じ順序が適用できる。`CHGPFM` は対象メンバーの存在を前提とするため、`CPYFRMSTMF` より先には呼べない。

### F10: 桁数上限は既存の CL コマンド定義（原典照合済み）から取得済み

`vscode-extension/resources/prompter/cl/ja/ADDPFM.json` の `TEXT` パラメーター: `attributes.maxLength: 50`、`characterSet: "upper"`。`SRCTYPE` パラメーター: `attributes.maxLength: 10`、原文ヘルプに「最初の文字は英字（`\`, `@`, `#` を含む）でなければならず、残りの文字は英数字または下線でなければならない」とある。`CHGPFM.json` も同じ制約を持つ。これらはこの PJ の検証規約（`docs/origin/verify-cl-definitions.mjs`）で原典と機械照合済みの値であり、新たに一次資料を当たる必要は無い。

メンバー名の規則は既存の `IBM_I_OBJECT_NAME`（`vscode-extension/src/sync/memberTarget.ts:8`）`^[A-Z$#@][A-Z0-9_$#@]{0,9}$` がそのまま IBM i オブジェクト名の一般規則と一致し、流用できる。

### F11: SRCTYPE の拡張子対応は概ね機械的だが、`.dds` は実世界の慣行が無い

対象拡張子（`vscode-extension/src/utils/fileScope.ts:12-40` の `TARGET_EXTENSIONS`）のうち、`rpg`・`rpgle`・`sqlrpgle`・`sqlrpg`・`clp`・`clle`・`pf`・`lf`・`dspf`・`prtf`・`cmd` は大文字化するだけで実務の SRCTYPE 慣行と一致する（`ibmi-remote` skill の実機確認済み例でも `SRCTYPE(RPGLE)` のように拡張子の大文字化がそのまま使われている）。

`mnudds` は AGENTS.md の既存知見（DSPF と同じ A 仕様書の固定長）から `MNUDDS` を充てるのが妥当。一方 `dds`（AGENTS.md 記載どおり「`.dds` と名付ける環境への保険」であり実務の主形ではない）は、対応する実機の慣行が無い。原典・実機のどちらにも「`.dds` の SRCTYPE はこれ」という一次資料が存在しないため、この対応だけは **PJ 側の設計判断**（例: 汎用値を割り当てる／このケースだけ SRCTYPE 反映を対象外にする）が必要であり、design への申し送りとする。

### F12: テキスト記述の CL コマンド注入リスク

現行の `buildCopyFromStreamFileCommand` 等は `${target.library}` 等、`IBM_I_OBJECT_NAME` で検証済みの値だけをテンプレートリテラルへ埋め込んでおり、注入の懸念が無い。今回新設する `CHGPFM ... TEXT('<自由記述>')` は、**ファイル名から取り出した未加工の文字列**を CL 文字列リテラルへ埋め込む初めてのケースである。

CL の文字列リテラルはアポストロフィを `''`（2 個）でエスケープする規則があり、原文をそのまま埋め込むと、テキスト記述に `'` が含まれた場合に CL 構文が壊れる（意図しないパラメーターの注入・コマンド解析エラーにつながり得る）。本コマンドは `ssh2` の `client.exec()` へ直接渡す 1 個の文字列であり、ローカル shell を経由しないため `ibmi-remote` skill が警告する「3 層の引用符」問題（ローカル shell / ssh / CL）は当てはまらないが、**`system "..."` の外側二重引用符と CL 文字列リテラルの単引用符、少なくとも 2 層のエスケープ**は設計で扱う必要がある。

## 実現性とリスク

| リスク | 対応 |
|---|---|
| SSH と SFTP を別接続・別認証で実装してずれる | `ssh2` の一接続から exec と SFTP を開く薄い adapter に閉じる。 |
| SFTP close 前の CL コピー | upload adapter の操作順を直列化し、実機回帰テストに `CPFA09E` が出ないことを入れる。 |
| 色マーカーを通常文字として保存 | upload 時の全変換を純粋関数にし、marker/wire/byte の表駆動ラウンドトリップを全値で検査する。 |
| 色範囲と VS Code の構文色が競合 | decoration の foreground を属性開始から次の属性直前まで適用し、各文書変更で再計算する。 |
| CCSID 65535 の source PF | `DBFCCSID(*FILE)` の IBM i 変換エラーを捕捉し、元メンバーを更新せず設定修正を通知する。 |
| 一時 IFS ファイルが残る | UUID を含む接続専用パス、成功・失敗とも `finally` で SFTP delete。 |
| テキスト記述に含まれる `'` による CL 構文破壊・注入 | `CHGPFM` の `TEXT('...')` 生成時に `'` を `''` へエスケープする専用関数を作り、他の値と同じテンプレートリテラル直書きにしない（F12）。 |
| ライブラリー／ソース物理ファイル未存在の判別が原典から確定できない | メッセージ番号での精密な分類を design の必須要件にはせず、既存の汎用エラー分類（`kind`）を流用する／実機確認できる場合のみ精密化する、のいずれかを design で判断する（F8）。 |
| `.dds` の SRCTYPE 対応が一次資料から決まらない | design で PJ 側の既定値または対象外の判断を明示する（F11）。 |

## 実装アンカー（追加分）

- A1: メンバー名・ライブラリー・ソース物理ファイルの解決 — `vscode-extension/src/sync/memberTarget.ts:8`（`IBM_I_OBJECT_NAME`）, `:18`（`resolveMemberTarget`）。テキスト記述抽出・`_` 分割ロジックをここに追加するか別関数に分けるかは design 判断。
- A2: アップロード時の CL コマンド生成 — `vscode-extension/src/sync/ibmiSourceTransport.ts:271`（`buildCopyFromStreamFileCommand`）。`CHGPFM` 用の新しい builder 関数をここに追加する対称的な設計にできる。
- A3: アップロードのコマンドハンドラー — `vscode-extension/src/extension/commands/memberSync.ts:43`（`runTransfer`）。アップロード前のローカル検証（命名規則・桁数）とエラー通知の追加箇所。
- A4: 対象拡張子の単一真実源 — `vscode-extension/src/utils/fileScope.ts:47`（`TARGET_EXTENSIONS`）。SRCTYPE 対応表を新設する場合、ここからの導出を検査する仕組み（既存の `verify-contributes.mjs` 相当）を検討する。

## design への申し送り

1. `ssh2` を使う `IbmiSourceTransport` を定義し、SSH exec / SFTP / cleanup / エラー正規化を UI と分離する。
2. `visibleColorMarkers.ts` を純粋関数にし、wire Unicode ↔ marker ↔ 色属性の表を唯一の真実源にする。7 基底色を実装し、残る属性値を一意マーカーで保持する方針を具体化する。
3. IFS temp directory を必須の非機密設定にし、CCSID は `DBFCCSID(*FILE)` に任せる。password / passphrase は SecretStorage の設定コマンドだけで設定する。
4. ダウンロード、アップロード、資格情報設定、色表示オンオフのコマンドと editor/context メニューを設計する。
5. 実機検証は本プローブを維持し、赤 `Ŕ` の入力から `x'28'` が同位置に戻ること、7 色の wire map、DBCS 行、IFS cleanup を受け入れ条件にする。
6. ファイル名からのメンバー名・テキスト記述抽出は `resolveMemberTarget`（`memberTarget.ts`）と対称の純粋関数として設計し、ローカル検証（命名規則・50/10 桁）を IBM i への接続前に完結させる（F10）。
7. アップロードのコマンド列は「`CPYFRMSTMF`（内容コピー・メンバー未作成なら自動作成）→ `CHGPFM SRCTYPE(...) TEXT('...')`（属性反映）」の順で統一し、新規メンバー用の別経路（`ADDPFM`）は設けない（F8, F9）。
8. `CHGPFM` の `TEXT('...')` を組み立てる際は、アポストロフィのエスケープ（`'` → `''`）を行う専用の builder 関数にする。既存の `buildCopyFromStreamFileCommand` と同様、値の直書きにしない（F12）。
9. `.dds`（保険用拡張子）の SRCTYPE 対応と、ライブラリー／ソース物理ファイル未存在時のエラー分類の精度は、一次資料からは確定できなかった。design で PJ 側の判断として明記する（F8, F11）。
