# 要件: 生成物の再生成チェックを取りこぼしなくする

## 背景 / 課題

CI の「再生成しても差分が出ないこと」は、AGENTS.md の
**「JSON を手で直さず生成スクリプトを直す」を機械的に守る唯一の仕掛け**。
ところが**取りこぼしがある**。

| 出力先 | 生成器 | CI で再生成 | CI で差分検査 |
|---|---|---|---|
| `prompter/cl` | `generate-cl-definitions` / `generate-cdml-rules` | ○ | ○ |
| `navigation` | `generate-dds-columns` / `generate-seu-format-lines` | 一部（`--lang=en` が無い） | ○ |
| `completion` | `generate-dds-*` / `generate-rpg*-completion` | ○ | ○ |
| **`prompter/dds`** | `generate-dds-prompter` | ○ | **×** |
| **`prompter/cmd`** | `generate-cl-definitions` | ○ | **×** |
| **`prompter/rpg`** | `generate-rpg-spec-definitions` / `generate-rpg-io-definitions` | 一部（io が無い） | **×** |

つまり **`prompter/dds` は手で直しても CI が気付かない**。
`20260829-dds-en-labels` で足した `dds-*.en.json` も、`--lang=en` が
CI の再生成に無いため**ドリフトが検出されない**。

backlog「CI を整える」の本 PJ 側は、**lint core の CI 化は既に済んでいる**
（`verify-lint-core.mjs`・桁位置 lint・単体テスト・統合・GUI e2e が回っている）。
残っていたのはこの取りこぼしだった。

## 目的 / ゴール

**生成物を手で直したら CI が落ちる状態**。生成器と出力の対応に穴が無い状態。

紐づく charter ゴール: 「横断する技術的負債の解消」。

## ユーザーストーリー

- US1: **定義を直す開発者**として、JSON を手で直したら CI に止めてほしい。
  なぜなら、**手編集は次の再生成で黙って消える**から。生成器を直すのが規約で、
  それを守らせる仕掛けが CI のこのステップしかない。（受け入れ: AC1, AC2）

## スコープ

### 対象
- CI の再生成ステップに抜けている生成器を足す。
- 差分検査の対象に抜けている出力先を足す。
- 検査対象と生成器の対応が**ずれたら気付ける**ようにする。

### 対象外
- **`as400-web-emulator` のオフライン回帰**（別リポジトリ。ローカルに無い）。
- 生成器そのものの変更。
- CI の他のジョブ（test / integration / gui-e2e）。

## 完了条件 (受け入れ基準)

- [ ] AC1: CI の再生成ステップが**すべての生成器**を（言語違いも含めて）走らせる。
- [ ] AC2: 差分検査が `resources/` 配下の**生成物すべて**を見る。
- [ ] AC3: `prompter/dds` の JSON を手で直すと CI が落ちる（実際に試して確認）。
- [ ] AC4: いまの committed 状態で**差分ゼロ**（既存のドリフトが無いこと）。
- [ ] AC5: backlog「CI を整える」の**本 PJ 側が済んでいること**を根拠つきで記録し、
      別リポジトリ側は残件として分ける。
