# 仕様: IBM i ソースメンバーの手動同期と可視 SEU 色属性

## 概要

VS Code の現在のファイルを `src/<LIB>/<SRCFILE>/<MEMBER>.<ext>` 規則で IBM i の source member に対応付ける。拡張機能が自身の設定と SecretStorage から作る SSH 接続を使い、同一接続の SFTP と `CPYTOSTMF` / `CPYFRMSTMF` により明示的に送受信する。

IBM i から UTF-8 へ変換された 7 基底色の制御 Unicode は、文書へ保存する段階で `Ŕ` などの可視マーカーに置換する。色マーカーは1文字であり、送信時には元の wire Unicode へ逆変換する。エディター装飾はマーカー自身から次のマーカー直前または行末まで適用する。

## 設計方針

- **Code for IBM i に依存しない。** `ssh2` を唯一の runtime transport dependency とし、SSH exec と SFTP を一つの接続ライフサイクルに閉じる。接続プロファイル・資格情報・API は参照しない。
- **変換と I/O を分離する。** パス解決、色 marker/wire 変換、装飾範囲は VS Code／ネットワーク非依存の純粋ロジックにする。SSH/SFTP は adapter、文書更新・通知は command に限定する。
- **CCSID の正本は source PF。** `CPYTOSTMF` / `CPYFRMSTMF` に `STMFCCSID(1208) DBFCCSID(*FILE)` を渡す。CCSID を settings に複製しない。65535 など IBM i が変換を拒否する場合は、ホストメンバーとローカル文書のどちらも変更成功扱いにしない。
- **色の初期対象は7基底色。** `Ĝ`/`Ŵ`/`Ŕ`/`Ŧ`/`Ŷ`/`Ṕ`/`Ḃ` を marker にする。反転・下線等の修飾属性は入力・装飾の対象外だが、既存 wire Unicode を変換せず通過させ、無変更往復で失わない。
- **同期は明示コマンドのみ。** 保存イベントは登録しない。ダウンロードは現在の document の全範囲を置換して保存し、開始時に捕捉した document を再表示してフォーカスを戻す。

### 操作シーケンス

```mermaid
sequenceDiagram
  participant U as User / VS Code
  participant C as Member sync command
  participant T as SSH/SFTP transport
  participant H as IBM i source member

  U->>C: Upload or Download command
  C->>C: resolve active URI / validate settings and secret
  alt Upload
    C->>C: marker -> wire Unicode, normalize LF
    C->>T: SFTP put temporary UTF-8 file
    T->>T: close SFTP file handle
    T->>H: CPYFRMSTMF STMFCCSID(1208) DBFCCSID(*FILE)
  else Download
    T->>H: CPYTOSTMF STMFCCSID(1208) DBFCCSID(*FILE)
    T->>C: SFTP get temporary UTF-8 file
    C->>C: normalize EOL, wire Unicode -> marker
    C->>C: WorkspaceEdit replace + document.save
  end
  T->>T: delete temporary IFS file in finally
  C->>U: success or actionable failure; restore editor focus
```

## 対象範囲

| ファイル | 変更 |
|---|---|
| `vscode-extension/package.json` | `ssh2` 依存、同期設定、4 コマンド、エディター右クリックメニューを追加 |
| `vscode-extension/src/sync/memberTarget.ts` | workspace 相対パスから IBM i member target を純粋に解決 |
| `vscode-extension/src/sync/visibleColorMarkers.ts` | 7基底色の marker/wire 変換、装飾セグメントを純粋に計算 |
| `vscode-extension/src/sync/ibmiSourceTransport.ts` | `ssh2` の接続、exec、SFTP、IFS cleanup、エラー正規化 |
| `vscode-extension/src/extension/commands/memberSync.ts` | 設定・SecretStorage・現在文書・transport を組み合わせる upload/download/secret commands |
| `vscode-extension/src/language/seuColorMarkers.ts` | 色装飾の作成、再計算、設定変更時の再描画 |
| `vscode-extension/src/extension/extension.ts` | 同期コマンドと色装飾を activation 時に登録 |
| `vscode-extension/test/support/vscode-stub.js` | SecretStorage、装飾、document save、入力 box の最小 stub を追加 |
| `vscode-extension/test/unit/memberSync.test.ts` | target、marker、command、失敗通知、文書置換の unit tests |
| `vscode-extension/test/unit/seuColorMarkers.test.ts` | 色範囲の算出と decoration 登録の unit tests |
| `.aidev/works/20260910-ibmi-source-member-sync/verify/probe-seu-source-color.mjs` | 実機の色/CCSID/IFS cleanup 回帰プローブとして維持・拡張 |

## 依拠する既存の事実

- `TARGET_EXTENSIONS` と `isInScopeDocument` が表示系の対象集合の唯一の真実源である。`vscode-extension/src/utils/fileScope.ts:47-52,109-118`。
- SOSI は active editor／document change を購読し、対象外・無効時には `setDecorations(..., [])` で確実に解除する。`vscode-extension/src/language/dbcsShiftMarkers.ts:42-65,126-141`。
- 拡張の activation は `registerLanguageFeatures` と command 登録を呼ぶだけである。`vscode-extension/src/extension/extension.ts:5-7`。新しい登録はここから到達させる。
- コマンド・設定・editor/context menu の寄与は `package.json` に置く。既存の editor/context は `vscode-extension/package.json:150-166`、設定は `:195-365`。
- `WorkspaceEdit.replace` と `workspace.applyEdit` は既存の書き戻し経路で使われる。`vscode-extension/src/prompter/applyChanges.ts:79-95`。
- unit test は extension host を起動せず `test/support/vscode-stub.js` を差し替える。`vscode-extension/package.json:374,378` と `vscode-extension/test/support/vscode-stub.js:255-285`。
- IBM i の色属性、UTF-8 wire 値、CCSID 5035 の往復、SFTP close 後に `CPYFRMSTMF` を呼ぶ制約は [research.md](research.md) F2-F5 と実機プローブに確定記録されている。

## インターフェース / データ構造

### target と marker

```ts
export interface MemberTarget {
  readonly library: string;    // 大文字、IBM i object-name として検証済み
  readonly sourceFile: string; // 同上
  readonly member: string;     // 拡張子を除いた名前
}

export type SeuBaseColor =
  | "green" | "white" | "red" | "turquoise" | "yellow" | "pink" | "blue";

export interface VisibleColorMarker {
  readonly color: SeuBaseColor;
  readonly marker: string;       // exactly one UTF-16 code unit
  readonly wireCodePoint: number;
  readonly ibmiAttributeByte: number;
}

export interface ColorSegment {
  readonly range: { line: number; start: number; end: number };
  readonly color: SeuBaseColor;
}

export function resolveMemberTarget(relativePath: string): MemberTarget | undefined;
export function wireToVisible(text: string): string;
export function visibleToWire(text: string): string;
export function findColorSegments(lines: readonly string[]): readonly ColorSegment[];
```

マップは下表を `visibleColorMarkers.ts` の唯一の真実源に置く。

| 色 | marker | wire | attribute byte |
|---|---|---:|---:|
| green | `Ĝ` | U+0080 | `20` |
| white | `Ŵ` | U+0082 | `22` |
| red | `Ŕ` | U+0088 | `28` |
| turquoise | `Ŧ` | U+0090 | `30` |
| yellow | `Ŷ` | U+0016 | `32` |
| pink | `Ṕ` | U+0098 | `38` |
| blue | `Ḃ` | U+009A | `3A` |

### 設定と秘密値

```ts
export type IbmiAuthMethod = "password" | "privateKey";

export interface IbmiSourceSyncSettings {
  readonly host: string;
  readonly port: number;               // default 22
  readonly user: string;
  readonly authMethod: IbmiAuthMethod;
  readonly privateKeyPath?: string;    // privateKey のときだけ必要、非機密
  readonly ifsTempDirectory: string;   // absolute IFS path、必須
  readonly hostKeySha256: string;      // SSH host-key fingerprint、必須
}

const SECRET_KEY = "rpgClSupport.ibmiSourceSync.authentication";
```

`rpgClSupport.ibmiSourceSync.*` を settings に寄与する。色表示は同期接続と独立した `rpgClSupport.seuColors.enabled`（既定 `true`）で制御する。password 認証時の secret は必須の password、privateKey 認証時の secret は任意の passphrase として `context.secrets` に保存する。秘密鍵本文は保存しない。`setAuthenticationSecret` は password input、`clearAuthenticationSecret` は `secrets.delete` のみを行う。

### transport

```ts
export interface IbmiSourceTransport {
  download(target: MemberTarget): Promise<string>; // UTF-8 wire text、EOL は未正規化
  upload(target: MemberTarget, utf8WireText: string): Promise<void>;
  dispose(): void;
}

export function createIbmiSourceTransport(
  settings: IbmiSourceSyncSettings,
  authenticationSecret: string | undefined
): Promise<IbmiSourceTransport>;
```

adapter は target を IBM i object-name として、IFS temporary directory を絶対 path として検証する。CL 文字列へ埋め込む前に library/source file/member/path を検証・quote し、未検証入力を shell へ渡さない。`ssh2` の host verifier は `hostKeySha256` と一致しない接続を拒否する。

## 振る舞いの詳細

### target 解決

1. command が active document の URI が所属 workspace の配下か確かめ、`workspace.asRelativePath` で相対パスを得る。
2. `resolveMemberTarget` は相対 segment が `src/<LIB>/<SRCFILE>/<filename>` のちょうど4個であることを確認する。
3. `<filename>` から最後の拡張子だけを落とした member が空でなく、LIB/SRCFILE/member が IBM i object-name 規則に適合するときだけ target を返す。
4. 小文字入力は uppercase に正規化する。対応外パスでは `undefined` を返し、command が理由を表示する。

### ダウンロード

1. command 開始時に active editor、document、workspace、target を捕捉する。対象外・設定不足・secret 不在なら接続しない。
2. transport が UUID を含む一時 IFS path を作り、`CPYTOSTMF FROMMBR(...) TOSTMF(...) STMFOPT(*REPLACE) STMFCCSID(1208) DBFCCSID(*FILE)` を SSH exec する。
3. SFTP get で UTF-8 bytes を取得し、finally で IFS file を delete する。取得 text の CRLF/CR を document の EOL へ正規化し、`wireToVisible` を通す。
4. `WorkspaceEdit.replace(document.uri, document full range, visibleText)` を適用し、`document.save()` が成功したときだけ成功通知する。失敗時は IBM i 読取り成功をローカル更新成功として通知しない。
5. 開始時の document を `showTextDocument` し、選択位置を可能な限り維持してフォーカスを戻す。

### アップロード

1. 開始時に捕捉した document の `getText()` を読み、`visibleToWire` を適用する。改行を LF に正規化して UTF-8 bytes にする。
2. SFTP put を完了させ、**SFTP file handle と subsystem session を閉じてから**（SSH Client 接続は維持する）`CPYFRMSTMF FROMSTMF(...) TOMBR(...) MBROPT(*REPLACE) STMFCCSID(1208) DBFCCSID(*FILE)` を SSH exec する。
3. 成否にかかわらず一時 IFS file を delete する。CL 成功時だけ成功通知し、document の保存状態は変更しない。

### marker 表示

1. `registerSeuColorMarkers` は `isInScopeDocument` が真の active editor のみを対象にする。
2. 文書の各行を左から走査する。marker を見つけた位置を含め、次 marker の直前または行末までの `Range` を当該色の decoration に入れる。
3. 7 色ごとに一つの decoration type を作る。foreground は色ごとの theme-compatible token／CSS color を用い、既存の構文色より色属性を優先する。範囲外・inactive・`rpgClSupport.seuColors.enabled=false` では全 decoration を空配列で外す。
4. active-editor change、active document change、色表示設定 change で再計算する。本文は絶対に編集しない。marker は document 内の文字として残るため、キーボードで直接入力できる。

### コマンドとメニュー

| command | title | editor/context の条件 |
|---|---|---|
| `rpgClSupport.ibmiSourceSync.upload` | `IBM i: 現在のソースをアップロード` | `editorTextFocus` |
| `rpgClSupport.ibmiSourceSync.download` | `IBM i: 現在のソースをダウンロード` | `editorTextFocus` |
| `rpgClSupport.ibmiSourceSync.setAuthenticationSecret` | `IBM i 同期: 認証情報を保存` | command palette |
| `rpgClSupport.ibmiSourceSync.clearAuthenticationSecret` | `IBM i 同期: 保存済み認証情報を削除` | command palette |

editor/context の `when` は `TARGET_EXTENSIONS` と同じ全拡張子を package JSON に列挙し、既存の `verify-contributes.mjs` で一致を検査する。実行可否の最終判定は command 内の `resolveMemberTarget` で行うため、menu の条件だけを認可境界にしない。

## ドメイン固有の考慮

- source PF member の先頭12バイト（sequence/date）は `CPYFRMSTMF` / `CPYTOSTMF` が扱う。ローカル本文へ持ち込まない。
- 文字列の JS length は DBCS の実機バイト幅と異なるが、色 marker は一つの source attribute byte に対して一つの BMP code unit である。marker 変換は DBCS 文字を変更しない。
- 受信した修飾属性の wire control は見える marker に置換せず、そのまま upload へ戻す。通常文字や未知属性を削除・丸めない。
- SOSI は DBCS の前後へ表示だけを差し込む装飾である。色 marker は保存本文なので処理を共有せず、両方の decoration が同じ対象文書で共存できることを integration test で見る。
- IFS は temporary path のみを使い、library/source PF/member の作成・削除・改名・browse は実施しない。

## エラー処理 / 異常系

| 条件 | 動作 / 利用者への案内 |
|---|---|
| 対象パスでない、または object name 不正 | 接続せず、必要な `src/<LIB>/<SRCFILE>/<MEMBER>.<ext>` 形式を表示 |
| host/user/temp path/fingerprint/key path が不足・不正 | 接続せず、Settings を開いて該当キーを設定するよう表示 |
| password 認証で secret が無い | 接続せず、`認証情報を保存` command を案内（private key の passphrase は任意） |
| host key 不一致 | 接続せず、設定した fingerprint とサーバー鍵を管理者へ確認するよう表示 |
| SSH/SFTP 認証・到達・権限失敗 | error ID と安全な要約だけを表示。password/passphrase/key 本文・command の秘密値はログしない |
| CPY conversion / CCSID 65535 | IBM i member を更新成功扱いにせず、source PF CCSID の修正を案内 |
| upload の CPY 失敗 | temporary IFS file を finally で削除し、member は成功通知しない |
| download の WorkspaceEdit/save 失敗 | transport 成功とローカル保存成功を分けて error 通知。フォーカスは開始文書へ戻す |

## テスト方針

- `memberTarget` は workspace 相対パスの階層不足、拡張子なし、lowercase、IBM i object-name 不正を unit test し、command 側は workspace 内外を test する。
- `visibleColorMarkers` は7値の wire→marker→wire、各 marker の色範囲、DBCS を含む行、修飾属性 wire control の無変換通過を table-driven unit test する。
- command は fake transport と vscode stub で upload payload、download replace/save、通知、secret 不在、対象外、active document を捕捉した後のフォーカス復帰を test する。
- transport は `ssh2` client facade を注入し、SFTP put close → exec CPYFRMSTMF の順序、finally cleanup、host key mismatch、stderr の secret 非露出を unit test する。
- integration は extension host で marker decoration と SOSI decoration の共存を確認する。
- 実機は [probe-seu-source-color.mjs](verify/probe-seu-source-color.mjs) を拡張して、7基底色、`Ŕ` 入力の `x'28'` 復元、DBCS を含む行、IFS cleanup を検査する。

## 受け入れ基準との対応

- AC1: active `TextDocument.uri` と `workspace.getWorkspaceFolder` が workspace 相対パスの入力元となり、`resolveMemberTarget` が固定 `src/<LIB>/<SRCFILE>/<MEMBER>.<ext>` 規則から target を返す。
- AC2: active document の `getText()` が `visibleToWire` と transport `upload` の入力となり、`CPYFRMSTMF` 成功時だけ通知する。
- AC3: transport `download` の UTF-8 wire text が `wireToVisible`、`WorkspaceEdit.replace`、`document.save()` の入力となる。
- AC4: package settings と `ExtensionContext.secrets` が接続入力であり、Code for IBM i を import・検出しない。secret を含まないエラー正規化を使う。
- AC5: package の command/menu 寄与が UI 入口であり、active document URI を command 内で再検証して対象外理由を通知する。
- AC6: settings reader、SecretStorage reader、transport error classifier が不足・認証・到達不能を接続前／接続後に分け、各修正操作を通知する。
- AC7: save listener を登録せず、`upload` / `download` command handler だけが transport を呼ぶ。
- AC8: `DBFCCSID(*FILE)` を IBM i の変換入力とし、marker pure function は DBCS を変更しない。実機 DBCS ケースが検証入力となる。
- AC9: transport download の U+0088 が `wireToVisible` の入力となり、`Ŕ` と red decoration segment を作る。
- AC10: document の `Ŕ` が `visibleToWire` の入力となり、U+0088 UTF-8 を経て `CPYFRMSTMF` が `x'28'` を同位置へ戻す。
- AC11: research で確定した7基底 wire control が table-driven marker map の入力となり、download→upload の属性種別・位置・通常文字を実機プローブで比較する。
- AC-I1: editor/context と command palette の handler が唯一の開始入口で、選択方向の処理完了後に通知する。
- AC-I2: handler は確認ダイアログを出さず、コマンド実行時だけ一方向の転送を開始する。
- AC-I3: command palette の command と document に直接入力した marker が入力経路となる。
- AC-I4: handler 開始時に捕捉した document を `showTextDocument` の入力とし、download の後も同エディターへ戻す。
- AC-I5: command/menu は editor context に限定し、SOSI/color decorations は対象文書だけへ適用する。F4/tab/save keybinding と保存 listener は変更しない。
