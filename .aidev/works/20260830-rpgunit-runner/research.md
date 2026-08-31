# 調査: RPGUnit ランナーの材料

**大半は本セッションで実機確認済み**（PR #153〜#162）。ここでは道具を書くのに要る形で拾い直す。

## 調査の問い

- **Q1**: 実行と結果採取の経路は何か。既に確定している事実は。
- **Q2**: 接続と認証はどう書くか（秘密を読まずに）。
- **Q3**: 置き場所はどこか。CI を壊さないか。
- **Q4**: 実装アンカーはどこか。

## 判明した事実

### F1: 経路は確定している（Q1）

```
ローカル ──IfsConnection.writeFile──> IFS ──CPYFRMSTMF STMFCCSID(1208)──> ソースPFメンバー
   ──CHGPFM SRCTYPE──> ──RUCRTRPG──> *SRVPGM ──RUCALLTST XMLSTMF──> IFS の XML ──読む──> ローカル
```

確定事項（すべて実機で確認済み。出典は skill `rpgunit-test`）:

| 事実 | 効き方 |
|---|---|
| `RUCRTRPG` は `SRCFILE`/`SRCMBR`（**メンバー**）しか取らない | IFS は経由地。メンバーに落とす段が要る |
| **`SRCMBR` はプログラム名と揃える**（別名は `CPF9815`） | 道具が両方に同じ名前を使えば踏まない |
| `CHGPFM … SRCTYPE(SQLRPGLE)` を忘れると落ちる | 拡張子から決めて自動で付ける |
| `SBMJOB CMD(RPGUNIT/…) INLLIBL(RPGUNIT …) INQMSGRPY(*DFT)` で回る | **CL driver は不要** |
| `RUCALLTST … OUTPUT(*NONE) XMLSTMF('<path>')` | スプールを汚さず XML だけ得る |
| XML は **JUnit 形式**、CCSID 819 | ASCII なら素直に読める |
| `XMLSTMF` のディレクトリが無いと**コンパイル時**に `CPD0006` | CL に定数で書く場合のみ。`SBMJOB` 直書きなら実行時 |
| 既定 20 秒のソケット時間切れでは `RUCRTRPG` が終わらない | `timeoutMs` を伸ばすか `SBMJOB` で切り離す |
| ビルドのコンパイル・リストは**プログラム名**のスプール | 失敗時に名前を出せば次に読む先が分かる |

### F2: 接続の型（Q2）

skill `ibmi-remote` 6.1 の型をそのまま使う。**秘密は読まない**——
`/workspaces/ts5250/.env` は `--env-file` で渡すだけで、中身は参照しない。
識別子は `.env.verify`（`AS400_SYSTEM` / `AS400_LIB` / `AS400_IFS_DIR`）から取る。

```js
const { CommandConnection, IfsConnection, DbConnection, query } =
  await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user,
  password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
```

**外部チェックアウト（`/workspaces/ts5250`）への依存**がここで生まれる。
無い環境では動かないので、**最初に存在を確かめて分かる形で落とす**必要がある。

### F3: 置き場所（Q3）

- 本リポジトリの最上位は `docs/` と `vscode-extension/` の 2 つだけ。
- **CI は名指しのスクリプトしか実行しない**（`.github/workflows/prompter-definitions.yml` は
  `node docs/origin/verify-*.mjs` と `npm test` 等を個別に列挙）。新しいスクリプトを
  置いても CI は触らない。
- `vscode-extension/scripts/` にあるのは**実機に触らない検証系 5 本**。
  ここに ts5250 依存のものを混ぜると、性質が違うものが同居する。
- `docs/origin/*.sh` には実機に触る道具の前例がある（`collect-cmd-definitions.sh` /
  `probe-rpg3-opcodes.sh`）が、あちらは**原典取得**の道具で用途が違う。

→ **`tools/` を新設する**のが素直（spec で確定する）。

### F4: ジョブの完了待ち（Q4）

`SBMJOB` は投げっぱなしなので、**ジョブの消滅で待つ**。

```sql
SELECT JOB_NAME FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO=>'NONE'))
 WHERE UPPER(JOB_NAME) LIKE '%<ジョブ名>%'
```

`QSYS2.ACTIVE_JOB_INFO` の `JOB_USER_FILTER` は使わない（`SQLCODE=-20483` で落ちた実績）。

### F5: スプールを引く（失敗時の手掛かり）

```sql
SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME
  FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
 WHERE USER_NAME = '<user>' AND JOB_NAME LIKE '%<ジョブ名>%'
```

**`JOB_NAME` は `番号/ユーザー/名前`**。`readSpooledPages` は
`{ fileName, fileNumber, jobName, jobUser, jobNumber }` の 5 点で、
**`name`/`number` ではない**（ここで 2 回やり直した）。

## 実現性 / リスク

- **実現性は高い。** 全段が本セッションで実機で通っている。新しい依存も要らない。
- **リスク 1: 外部チェックアウト依存。** `/workspaces/ts5250` が無いと動かない。
  **最初に確かめて分かる形で落とす。**
- **リスク 2: 実機が要る。** CI では回せない（単体テストは書けない）。
  **道具自体の検証は実機で回して確かめる**しかない。純粋な部分（引数解析・XML の要約）は
  切り出せば実機なしで確かめられる。
- **リスク 3: ゴミを残す。** IFS の作業ファイルは必ず消す。スプールは消さない（規約）。

## 実装アンカー

- **A1**: 接続の型（`.claude/skills/ibmi-remote/SKILL.md` 6.1）
- **A2**: 実行と結果の取り方（`.claude/skills/rpgunit-test/SKILL.md` 3〜4 節）
- **A3**: 既存の使い捨ての実例（`.aidev/works/20260828-rpg3-fspec-continuation-options/verify/probe-options.mjs`）
  — スプール読みの書き方の前例。**引数名の間違いもここで踏んだ**ので写すときは 5 点セットを確認する。
- **A4**: 置き場所は未作成（`tools/` を新設）

## spec への申し送り

- **置き場所は `tools/`**（F3）。CI が名指ししないので影響ゼロ。
- **純粋な部分と実機の部分を分ける**（リスク 2）。XML の要約と引数解析は実機なしで
  確かめられるようにしておくと、道具の回帰が書ける。
- スプールの取得は**対象外**（requirement）。ただし**失敗時に名前だけ出す**。
