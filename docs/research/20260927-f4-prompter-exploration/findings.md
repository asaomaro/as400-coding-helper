# F4 プロンプター 実操作調査（本物の VS Code・2026-09-27）

> 調査はサブエージェントが本物の VS Code（port 47112・`vscode-extension/.vscode-test/f4-explore`）で行い、主エージェントが保存した。
> 主エージェントの裏取り: P2 は `vscode-extension/src/language/rpgEditGuards.ts:11` の `if (line === 3)` を直読して確認。
> この判定は `applyChanges.ts:63`（DDS 以外＝RPG と CL）と `rpgTabNavigation.ts:371,397` から呼ばれるので、CL の 4 行目・Tab 移動も同じく影響を受けると見られる（未実操作）。

## 調査の方法
- 起動: `driver.mjs` から playwright `_electron` で `.vscode-test` の VS Code を起動した（port 47112、user-data-dir `vscode-extension/.vscode-test/f4-explore`）。
- 操作: 利用者と同じ手順（ソース行にカーソルを置いて F4 → 欄に入力して OK → 保存したファイルを桁単位で確認）。
- 定義言語: `rpgClSupport.language: "ja"`（VS Code の表示言語が英語なので、auto のままだと en 定義になる）。
- エディター設定: 補完の自動確定と括弧の自動補完は切った（手入力を混ぜないため。プロンプターの挙動には関係しない）。
- 成果物: `ws/CMPLXR.rpgle`, `ws/CMPLXPR.rpgle`, `ws/CMPLXC.clle`。DDS の試験は CMPLXD / CMPLXP のコピー（`ws/CMPLXDCP.dspf`, `ws/CMPLXPCP.prtf`。PRTF の 26-28 行はプロンプターが誤って書いた行で証拠として残す）。
- 桁の書き方: 「桁番号+文字」。例 `9O 10F` は 9 桁目が O、10 桁目が F。
- 区分: **コード**＝拡張のコードの欠陥／**定義**＝定義 JSON の誤りや不足／**機能不足**＝仕組みそのものが無い。

## 重大

### P1 H 仕様書プロンプターは何も書き戻さず、既存の値も読み込まない（コード＋定義）
- 操作: 1 行目に `     H` を打って F4。DFTACTGRP=*NO, ACTGRP=*NEW, DATFMT=*ISO を入れて OK → 行は `     H` のまま、通知も出ない。
- 逆方向: `     H DFTACTGRP(*NO) ACTGRP(*NEW)` の行で F4 しても全欄が空で開く。
- 原因: `H-SPEC.json` の欄はキーワード形式で `sourceStart` を持たない。`commandText.ts` の `buildRpgLineText` は桁情報が 1 つも無いと `return original`。
  読み込み側の `extractByColumns` も桁が前提。H 仕様書のキーワードを組み立てる／解析する処理がどこにも無い。
- 証拠: `shots/03-hspec-filled.png`, `shots/04-hspec-existing-not-read.png`

### P2 RPG ソースの 4 行目だけ書き戻されない（コード）
- 操作: 4 行目の `     D` で F4。NAME=F3, FROM=3, LEN=3 を入れて OK → 4 行目は変わらない（`shots/09-line4-before-ok.png`, `10-line4-not-written.png`）。`CMPLXPR.rpgle` の 4 行目でも再現。
- 原因: `src/language/rpgEditGuards.ts:3-20` の `isEditAllowedRange`。`if (line === 3)`（0 始まりなので 4 行目）で開始桁が 6 未満なら false。
  `applyChanges` は常に 0 桁目から行全体を置き換えるので 4 行目は必ず拒否。拒否はログにしか出ず、利用者には知らされない。デバッグ用の固定値が残っていると見られる。

### P3 桁幅を超えた値が左側から黙って切り捨てられる（コード＋定義）
- C 仕様: 空の `     C` で F4（旧形式が開く）→ OPCODE=EVAL、FACTOR2=`DSPDATE = %DEC(%DATE():*YMD)` → `     C                   EVAL      (%DATE():*YMD)`（右端 14 文字だけ残る。エラー無し。`shots/12`）。
- D 仕様: KEYWORDS に `EXTPROC('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123')`（40 文字）→ `PROC('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123'`（`shots/16`）。
- 原因（コード）: `buildRpgLineText` の `trimmed.slice(-sourceLength)`。原因（定義）: `maxLength` が桁幅より大きい（C-SPEC の FACTOR1/FACTOR2/RESULT 30＞14、D-SPEC の KEYWORDS 40＞37、FROM 30＞7）。
- 期待: 桁幅を超えたら欄にエラーを出して確定を止める。

### P4 trim の後に左詰めするため、次の欄が正しい桁に書けない（コード＋定義）
先頭の空白は trim で消えるので回避策も無い。

| 欄 | 入力 | 書かれた桁 | 正しい桁 | 証拠 |
|---|---|---|---|---|
| C 仕様 条件標識 9-11 | `OF` | `9O 10F`（9 桁目は N 欄） | 10-11 | CMPLXPR.rpgle:27-30 は手で修正。shots/19 |
| C 仕様 結果標識 71-76 | `    50`（EQ 位置のつもり） | 71-72（HI 位置） | 75-76 | READC の EOF 標識が置けない |
| DSPF 条件付け 8-16 | `40` | 8-9 | 9-10 | shots/30 |
| DSPF 小数部 36-37 | `0` | 36 | 37 | shots/30 |
| DSPF 位置 39-44 | `7 74` | `397 417 424` | 行 `  7` / 桁 ` 74` | shots/30（拡張自身の lint が `layout-invalid-position`） |
| PRTF 位置 39-44 | `10`（桁のつもり） | 39-40（行 10 の扱い） | 42-44 | CMPLXPCP.prtf:27, shots/33 |
| PRTF 小数部 | `0` | 36 | 37 | CMPLXPCP.prtf:28 |
| D 開始位置 26-32 | `12` | 26 から左詰め | 右寄せの可能性（要実機確認） | CMPLXR.rpgle:5-11（4 行目は右寄せの対照） |

- 定義側: DDS の位置は行（39-41）と桁（42-44）を 1 つの 6 桁欄に、条件付けも N＋標識×3 を 1 欄にしている。小数部に `numericOnly` が無い。
- 原典: C 仕様の条件標識は `docs/ILE_RPG_Fixed_Format_Reference.md:559-578`。

### P5 C-NEW の判定が「7 桁目以降の最初の語」で行われる（コード）
- 26 桁目に `EVAL(H)` → F4 で C-SPEC（旧形式）が開く（`shots/13`）。10-11 桁に `OF`・26 桁目に `EVAL` の行も C-SPEC が開く（`shots/34`）。
- 原因: `src/core/rpgSpec.ts:299-311` の `classifyCSpec` が `text.slice(6).trim().split(/\s+/)[0]` を命令とみなす。演算拡張 `(H)` や条件標識・演算項目 1 がある行を誤認。
- 波及: 同じ判定の lint が、正しい `EVAL(H)` 行（CMPLXR.rpgle Ln26 Col64）に「フィールド長は右寄せで書きます」を誤って出す（`shots/18`）。P3 と重なると式が黙って壊れる。

### P6 DDS のキーワード欄（45-80）が英大文字しか受け付けない（定義）
- 小文字 `'Search: …'` は「英大文字で入力してください。」、DBCS `'顧客名で絞り込みます（部分一致）'` は「使用できない文字が含まれています。」で弾く（`shots/31`）。
- 既存の `1 28'顧客照会（サブファイル）'` 行で F4 し、何も変えずに OK しても確定できない（`shots/32`）。
- 原因: `DDS-DSPF.json` / `DDS-PRTF.json` の `C45` に `characterSet: "upper"`。日本語の定数はプロンプターで扱えない。

## 中

### P7 必須指定が強すぎて、正しい行を確定できない（定義）

| 仕様書 | 必須になっている欄 | 書けなくなる正しい行 | 証拠 |
|---|---|---|---|
| D | LEN | 長さの無い DS、定数 C、戻り値の無い PR / PI | shots/11, 11b, 11c |
| F | FILENAME, FILETYPE | キーワードだけの継続行 | shots/06 |
| P | PROCNAME | 名前を省いた E 行 | shots/36 |
| C-NEW | COND | ELSE / ENDIF / SELECT / OTHER / ENDSL | shots/35 |

- C-NEW は矛盾: `rpgSpec.ts` の `NO_OPERAND_OPCODES` がこれらの命令を C-NEW に分類しているのに、定義は COND を必須にしている。

### P8 D 仕様のデータ・タイプの選択肢が足りない（定義）
- A P S B I F D T Z のみ。N（標識）・G（図形）・C（UCS-2）・U（符号なし整数）・*（ポインター）が無い（PJ の md `:296-330` には載っている）。
- INDDS の標識サブフィールド 8 行の 40 桁目 `N` は手で入力した（`shots/08`）。

### P9 表示されない欄があり、表示する手段も無い（定義＋コード）
- D 仕様の DEC（41-42）、F 仕様の LIMITS（28）・RECADDR（34）・FILEORG（35）。`visibleByDefault: false`・条件表示の規則が無い・basic の情報が無く F10 も出ない。
- 新しい行で `7P 0` の小数部が入れられない。34 桁目の `K` が入れられず、`FCUSTMST IF E K DISK`（最も一般的な F 仕様）が書けない。

### P10 C-NEW 定義に条件標識（9-11 桁）の欄が無い（定義）
- 原典 `C-SPEC-extended-factor2-syntax.html` はこの形式にも 9-11 桁の標識を挙げている。

### P11 F 仕様の欄ラベルの桁番号が誤っている（定義。PJ の md も誤り）
- ラベル「ファイル形式（19 桁）」「レコード長（20-23）」「制限処理（24-27）」「レコード・アドレス・タイプ（28）」「ファイル編成（29-33）」「装置（34-42）」。
  書く桁は正しい（22 / 23-27 / 28 / 34 / 35 / 36-42。原典 `docs/origin/ilerpg/F-SPEC-layout.html` と一致）。
- ラベルは `docs/ILE_RPG_Fixed_Format_Reference.md:160-172` の誤った表から来たと見られる（同 md の「29-33 桁目に K」も誤りで、FILEORG の placeholder `K` もこれ由来）。
- ENDFILE / FILEADD / SEQUENCE は選択肢も説明も無い。

### P12 名前欄が英大文字しか受け付けない（定義）
- D の NAME、P の PROCNAME（`characterSet: "upper"`）。`loadSubfile` は確定できない（`shots/15`）。ILE RPG の名前は大小文字が混在してよい。

### P13 CL: 空白や DBCS を含む値を自動で引用符で囲まない（コード）
- `SNDPGMMSG  MSG(CMPLXPR で印刷エラーが発生しました)` と書かれる（`shots/24`。コンパイルできない）。SEU のプロンプトは自動で `'…'` を付ける。
- 原因: `commandText.ts` に引用符付けと `'` の二重化が無い。欄に `'…'` を自分で入れれば往復は正しい。

### P14 DBCS の SO/SI を桁計算に入れていない（コード）
- RPG: MOVEL の演算項目 2 に `'無効なオプション'`。文字数では 14 桁に収まり MSG は 50 桁目に書かれたが、実際は 20 バイトで 36-55 桁を占め MSG と重なる（`shots/14`）。
- CL: 67 文字の行が SO/SI 込みで 82 バイト。72 桁の折り返しを文字数で判定しているので折り返されず 80 桁を超える（`shots/25`）。

### P15 空行で F4 が効かず、C-SPEC と C-NEW を画面で切り替えられない（機能不足）
- 空行で F4 → 「F4 prompter is only available for RPG/CL commands.」（英語。`shots/01`）。仕様書文字や CL のコマンド名を先に打つ必要がある。
- C-NEW は 26 桁目に命令を手で打ってからでないと開かない。空の `C` から始めると旧形式になり、EVAL を選ぶと P3 で式が壊れる。

## 軽微
- P16 CL の既定値の出し方が不統一（`CALL PGM(*LIBL/CMPLXPR)` は既定の *LIBL まで書く、`FILE(CMPLXP)` は書かない、`PAGESIZE(66 132 *ROWCOL)` は既定の単位まで書く）。
- P17 CL の DCL で LEN / VALUE が F10（追加パラメーター）の奥（`shots/20`, `21`、要確認）。LEN のヘルプは「最大長は次の通りです。」の後の表が抜けている。
- P18 C 仕様の F1 ヘルプが命令と無関係（「右オペランド。…」、`shots/17`）。OPCODE の候補一覧も無い。
- P19 取消は Esc のみ。SEU の F12 / F3 は効かない。
- P20 確定後のカーソルは元の位置に戻るだけで次の行へ進まない。CL が 2 行に折り返されたとき、続けて次の行を作ると継続行の途中に入る。
- P21 D 仕様の名前は 15 桁を超える継続（`...`）が書けない。サブフィールドの字下げは trim で消える。
- P22 誤解を招く placeholder: FILEORG の `K`、LEN の `10`。

## 手入力した行
- CMPLXR.rpgle: 1 行目（P1）／4 行目（P2。開始位置を右寄せにして対照）／4-11 行の 40 桁 `N`（P8）／12, 17, 20, 63 行（P7）／13, 15, 18 行の 41-42 桁（P9）／
  26 行目（P5・P3）／29, 31, 32, 41, 47 行（ELSE / ENDIF / ENDFOR。命令だけ手で）／85 行目（P7）／C-NEW の行は全て 26 桁目の命令だけ先に手で打った。
- CMPLXPR.rpgle: 1 行目（P1）／3, 9 行目（P7）／4-8 行目（P2 で 1 行ずれたため修正。あわせて P9）／16, 18, 19 行目（ELSE / ENDIF / ENDFOR）／27-30 行の 9-11 桁（P4）。
- CMPLXC.clle: 7 行目（引用符を欄に手で入れた。P13）。それ以外は全てプロンプター。

## 良かった点
- 桁情報のある F / D / C / P は、単純な値なら正しい桁に書ける（F 仕様の行、C の演算項目、`SETON` の `LR`（71-72）、C-NEW の式、数値の LEN の右寄せ）。
- 既存行の読み戻しは正確（14 桁ちょうどの演算項目 2 と結果の隣接、DBCS を含む C-NEW の式。無変更で確定しても崩れない）。
- CL は実用になる（OVRPRTF の要素リスト、72 桁の `+` 折り返し、継続行上の F4、MONMSG EXEC の F4 in F4（`shots/26`, `27`））。
- 検証メッセージが欄の下に出て、止めた欄にフォーカスが移る。F1 ヘルプと F10 も動く。
- 拡張自身の lint が、プロンプターの誤った出力（DDS の位置欄）を検出した。

## 実機のコンパイルで分かったこと（主エージェント・2026-09-27）

- **P4 を実機で確認**: `CMPLXR.rpgle` 5-11 行（D 仕様の開始・終了位置をプロンプターが左詰めで書いた行）は `RNF0263`（重大度 20）
  「項目は右寄せされなかった」× 7。右寄せで手入力した 4 行目（対照）は通った。
- **P23 F 仕様のファイル・タイプとファイル指定の組み合わせを検査しない**（定義）。`CMPLXPR.rpgle` 2 行目は 17 桁 `O`・18 桁 `F` で書かれ、
  実機は `RNF2040`（重大度 20）「O のファイル・タイプの指定ではファイルの指定が正しくない」。出力ファイルのファイル指定は空白でなければならない。
- 参考（プロンプターの欠陥ではない）: 両プログラムの `Z-ADD CUSTDATA(I).NO…` は桁は正しいが、修飾名の配列のサブフィールドは
  旧形式の演算項目 2 に書けず `RNF0289` / `RNF7044`。`EVAL` に直した。
