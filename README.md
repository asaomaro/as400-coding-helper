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

## 商標について

This project is not affiliated with or endorsed by IBM.
IBM, IBM i, and AS/400 are trademarks of International Business Machines Corporation.
本プロジェクトは IBM とは関係のない非公式のものです。
