# 仕様: 継続行にまたがる参照

## 設計方針

`renameReferenceResults` の走査を **`lines` から `joinContinuations(lines)` へ**変える。

| run の形 | 何をするか | なぜ |
|---|---|---|
| 1 行（継続なし） | その物理行のキーワード欄だけ差し替える | 見た目を変えない（前 work の判断） |
| 複数行（継続） | **結合したテキストで探し、run をまとめて折り直す** | 物理行だけでは参照が見つからない |

**この 2 つは衝突しない**——単独のキーワード行は `joinContinuations` が
別の run として返すので、`R MAIN` の次の行が吸い込まれることはない
（`research.md` F3）。

## 対象範囲

- `src/core/dds/ddsEdit.ts` `renameReferenceResults` のみ。

## 振る舞いの詳細

- 代表行が改名の宛先（`skipSourceLine`）なら run ごと飛ばす。
- 注記行・空行は飛ばす。
- 置き換える関数（項目 / 様式）は今までどおり引数で受け取る。

## エラー処理 / 異常系

- 折り直しで欄に収まらなければ `foldKeywordArea` が行を増やす（既存）。

## 受け入れ基準との対応

- AC1 / AC2 / AC3: 継続の run を結合テキストで探す。
- AC4: run が 1 行のときの経路は変えていない。単体で明示的に固定する。
- AC5: `verify/verify-continued-rename.mjs`（対照つき）。
- AC-I1: 1 行の run は差し替えのみ。
