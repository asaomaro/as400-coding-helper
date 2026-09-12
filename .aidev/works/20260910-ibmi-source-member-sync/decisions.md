# 設計判断: IBM i ソースメンバーの手動同期

## D1: Code for IBM i は実行時に検出する任意統合とする

- 状況: 本拡張の既存の固定長編集機能は IBM i 接続なしで利用できる一方、同期には既存の Code for IBM i 接続プロファイルが必須である。要件 AC4 は本拡張で接続情報を設定・保存しないこと、AC6 は未導入・未接続時に利用者へ理由を示すことを求める。
- 決定: `extensionDependencies` は追加しない。同期コマンドの実行時に `halcyontechltd.code-for-ibmi` を取得・必要なら activate し、export の `instance.getConnection()` と content API を検査する。型検査専用に `@halcyontech/vscode-ibmi-types` を開発依存へ追加し、実行時の npm import は行わない。
- 理由: 常時利用できる本拡張の既存機能を Code for IBM i の未導入で無効化せず、接続していない状態を AC6 の案内として扱える。公開 content API を使うため、資格情報、SFTP、IFS 一時ファイル、CCSID 変換を二重実装しない。
- 影響: 実行時 API の形が期待と異なる場合も接続なしと同じ成功扱いにせず、互換性エラーとして明示する。実機結合試験には Code for IBM i が導入・接続済みの VS Code 環境が必要となる。

## D2: ダウンロードは開いている文書を置換して保存する

- 状況: 要件 AC3 と利用者選択は、確認なしでローカル側を IBM i メンバー内容で上書きすることを求める。開いている文書だけを対象にするため、ディスクを直接書き換えるとエディターのバッファーとずれる。
- 決定: ダウンロード結果は対象 `TextDocument` の全範囲へ `WorkspaceEdit.replace` で適用し、成功時に `document.save()` でローカルファイルへ確定する。未保存のローカル編集もこの明示操作で置換される。アップロードは現在の文書バッファーの `getText()` を送る。
- 理由: 表示中のバッファー、保存済みファイル、フォーカスの整合を保ち、利用者が明示的に選んだ上書き方向をそのまま実現する。
- 影響: download の save が拒否・失敗した場合は、IBM i 側取得成功とローカル反映成功を混同せずエラー通知する。保存イベントを登録しないため、AC7 の自動同期禁止を守る。

## D3: 三層の一方向依存にする

- 状況: パス規則、外部拡張の可用性、VS Code UI 操作は変更理由も試験方法も異なる。1 つの command ファイルにまとめると、path の小さな変更にも VS Code と Code for IBM i の fake が必要になり、外部 API の更新影響も局所化できない。
- 決定: `memberPath`（純粋ドメイン）← `codeForIbmi`（外部 adapter）← `memberSync`（VS Code command）の一方向依存とする。command は `MemberContentApi` を注入可能な依存として受け、production 登録時だけ adapter を渡す。
- 理由: パス変換を VS Code 非依存で検証でき、adapter の動的 extension 検出を 1 箇所に閉じ、command の上書き・通知・フォーカス復帰を fake で検証できる。
- 退けた案: command から Code for IBM i の export を直接呼ぶ案は、外部 API、メッセージ、path 規則が結合し、未導入時の分岐を各コマンドに重複させるため採らない。独自 SSH/SFTP client の案は、要件 AC4 と既存 content API の CCSID/cleanup 責務に反するため採らない。

## D4: 色属性を保持するため同期は独自の SSH/SFTP 経路へ切り替える

- 状況: 利用者は既存の RPG 等のソースメンバーに埋め込まれた SEU の色属性を維持し、VS Code 上では色を識別できる可視記号（例: 赤属性の `Ŕ`）として編集したい。Code for IBM i は SEU 色をサポート対象外としており、既存の content API に文字列を無変換で渡す方針では、色属性の保持を保証できない。
- 決定: Code for IBM i の接続 profile、公開・非公開 API、内部 SFTP client は利用しない。本拡張の設定に接続先の非機密情報を保持し、独自の SSH/SFTP 経路でメンバーを送受信する。可視記号とホストの属性バイトの対応・CCSID・一時 IFS 経路の正確な扱いは research で確定する。
- 理由: 色属性を操作可能な VS Code 上の記法にしつつ、送受信時の正確な可逆変換を本拡張が支配するため。Code for IBM i の非公開接続情報を借りると、公開 API の契約外となり更新時に破綻する。
- 影響: 以前の D1 と D3 にある Code for IBM i adapter / content API の判断は廃止する。接続設定と認証情報の安全な保管、SSH/SFTP のエラー処理、実機での raw byte 往復検証がこの work の対象になる。

## D5: source PF の CCSID は設定せず `DBFCCSID(*FILE)` を使う

- 状況: source PF の CCSID は環境・ファイルごとに異なり、利用者設定に複製すると値のずれによる文字化けを生む。実機調査では CCSID 5035 で色属性を含む UTF-8 往復を確認した。
- 決定: `CPYTOSTMF` と `CPYFRMSTMF` に `STMFCCSID(1208) DBFCCSID(*FILE)` を指定する。CCSID 65535 で IBM i が変換を拒否した場合は更新せず、理由と修正操作を通知する。
- 理由・代替案: IBM 原典は `*FILE` が database/source file CCSID を使うと規定する。設定 `sourceCcsid` を追加する案は source PF との二重管理になり、更新時に誤設定を検知できないため退ける。
- 影響: 同期専用 settings に CCSID は含めない。DBCS と色属性の変換は IBM i の file CCSID を正とし、UTF-8 wire から可視マーカーへの変換だけを拡張側が担う。

## D6: 初期 UI は7基底色を可視マーカー化し、修飾属性は無変換で通過させる

- 状況: 実機で確認した基底色は 7 種であり、利用者が指定した `Ŕ` のように色名を読める一文字を割り当てられる。一方、反転・下線等を組み合わせた 25 以上の属性値を、一文字で意味が分かる文字へ一意に割り当てるには別の利用者記法の合意が要る。
- 決定: green/white/red/turquoise/yellow/pink/blue の7基底値だけを可視マーカー化・装飾・キーボード入力の対象とする。その他の wire 制御文字は変換せず、ダウンロード→無変更アップロードで通過させる。削除・既知の色への丸めはしない。
- 理由・代替案: 全属性を private-use 文字へ割り当てる案は可逆だが「Red の R が見える」という目的を満たさない。未知属性を拒否する案は既存メンバーを読めなくする。まず実用上の色記法を実現し、修飾属性の可視記法は後続要件で追加する。
- 影響: AC11 のサポート対象は research で確定した7基底色である。修飾属性は保持されるが VS Code 上での色装飾・新規入力の対象外であり、テストで無変換通過を固定する。
