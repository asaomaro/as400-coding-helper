# 仕様: clPrompter との F4 衝突を確かめる

## 設計方針

### D1: 一次情報はマニフェスト

競合のキーバインドは README ではなく **`package.json` の `contributes.keybindings`**
から引く（調査文書の方針「ソースを直読」と同じ）。

取得した実物:

```json
{ "command": "clPrompter.clPrompter", "key": "f4",
  "when": "editorTextFocus && (editorLangId == clle || editorLangId == clp || editorLangId == cl || editorLangId == bnd || editorLangId == cmd)" }
```

**`contributes.languages` を持たない**ことも確認した。これが効く——
clPrompter 自身は言語を登録しないので、その `when` が真になるかは
**他の拡張がその languageId を登録しているか**にかかっている。

### D2: 重なりは「拡張子 × languageId」で判定する

本 PJ は **`resourceExtname`** で、clPrompter は **`editorLangId`** で条件を書いている。
軸が違うので、単純な文字列比較では重なりが分からない。
**本 PJ 自身の `contributes.languages`** を突き合わせる必要がある。

### D3: 本 PJ の挙動は変えない

衝突を避けるには本 PJ が `.clp` の F4 を降りるしかないが、それは
**本 PJ の CL プロンプターを使えなくする**ことと同義。どちらを使うかは利用者の選択で、
拡張が勝手に決めることではない。**回避手段を書くに留める**。

なお `.clp` → `cl` の言語登録をやめる案も退ける。`cl` は
コメントトグル・タブナビ・CL 診断の発火条件でもあり、外すと本 PJ の機能が落ちる
（AGENTS.md「languageId / アクティベーション変更時の下流波及チェック」）。

## 対象範囲

| ファイル | 変更 |
|---|---|
| `docs/research/code-for-ibmi.md` | 「未確認」を確定した事実に置き換え、回避手段を足す |

**コードは変更しない。**

## 受け入れ基準との対応

| AC | 満たし方 |
|---|---|
| AC1 | D1。取得した `when` をそのまま載せる |
| AC2 | D2。拡張子ごとの表 |
| AC3 | `keybindings.json` の実例 |
| AC4 | 該当行を書き換える |
