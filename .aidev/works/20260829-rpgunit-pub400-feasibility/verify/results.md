# 検証結果（2026-08-29）

**副作用ゼロ**で確かめた。使ったのは `QSYS2.USER_INFO` / `QSYS2.OBJECT_STATISTICS` の
読み取りと、`CHKOBJ ... AUT(*USE)`（権限を見るだけでオブジェクトを作らない）。

## 権限

| | pub400（`MARO`） | SR-OSAKA（`ASAO`） |
|---|---|---|
| `SPECIAL_AUTHORITIES` | **なし**（`null`） | `*ALLOBJ *JOBCTL *SPLCTL *SAVSYS *AUDIT *IOSYSCFG` |
| `USER_CLASS_NAME` | `*PGMR` | `*PGMR` |
| `LIMIT_CAPABILITIES` | `*NO` | `*NO` |

## 導入経路の可否

| コマンド | pub400 | SR-OSAKA |
|---|---|---|
| **`RSTLIB`**（RPGUnit の標準配布は save file） | **× `CPF9802`** | ○ |
| **`RSTOBJ`** | **× `CPF9802`** | ○ |
| **`CRTLIB`**（`RPGUNIT` ライブラリを作る） | **× `CPF9802`** | ○ |
| `CRTSAVF` | ○ | ○ |
| `CRTBNDRPG` / `CRTRPGMOD` / `CRTSRVPGM` / `CRTPGM` | ○ | ○ |
| `CRTCLPGM` / `CRTBNDCL` / `CRTCMD` / `CRTMSGF` / `CRTSRCPF` / `ADDLIBLE` | ○ | ○ |

`RPGUNIT` ライブラリはどちらの機械にも**存在しない**（`OBJECT_STATISTICS('*ALLUSR','*LIB')` で 0 件）。

## 結論

**pub400 への RPGUnit 導入は不可能。**

- **標準経路（save file の `RSTLIB`）が塞がっている**。`CPF9802 Not authorized to object`。
  pub400 の一般アカウントには特殊権限が 1 つも無く、復元系は使えない。
- **`RPGUNIT` という名前のライブラリも作れない**（`CRTLIB` も `CPF9802`）。
  既存の自分のライブラリは `MARO1` / `MARO2` / `MAROB` の 3 つだけ。
- **ソースからのビルドは、道具立てとしては揃っている**（`CRTBNDRPG` / `CRTSRVPGM` /
  `CRTCMD` / `CRTMSGF` はすべて使える）。ただし RPGUnit のビルドは**ライブラリ名
  `RPGUNIT` を前提**にしており（コマンドの CPP 参照・バインディング・ディレクトリー）、
  自分のライブラリへ名前を変えて入れるには手直しが要る。**やるかどうかは労力の判断**。

**SR-OSAKA なら標準経路で入る**（`*ALLOBJ` ＋ `*SAVSYS` があり `RSTLIB` が通る）。
ただし**別の機械に第三者のバイナリを入れる**話なので、起票（pub400 が対象）の範囲外。

## 受け入れ基準

| AC | 結果 |
|---|---|
| AC1 メッセージ ID で決着 | ✓ `CPF9802`（`RSTLIB` / `RSTOBJ` / `CRTLIB`） |
| AC2 標準経路と代替経路の両方 | ✓ 復元不可・ライブラリ作成不可・ビルドは道具だけ揃う |
| AC3 他の機械での可否 | ✓ SR-OSAKA は可（権限一覧つき） |
| AC4 依存項目の前提を書き換え | ✓ backlog を更新 |
| AC5 副作用なし | ✓ 読み取りと `CHKOBJ` のみ。作成・削除ゼロ |
